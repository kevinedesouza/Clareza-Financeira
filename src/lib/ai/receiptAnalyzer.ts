/**
 * Leitura de nota fiscal / comprovante com a API da OpenAI (somente servidor).
 *
 * - Usa OPENAI_API_KEY e OPENAI_MODEL (o mesmo modelo de categorização), com entrada de imagem ou PDF.
 * - A IA só devolve campos estruturados; a categoria precisa existir entre as do próprio usuário.
 * - O prompt pede para ignorar CPF/CNPJ, chave de acesso e números de cartão: não são devolvidos.
 */
import { aiConfig, AiCategory } from './categorizer';
import { isCivilDateIso } from '../domain/money';

export const RECEIPT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;

export interface ReceiptAnalysis {
  amountCents: number | null;
  date: string | null;
  description: string | null;
  categoryId: string | null;
  confidence: number;
  warnings: string[];
}

const SYSTEM_PROMPT = [
  'Você lê notas fiscais, cupons e comprovantes de compra em reais (BRL) para um app de finanças pessoais.',
  'Extraia: valor total efetivamente pago (não subtotal, não troco), data da compra (YYYY-MM-DD),',
  'nome do estabelecimento ou uma descrição curta da compra, e a categoria mais adequada entre as fornecidas (use o id exato).',
  'Se um campo não estiver legível ou não existir, devolva null e reduza a confiança.',
  'Nunca devolva CPF, CNPJ, chave de acesso, número de cartão ou endereço.',
  'Confiança entre 0 e 1: alta (>= 0.8) só quando valor e data estão claramente legíveis.',
].join(' ');

const SCHEMA = (categoryIds: string[]) => ({
  type: 'object',
  additionalProperties: false,
  required: ['amount', 'date', 'description', 'categoryId', 'confidence'],
  properties: {
    amount: { anyOf: [{ type: 'number', minimum: 0 }, { type: 'null' }] },
    date: { anyOf: [{ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, { type: 'null' }] },
    description: { anyOf: [{ type: 'string', maxLength: 120 }, { type: 'null' }] },
    categoryId: categoryIds.length > 0
      ? { anyOf: [{ type: 'string', enum: categoryIds }, { type: 'null' }] }
      : { type: 'null' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
});

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

export function receiptAiAvailable(): boolean {
  return aiConfig() !== null;
}

export async function analyzeReceipt(
  contentBase64: string,
  mimeType: string,
  fileName: string,
  categories: AiCategory[]
): Promise<ReceiptAnalysis> {
  const cfg = aiConfig();
  if (!cfg) throw new Error('IA não configurada no servidor (OPENAI_API_KEY / OPENAI_MODEL).');
  if (!(RECEIPT_MIME_TYPES as readonly string[]).includes(mimeType)) {
    throw new Error('Formato não suportado. Envie JPG, PNG, WEBP ou PDF.');
  }

  const expenseCats = categories.filter((c) => c.kind === 'expense');
  const categoryIds = expenseCats.map((c) => c.id);
  const dataUrl = `data:${mimeType};base64,${contentBase64}`;
  const fileContent =
    mimeType === 'application/pdf'
      ? { type: 'input_file', filename: fileName.replace(/[^a-zA-Z0-9._-]/g, '_') || 'nota.pdf', file_data: dataUrl }
      : { type: 'input_image', image_url: dataUrl, detail: 'high' };

  const body = {
    model: cfg.model,
    input: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: `Categorias disponíveis (despesa): ${JSON.stringify(expenseCats.map((c) => ({ id: c.id, name: c.name })))}`,
          },
          fileContent,
        ],
      },
    ],
    text: {
      format: { type: 'json_schema', name: 'receipt_fields', strict: true, schema: SCHEMA(categoryIds) },
    },
    max_output_tokens: 2000,
  };

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `OpenAI HTTP ${res.status}`);

  const parsed = JSON.parse(extractText(json) || '{}');
  const warnings: string[] = [];

  let amountCents: number | null = null;
  if (typeof parsed.amount === 'number' && parsed.amount > 0) {
    amountCents = Math.round(parsed.amount * 100);
  } else {
    warnings.push('Não consegui identificar o valor total. Preencha manualmente.');
  }

  let date: string | null = null;
  if (typeof parsed.date === 'string' && isCivilDateIso(parsed.date)) {
    date = parsed.date;
  } else {
    warnings.push('Não consegui identificar a data da compra. Confira a data.');
  }

  const categoryId = typeof parsed.categoryId === 'string' && categoryIds.includes(parsed.categoryId) ? parsed.categoryId : null;
  if (!categoryId) warnings.push('Categoria não sugerida. Escolha uma categoria.');

  const confidence = typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0;
  if (confidence < 0.6) warnings.push('Leitura com baixa confiança. Revise todos os campos.');

  return {
    amountCents,
    date,
    description: typeof parsed.description === 'string' && parsed.description.trim() ? parsed.description.trim() : null,
    categoryId,
    confidence,
    warnings,
  };
}
