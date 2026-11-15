import {
  AccountMovement,
  CategoryRule,
  ExternalIdentity,
  ImportRow,
} from '../domain/types';

function daysBetweenCivil(d1: string, d2: string): number {
  return Math.abs(Math.round((Date.parse(d1) - Date.parse(d2)) / 86400000));
}

function tokenSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().replace(/[^\w\sáàãâéêíóôõúç]/g, ' ').split(/\s+/).filter((w) => w.length > 2));
  const wordsB = new Set(b.toLowerCase().replace(/[^\w\sáàãâéêíóôõúç]/g, ' ').split(/\s+/).filter((w) => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let common = 0;
  for (const w of wordsA) if (wordsB.has(w)) common += 1;
  return common / Math.max(wordsA.size, wordsB.size);
}

export function matchCategoryByRules(
  description: string,
  accountId: string,
  rules: CategoryRule[]
): string | undefined {
  const sorted = [...rules].filter((r) => r.isActive).sort((a, b) => a.priority - b.priority);
  const text = description.toLowerCase();
  for (const rule of sorted) {
    if (rule.accountId && rule.accountId !== accountId) continue;
    const patterns = rule.matchText.split('|').map((p) => p.trim().toLowerCase()).filter(Boolean);
    if (patterns.some((pat) => text.includes(pat))) {
      return rule.targetCategoryId;
    }
  }
  return undefined;
}

export interface DeduplicationContext {
  accountId: string;
  institutionKey: string;
  accountKey: string;
  existingMovements: AccountMovement[];
  externalIdentities: ExternalIdentity[];
  rules: CategoryRule[];
}

export function evaluateImportRows(
  rows: Omit<ImportRow, 'suggestedCategoryId' | 'candidateMovementId' | 'candidateReason' | 'decision'>[],
  ctx: DeduplicationContext
): ImportRow[] {
  const accountMovs = ctx.existingMovements.filter((m) => !m.isDeleted && m.accountId === ctx.accountId);

  return rows.map((row) => {
    const suggestedCategoryId = row.normalizedDescription
      ? matchCategoryByRules(row.normalizedDescription, ctx.accountId, ctx.rules)
      : undefined;

    if (row.validationErrors.length > 0) {
      return {
        ...row,
        suggestedCategoryId,
        decision: 'excluded_invalid',
      };
    }

    // 1. Verificar identidade externa confiável (instituição + conta + FITID)
    if (row.externalFitid) {
      const exactId = ctx.externalIdentities.find(
        (ei) =>
          ei.accountId === ctx.accountId &&
          ei.institutionKey === ctx.institutionKey &&
          ei.accountKey === ctx.accountKey &&
          ei.fitid === row.externalFitid
      );

      if (exactId) {
        const sameAmountAndDate =
          exactId.signedCents === row.normalizedCents && exactId.effectiveDate === row.normalizedDate;
        if (sameAmountAndDate) {
          return {
            ...row,
            suggestedCategoryId,
            candidateMovementId: exactId.movementId,
            candidateReason: 'Identidade externa (FITID) idêntica já importada nesta conta',
            decision: 'already_exists',
          };
        } else {
          // Mesmo FITID com valor/data divergentes => CONFLITO explícito (nunca sobrescrever silenciosamente)
          return {
            ...row,
            suggestedCategoryId,
            candidateMovementId: exactId.movementId,
            candidateReason: 'Conflito: mesmo FITID com valor ou data divergente do movimento existente',
            validationErrors: [
              ...row.validationErrors,
              'Conflito de FITID: valor ou data diverge do registro já existente nesta conta.',
            ],
            decision: 'review_later',
          };
        }
      }
    }

    // 2. Comparar com movimentos existentes na conta (sem excluir automaticamente compras legítimas iguais!)
    if (row.normalizedDate && row.normalizedCents !== undefined) {
      const candidate = accountMovs.find((m) => {
        if (m.signedCents !== row.normalizedCents) return false;
        const diffDays = daysBetweenCivil(m.effectiveDate, row.normalizedDate!);
        if (diffDays > 2) return false;
        const sim = tokenSimilarity(m.description, row.normalizedDescription ?? '');
        return diffDays === 0 || sim >= 0.35 || m.origin === 'manual';
      });

      if (candidate) {
        const isManualCandidate = candidate.origin === 'manual';
        // Repetição exata de um lançamento que já veio de extrato/fatura (mesma data, valor e descrição):
        // reimportar o mesmo arquivo não deve duplicar nada.
        const exactRepeat =
          !isManualCandidate &&
          candidate.effectiveDate === row.normalizedDate &&
          candidate.description.trim().toLowerCase() === (row.normalizedDescription ?? '').trim().toLowerCase();
        if (exactRepeat) {
          return {
            ...row,
            suggestedCategoryId,
            candidateMovementId: candidate.id,
            candidateReason: 'Mesmo lançamento já importado nesta conta (data, valor e descrição iguais)',
            decision: 'already_exists',
          };
        }
        return {
          ...row,
          suggestedCategoryId,
          candidateMovementId: candidate.id,
          candidateReason: isManualCandidate
            ? 'Possível correspondência com lançamento manual (mesmo valor e data próxima)'
            : 'Movimento semelhante já registrado nesta conta',
          decision: 'pending',
        };
      }
    }

    return {
      ...row,
      suggestedCategoryId,
      decision: 'import_new',
    };
  });
}
