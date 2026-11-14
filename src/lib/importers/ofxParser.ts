import { parseMoneyToCents } from '../domain/money';

export interface OfxTransactionRow {
  rowIndex: number;
  trnType: string;
  dtPostedRaw: string;
  normalizedDate?: string;
  signedCents?: number;
  fitid?: string;
  name?: string;
  memo?: string;
  normalizedDescription: string;
  correctFitid?: string;
  correctAction?: 'REPLACE' | 'DELETE' | string;
  validationErrors: string[];
}

export interface OfxParseResult {
  version: '1.x-sgml' | '2.x-xml';
  isCreditCard: boolean;
  bankId?: string;
  acctId?: string;
  acctType?: string;
  currency?: string;
  currencyBlocked: boolean;
  ledgerBalanceCents?: number;
  ledgerBalanceDate?: string;
  transactions: OfxTransactionRow[];
  warnings: string[];
  securityBlocked: boolean;
  securityReason?: string;
}

function decodeHtmlEntitiesSafe(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseOfxDate(raw: string): string | undefined {
  const clean = raw.trim();
  const match = clean.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!match) return undefined;
  const [, y, m, d] = match;
  if (Number(m) < 1 || Number(m) > 12 || Number(d) < 1 || Number(d) > 31) return undefined;
  return `${y}-${m}-${d}`;
}

function extractTagValue(block: string, tagName: string): string | undefined {
  // Suporta XML fechado <TAG>val</TAG> e SGML sem fechamento <TAG>val\n ou próximo <
  const xmlRegex = new RegExp(`<${tagName}>([^<]*)</${tagName}>`, 'i');
  const xmlMatch = block.match(xmlRegex);
  if (xmlMatch) return decodeHtmlEntitiesSafe(xmlMatch[1].trim());

  const sgmlRegex = new RegExp(`<${tagName}>([^\\r\\n<]+)`, 'i');
  const sgmlMatch = block.match(sgmlRegex);
  if (sgmlMatch) return decodeHtmlEntitiesSafe(sgmlMatch[1].trim());

  return undefined;
}

function extractStmtTrnBlocks(body: string): string[] {
  const blocks: string[] = [];
  const lower = body.toLowerCase();
  let cursor = 0;
  while (cursor < body.length) {
    const start = lower.indexOf('<stmttrn>', cursor);
    if (start === -1) break;
    const endClose = lower.indexOf('</stmttrn>', start);
    const nextStart = lower.indexOf('<stmttrn>', start + 9);
    let end: number;
    if (endClose !== -1 && (nextStart === -1 || endClose < nextStart)) {
      end = endClose + 10;
    } else if (nextStart !== -1) {
      end = nextStart;
    } else {
      end = body.length;
    }
    blocks.push(body.slice(start, end));
    cursor = end;
  }
  return blocks;
}

export function parseOfxStatement(rawContent: string): OfxParseResult {
  const warnings: string[] = [];

  // Segurança obrigatória (PRD §6.3 e §16.18): bloquear DOCTYPE/ENTITY XML externos (XXE)
  if (/<!DOCTYPE|<!ENTITY|SYSTEM\s+["']file:|SYSTEM\s+["']http/i.test(rawContent)) {
    return {
      version: '2.x-xml',
      isCreditCard: false,
      currencyBlocked: false,
      transactions: [],
      warnings: [],
      securityBlocked: true,
      securityReason: 'Arquivo XML bloqueado: declarações DOCTYPE ou entidades externas (XXE) não são permitidas.',
    };
  }

  const isXml = /<\?xml|<OFX>/i.test(rawContent) && /<\/STMTTRN>/i.test(rawContent);
  const version: OfxParseResult['version'] = isXml ? '2.x-xml' : '1.x-sgml';

  const isCreditCard = /<CCACCTFROM>|<CREDITCARDMSGSRSV1>/i.test(rawContent);
  const bankId = extractTagValue(rawContent, 'BANKID');
  const acctId = extractTagValue(rawContent, 'ACCTID');
  const acctType = extractTagValue(rawContent, 'ACCTTYPE') || (isCreditCard ? 'CREDITCARD' : undefined);
  const currency = extractTagValue(rawContent, 'CURDEF');

  const currencyBlocked = Boolean(currency && currency.toUpperCase() !== 'BRL');
  if (currencyBlocked) {
    warnings.push(`Moeda ${currency} bloqueada nesta versão; apenas BRL é aceito sem conversão automática.`);
  }
  if (!acctId) {
    warnings.push('ACCTID ausente no arquivo OFX; confirme manualmente a conta de destino.');
  }

  const balAmtRaw = extractTagValue(rawContent, 'BALAMT');
  const ledgerBalanceCents = balAmtRaw ? parseMoneyToCents(balAmtRaw, '.') ?? undefined : undefined;
  const dtAsOfRaw = extractTagValue(rawContent, 'DTASOF');
  const ledgerBalanceDate = dtAsOfRaw ? parseOfxDate(dtAsOfRaw) : undefined;

  const blocks = extractStmtTrnBlocks(rawContent);
  const transactions: OfxTransactionRow[] = blocks.map((block, idx) => {
    const trnType = extractTagValue(block, 'TRNTYPE') ?? 'OTHER';
    const dtPostedRaw = extractTagValue(block, 'DTPOSTED') ?? '';
    const trnAmtRaw = extractTagValue(block, 'TRNAMT') ?? '';
    const fitid = extractTagValue(block, 'FITID');
    const name = extractTagValue(block, 'NAME');
    const memo = extractTagValue(block, 'MEMO');
    const correctFitid = extractTagValue(block, 'CORRECTFITID');
    const correctAction = extractTagValue(block, 'CORRECTACTION');

    const normalizedDate = parseOfxDate(dtPostedRaw);
    const signedCents = parseMoneyToCents(trnAmtRaw, '.') ?? undefined;

    const parts = [name, memo].filter((p): p is string => Boolean(p && p.trim()));
    const uniqueParts = Array.from(new Set(parts.map((p) => p.trim())));
    const normalizedDescription = uniqueParts.join(' — ') || trnType;

    const errors: string[] = [];
    if (currencyBlocked) errors.push(`Moeda ${currency} não suportada`);
    if (!normalizedDate) errors.push(`Data DTPOSTED inválida: "${dtPostedRaw}"`);
    if (signedCents === undefined || signedCents === 0) errors.push(`Valor TRNAMT inválido: "${trnAmtRaw}"`);
    if (!fitid) warnings.push(`Linha ${idx + 1} sem FITID; será avaliada por heurística na revisão.`);
    if (correctFitid) {
      errors.push(`Correção/cancelamento OFX (CORRECTFITID ${correctFitid}) requer revisão explícita.`);
    }

    return {
      rowIndex: idx + 1,
      trnType,
      dtPostedRaw,
      normalizedDate,
      signedCents,
      fitid,
      name,
      memo,
      normalizedDescription,
      correctFitid,
      correctAction,
      validationErrors: errors,
    };
  });

  return {
    version,
    isCreditCard,
    bankId,
    acctId,
    acctType,
    currency,
    currencyBlocked,
    ledgerBalanceCents,
    ledgerBalanceDate,
    transactions,
    warnings,
    securityBlocked: false,
  };
}
