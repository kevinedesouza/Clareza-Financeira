/**
 * Sugestão de categoria para linhas de extrato/fatura com a API da OpenAI (somente servidor).
 *
 * - Configuração: OPENAI_API_KEY e OPENAI_MODEL (ex.: gpt-5.6-luna) no ambiente do servidor.
 * - Sem chave ou modelo configurados, a função não faz nada.
 * - Envia só descrição, valor com sinal e data; nunca contas, CPF ou identificadores.
 * - A IA só pode escolher entre as categorias do próprio usuário (validado após a resposta).
 */

export interface AiCategory {
  id: string;
  name: string;
  kind: string;
}

export interface AiRowInput {
  rowId: string;
  description: string;
  amountCents: number;
  date: string;
}

export interface AiExample {
  description: string;
  categoryId: string;
}

export interface AiSuggestion {
  rowId: string;
  categoryId: string;
  confidence: number;
}

export const AI_MIN_CONFIDENCE = 0.6;
const BATCH_SIZE = 40;
const CONCURRENCY = 3;
const MAX_EXAMPLES = 80;

export function aiConfig(): { apiKey: string; model: string } | null {
  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  // Normaliza o ID do modelo: IDs da OpenAI são minúsculos e com hífen (ex.: gpt-5.6-luna).
  const model = (process.env.OPENAI_MODEL || '').trim().toLowerCase().replace(/\s+/g, '-');
  if (!apiKey || !model) return null;
  return { apiKey, model };
}

const SYSTEM_PROMPT = [
  'Você classifica lançamentos de extratos bancários e faturas de cartão de crédito pessoais, em reais (BRL).',
  'Escolha a categoria de cada lançamento somente entre as categorias fornecidas, usando o id exato.',
  'Use os exemplos do histórico do usuário como referência: estabelecimentos parecidos devem receber a mesma categoria.',
  'Descrições podem vir abreviadas e com parcelas (ex.: "Parcela 2/3"); interprete o estabelecimento.',
  'Se não houver base suficiente, use categoryId null. Não invente categorias.',
  'Pagamentos de fatura, transferências entre contas e estornos devem ser marcados como null, a menos que exista uma categoria de transferência adequada.',
  'Confiança entre 0 e 1: alta (>= 0.8) só quando a descrição deixa a categoria clara.',
].join(' ');

function buildSchema(categoryIds: string[], rowIds: string[]) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['rowId', 'categoryId', 'confidence'],
          properties: {
            rowId: { type: 'string', enum: rowIds },
            categoryId: {
              anyOf: [{ type: 'string', enum: categoryIds }, { type: 'null' }],
            },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
          },
        },
      },
    },
  };
}

function extractText(json: any): string {
  if (typeof json?.output_text === 'string') return json.output_text;
  const parts: string[] = [];
  for (const item of json?.output || []) {
    for (const c of item?.content || []) {
      if (c?.type === 'output_text' && typeof c.text === 'string') parts.push(c.text);
    }
  }
  return parts.join('');
}

async function callOpenAi(
  cfg: { apiKey: string; model: string },
  payload: unknown,
  categoryIds: string[],
  rowIds: string[]
): Promise<AiSuggestion[]> {
  const body = {
    model: cfg.model,
    input: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(payload) },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'categorize_rows',
        strict: true,
        schema: buildSchema(categoryIds, rowIds),
      },
    },
    max_output_tokens: 8000,
  };

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`OpenAI indisponível (HTTP ${res.status})`);
        continue;
      }
      const json: any = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || `OpenAI HTTP ${res.status}`);
      const parsed = JSON.parse(extractText(json) || '{"items":[]}');
      return Array.isArray(parsed.items) ? parsed.items : [];
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Falha ao consultar a OpenAI');
}

/**
 * Retorna sugestões validadas (categoria existente e confiança mínima).
 * Lança erro em falha de rede/API; quem chama decide como seguir (a importação não deve ser bloqueada).
 */
export async function suggestCategoriesWithAi(
  rows: AiRowInput[],
  categories: AiCategory[],
  examples: AiExample[]
): Promise<AiSuggestion[]> {
  const cfg = aiConfig();
  if (!cfg || rows.length === 0 || categories.length === 0) return [];

  const categoryIds = categories.map((c) => c.id);
  const categoryById = new Set(categoryIds);
  const exampleList = examples.slice(0, MAX_EXAMPLES).map((e) => ({
    description: e.description,
    categoryId: e.categoryId,
  }));
  const catPayload = categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind }));

  const batches: AiRowInput[][] = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) batches.push(rows.slice(i, i + BATCH_SIZE));

  const accepted: AiSuggestion[] = [];
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const group = batches.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      group.map((batch) =>
        callOpenAi(
          cfg,
          {
            categories: catPayload,
            examples: exampleList,
            rows: batch.map((r) => ({
              rowId: r.rowId,
              description: r.description,
              amount: (r.amountCents / 100).toFixed(2),
              date: r.date,
            })),
          },
          categoryIds,
          batch.map((r) => r.rowId)
        )
      )
    );
    for (const items of results) {
      for (const it of items) {
        if (
          typeof it?.rowId === 'string' &&
          typeof it?.categoryId === 'string' &&
          categoryById.has(it.categoryId) &&
          typeof it.confidence === 'number' &&
          it.confidence >= AI_MIN_CONFIDENCE
        ) {
          accepted.push({ rowId: it.rowId, categoryId: it.categoryId, confidence: it.confidence });
        }
      }
    }
  }
  return accepted;
}
