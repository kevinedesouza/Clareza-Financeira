/**
 * Worker Node.js para processamento durável de lotes CSV/OFX (PRD §12).
 * Em produção, executa como processo independente conectado ao Supabase PostgreSQL/Storage
 * com lease/bloqueio de jobs, sem bloquear requisições HTTP nem depender de aba aberta.
 */
import crypto from 'node:crypto';
import { parseCsvStatement } from '../src/lib/importers/csvParser';
import { parseOfxStatement } from '../src/lib/importers/ofxParser';
import { evaluateImportRows } from '../src/lib/importers/deduplicator';
import { AccountMovement, CategoryRule, ExternalIdentity, ImportBatch, ImportRow } from '../src/lib/domain/types';

export interface ProcessBatchInput {
  batchId: string;
  ownerId: string;
  accountId: string;
  fileName: string;
  format: 'csv' | 'ofx';
  fileBytes: Uint8Array;
  existingMovements: AccountMovement[];
  externalIdentities: ExternalIdentity[];
  rules: CategoryRule[];
  csvOptions?: {
    positiveIsExpense?: boolean;
    delimiter?: ',' | ';' | '\t' | 'auto';
    dateFormat?: 'DD/MM/YYYY' | 'YYYY-MM-DD' | 'auto';
    decimalSeparator?: ',' | '.' | 'auto';
  };
}

export function processImportPayload(input: ProcessBatchInput): {
  batch: ImportBatch;
  warnings: string[];
} {
  const MAX_BYTES = 20 * 1024 * 1024;
  const MAX_ROWS = 50000;

  if (input.fileBytes.byteLength > MAX_BYTES) {
    throw new Error('Arquivo excede o limite de 20 MB.');
  }

  const fileHash = crypto.createHash('sha256').update(input.fileBytes).digest('hex');
  const warnings: string[] = [];
  let rawRows: Omit<ImportRow, 'suggestedCategoryId' | 'candidateMovementId' | 'candidateReason' | 'decision'>[] = [];
  let institutionKey = 'csv-generic';
  let accountKey = input.accountId;

  if (input.format === 'csv') {
    const parsed = parseCsvStatement(input.fileBytes, input.csvOptions);
    if (parsed.rows.length > MAX_ROWS) {
      throw new Error(`Arquivo excede o limite de ${MAX_ROWS} linhas.`);
    }
    if (parsed.summaryLinesSkipped > 0) {
      warnings.push(`${parsed.summaryLinesSkipped} linha(s) de saldo/resumo foram ignoradas automaticamente.`);
    }
    if (parsed.dateAmbiguous) {
      warnings.push('Datas potencialmente ambíguas interpretadas como DD/MM/AAAA. Confira na revisão.');
    }
    rawRows = parsed.rows.map((r) => ({
      id: crypto.randomUUID(),
      batchId: input.batchId,
      rowIndex: r.rowIndex,
      rawPayload: r.rawPayload,
      normalizedDate: r.normalizedDate,
      normalizedDescription: r.normalizedDescription,
      normalizedCents: r.normalizedCents,
      externalFitid: r.externalFitid,
      validationErrors: r.validationErrors,
    }));
  } else {
    const rawText = new TextDecoder('utf-8').decode(input.fileBytes);
    const parsed = parseOfxStatement(rawText);
    if (parsed.securityBlocked) {
      throw new Error(parsed.securityReason || 'Arquivo OFX bloqueado por política de segurança.');
    }
    if (parsed.transactions.length > MAX_ROWS) {
      throw new Error(`Arquivo excede o limite de ${MAX_ROWS} transações.`);
    }
    warnings.push(...parsed.warnings);
    institutionKey = parsed.bankId || 'ofx-bank';
    accountKey = parsed.acctId || input.accountId;
    rawRows = parsed.transactions.map((t) => ({
      id: crypto.randomUUID(),
      batchId: input.batchId,
      rowIndex: t.rowIndex,
      rawPayload: {
        TRNTYPE: t.trnType,
        DTPOSTED: t.dtPostedRaw,
        NAME: t.name ?? '',
        MEMO: t.memo ?? '',
        FITID: t.fitid ?? '',
      },
      normalizedDate: t.normalizedDate,
      normalizedDescription: t.normalizedDescription,
      normalizedCents: t.signedCents,
      externalFitid: t.fitid,
      externalInstitution: institutionKey,
      externalAccount: accountKey,
      validationErrors: t.validationErrors,
    }));
  }

  const evaluated = evaluateImportRows(rawRows, {
    accountId: input.accountId,
    institutionKey,
    accountKey,
    existingMovements: input.existingMovements,
    externalIdentities: input.externalIdentities,
    rules: input.rules,
  });

  const validRows = evaluated.filter((r) => r.validationErrors.length === 0).length;
  const rejectedRows = evaluated.filter((r) => r.validationErrors.length > 0).length;
  const linkedRows = evaluated.filter((r) => r.decision === 'link_manual').length;
  const ignoredRows = evaluated.filter((r) => r.decision === 'already_exists').length;

  const batch: ImportBatch = {
    id: input.batchId,
    ownerId: input.ownerId,
    accountId: input.accountId,
    fileName: input.fileName,
    fileSizeBytes: input.fileBytes.byteLength,
    fileHash,
    format: input.format,
    parserVersion: '2.0.0',
    status: 'awaiting_review',
    totalRows: evaluated.length,
    validRows,
    linkedRows,
    ignoredRows,
    rejectedRows,
    rows: evaluated,
    createdAt: new Date().toISOString(),
  };

  return { batch, warnings };
}
