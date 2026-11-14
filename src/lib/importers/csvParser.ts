import { parseMoneyToCents, sanitizeCsvCell } from '../domain/money';

export interface CsvParseOptions {
  delimiter?: ',' | ';' | '\t' | 'auto';
  dateFormat?: 'DD/MM/YYYY' | 'YYYY-MM-DD' | 'auto';
  decimalSeparator?: ',' | '.' | 'auto';
  columnMap?: {
    date?: string;
    description?: string;
    amount?: string;
    credit?: string;
    debit?: string;
    fitid?: string;
    balance?: string;
  };
}

export interface CsvParsedRow {
  rowIndex: number;
  rawPayload: Record<string, string>;
  normalizedDate?: string;
  normalizedDescription?: string;
  normalizedCents?: number;
  externalFitid?: string;
  validationErrors: string[];
  isSummaryRow: boolean;
}

export interface CsvParseResult {
  detectedDelimiter: ',' | ';' | '\t';
  detectedEncoding: 'utf-8' | 'windows-1252';
  headers: string[];
  inferredMap: {
    date: string;
    description: string;
    amount?: string;
    credit?: string;
    debit?: string;
    fitid?: string;
    balance?: string;
  };
  rows: CsvParsedRow[];
  summaryLinesSkipped: number;
  dateAmbiguous: boolean;
}

export function decodeCsvBuffer(bytes: Uint8Array): { text: string; encoding: 'utf-8' | 'windows-1252' } {
  // Remove UTF-8 BOM se presente
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8' };
  }
  const utf8Text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (utf8Text.includes('\uFFFD')) {
    try {
      const win1252 = new TextDecoder('windows-1252').decode(bytes);
      return { text: win1252, encoding: 'windows-1252' };
    } catch {
      return { text: utf8Text, encoding: 'utf-8' };
    }
  }
  return { text: utf8Text, encoding: 'utf-8' };
}

export function splitCsvRecords(text: string, delimiter: ',' | ';' | '\t'): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field.trim());
      field = '';
    } else if (ch === '\r' && next === '\n') {
      row.push(field.trim());
      records.push(row);
      row = [];
      field = '';
      i += 1;
    } else if (ch === '\n' || ch === '\r') {
      row.push(field.trim());
      records.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    records.push(row);
  }

  return records.filter((r) => r.some((cell) => cell !== ''));
}

export function detectDelimiter(text: string): ',' | ';' | '\t' {
  const sampleLines = text.split(/\r?\n/).slice(0, 12).join('\n');
  const candidates: Array<',' | ';' | '\t'> = [';', ',', '\t'];
  let best: ',' | ';' | '\t' = ';';
  let bestScore = -1;

  for (const delim of candidates) {
    const records = splitCsvRecords(sampleLines, delim);
    if (records.length < 2) continue;
    const lengths = records.map((r) => r.length).filter((n) => n > 1);
    if (lengths.length === 0) continue;
    const freq = new Map<number, number>();
    for (const l of lengths) freq.set(l, (freq.get(l) ?? 0) + 1);
    const maxConsistent = Math.max(...freq.values());
    if (maxConsistent > bestScore) {
      bestScore = maxConsistent;
      best = delim;
    }
  }
  return best;
}

export function parseCivilDate(
  raw: string,
  preference: 'DD/MM/YYYY' | 'YYYY-MM-DD' | 'auto' = 'auto'
): { iso?: string; ambiguous: boolean; error?: string } {
  const s = raw.trim();
  if (!s) return { ambiguous: false, error: 'Data vazia' };

  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return { iso: `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`, ambiguous: false };
    }
    return { ambiguous: false, error: 'Data ISO inválida' };
  }

  const slashMatch = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (slashMatch) {
    const a = Number(slashMatch[1]);
    const b = Number(slashMatch[2]);
    const y = Number(slashMatch[3]);
    if (preference === 'DD/MM/YYYY' || a > 12) {
      if (b >= 1 && b <= 12 && a >= 1 && a <= 31) {
        return {
          iso: `${String(y).padStart(4, '0')}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`,
          ambiguous: false,
        };
      }
      return { ambiguous: false, error: 'Dia ou mês inválido para DD/MM/AAAA' };
    }
    // Se ambos <= 12 em modo auto e formato brasileiro é padrão, marcar como DD/MM/YYYY mas sinalizar ambiguidade se necessário
    if (a >= 1 && a <= 12 && b >= 1 && b <= 12) {
      return {
        iso: `${String(y).padStart(4, '0')}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`,
        ambiguous: a !== b,
      };
    }
  }

  return { ambiguous: false, error: `Formato de data não reconhecido: "${raw}"` };
}

function isSummaryOrTotalRow(description: string, rawValues: string[]): boolean {
  const norm = description.toLowerCase();
  if (
    /^(saldo anterior|saldo final|saldo do dia|total de entradas|total de sa[íi]das|resumo|saldo bloqueado)/.test(
      norm
    )
  ) {
    return true;
  }
  const joined = rawValues.join(' ').toLowerCase();
  if (/saldo\s+(anterior|final|atual|total)\b/.test(joined) && !/\b(pix|ted|compra|pagamento|mercado)\b/.test(joined)) {
    return true;
  }
  return false;
}

export function parseCsvStatement(input: string | Uint8Array, options: CsvParseOptions = {}): CsvParseResult {
  const decoded = typeof input === 'string' ? { text: input.replace(/^\uFEFF/, ''), encoding: 'utf-8' as const } : decodeCsvBuffer(input);
  const delimiter = options.delimiter && options.delimiter !== 'auto' ? options.delimiter : detectDelimiter(decoded.text);
  const allRecords = splitCsvRecords(decoded.text, delimiter);

  if (allRecords.length === 0) {
    return {
      detectedDelimiter: delimiter,
      detectedEncoding: decoded.encoding,
      headers: [],
      inferredMap: { date: '', description: '' },
      rows: [],
      summaryLinesSkipped: 0,
      dateAmbiguous: false,
    };
  }

  // Pular linhas introdutórias (ex: nome do banco/conta com 1 ou 2 colunas antes do cabeçalho real)
  let headerIdx = 0;
  for (let i = 0; i < Math.min(allRecords.length, 10); i++) {
    const rec = allRecords[i];
    if (rec.length >= 3) {
      const lowered = rec.map((c) => c.toLowerCase());
      const hasDateCol = lowered.some((c) => /data|date|dt/.test(c));
      const hasDescOrVal = lowered.some((c) => /descri|hist|lan[çc]amento|memo|valor|amount|cr[ée]dito|d[ée]bito/.test(c));
      if (hasDateCol && hasDescOrVal) {
        headerIdx = i;
        break;
      }
    }
  }

  const headers = allRecords[headerIdx].map((h, i) => h || `Coluna_${i + 1}`);
  const findHeader = (regex: RegExp) => headers.find((h) => regex.test(h.toLowerCase()));

  const inferredMap = {
    date: options.columnMap?.date || findHeader(/^(data|date|dt)/) || headers[0] || '',
    description:
      options.columnMap?.description ||
      findHeader(/descri|hist[óo]rico|lan[çc]amento|memo|estabelecimento|title/) ||
      headers[1] ||
      '',
    amount: options.columnMap?.amount || findHeader(/^(valor|amount|quantia|vlr)/),
    credit: options.columnMap?.credit || findHeader(/^(cr[ée]dito|entrada|credit)/),
    debit: options.columnMap?.debit || findHeader(/^(d[ée]bito|sa[íi]da|debit)/),
    fitid: options.columnMap?.fitid || findHeader(/^(id|fitid|documento|doc|identificador)/),
    balance: options.columnMap?.balance || findHeader(/^(saldo|balance)/),
  };

  const rows: CsvParsedRow[] = [];
  let summaryLinesSkipped = 0;
  let dateAmbiguous = false;

  for (let r = headerIdx + 1; r < allRecords.length; r++) {
    const rec = allRecords[r];
    if (rec.length < 2) continue;

    const rawPayload: Record<string, string> = {};
    headers.forEach((h, idx) => {
      rawPayload[h] = rec[idx] ?? '';
    });

    const rawDate = rawPayload[inferredMap.date] ?? '';
    const rawDesc = rawPayload[inferredMap.description] ?? '';

    if (isSummaryOrTotalRow(rawDesc, rec)) {
      summaryLinesSkipped += 1;
      continue;
    }

    const errors: string[] = [];
    const parsedDate = parseCivilDate(rawDate, options.dateFormat ?? 'DD/MM/YYYY');
    if (parsedDate.ambiguous) dateAmbiguous = true;
    if (parsedDate.error) errors.push(parsedDate.error);

    if (!rawDesc.trim()) errors.push('Descrição vazia');

    let cents: number | undefined;
    const decPref = options.decimalSeparator ?? 'auto';
    if (inferredMap.credit && inferredMap.debit && !inferredMap.amount) {
      const crRaw = rawPayload[inferredMap.credit] ?? '';
      const dbRaw = rawPayload[inferredMap.debit] ?? '';
      const cr = crRaw.trim() ? parseMoneyToCents(crRaw, decPref) : 0;
      const db = dbRaw.trim() ? parseMoneyToCents(dbRaw, decPref) : 0;
      if (cr === null || db === null) {
        errors.push('Valor inválido nas colunas Crédito/Débito');
      } else if (cr !== 0 && db !== 0) {
        errors.push('Conflito: linha possui Crédito e Débito simultaneamente');
      } else {
        cents = Math.abs(cr) - Math.abs(db);
        if (cents === 0) errors.push('Valor zerado');
      }
    } else if (inferredMap.amount) {
      const amtRaw = rawPayload[inferredMap.amount] ?? '';
      const parsed = parseMoneyToCents(amtRaw, decPref);
      if (parsed === null || parsed === 0) {
        errors.push(`Valor monetário inválido: "${amtRaw}"`);
      } else {
        cents = parsed;
      }
    } else {
      errors.push('Coluna de valor não mapeada');
    }

    rows.push({
      rowIndex: r + 1,
      rawPayload,
      normalizedDate: parsedDate.iso,
      normalizedDescription: rawDesc.replace(/\s+/g, ' ').trim(),
      normalizedCents: cents,
      externalFitid: inferredMap.fitid ? rawPayload[inferredMap.fitid]?.trim() || undefined : undefined,
      validationErrors: errors,
      isSummaryRow: false,
    });
  }

  return {
    detectedDelimiter: delimiter,
    detectedEncoding: decoded.encoding,
    headers,
    inferredMap,
    rows,
    summaryLinesSkipped,
    dateAmbiguous,
  };
}

export function buildSafeCsvExport(headers: string[], rows: Array<Array<string | number>>): string {
  const headerLine = headers.map((h) => sanitizeCsvCell(h)).join(';');
  const bodyLines = rows.map((row) =>
    row
      .map((cell) => {
        if (typeof cell === 'number') return String(cell);
        return sanitizeCsvCell(cell);
      })
      .join(';')
  );
  return `\uFEFF${[headerLine, ...bodyLines].join('\r\n')}`;
}
