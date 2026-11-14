export function formatBRL(cents: number, options?: { showSign?: boolean; masked?: boolean }): string {
  if (options?.masked) {
    return 'R$ •••••';
  }
  const safeCents = Math.round(cents);
  const abs = Math.abs(safeCents);
  const reais = Math.floor(abs / 100);
  const centPart = String(abs % 100).padStart(2, '0');
  const reaisFormatted = reais.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const base = `R$ ${reaisFormatted},${centPart}`;
  if (safeCents < 0) {
    return `−${base}`;
  }
  if (options?.showSign && safeCents > 0) {
    return `+${base}`;
  }
  return base;
}

/**
 * Converte texto monetário (pt-BR ou internacional, inclusive negativos entre parênteses) para centavos inteiros.
 * Retorna null quando inválido.
 */
export function parseMoneyToCents(raw: string, decimalPreference: ',' | '.' | 'auto' = 'auto'): number | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s) return null;

  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/^R\$\s*/i, '').replace(/\s+/g, '');
  if (s.startsWith('-') || s.startsWith('−')) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }

  if (!/^[\d.,]+$/.test(s)) return null;

  let decimalSep: ',' | '.' | null = null;
  if (decimalPreference === ',') {
    decimalSep = ',';
  } else if (decimalPreference === '.') {
    decimalSep = '.';
  } else {
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma > -1 && lastDot > -1) {
      decimalSep = lastComma > lastDot ? ',' : '.';
    } else if (lastComma > -1) {
      const after = s.length - lastComma - 1;
      decimalSep = after <= 2 ? ',' : null;
    } else if (lastDot > -1) {
      const after = s.length - lastDot - 1;
      decimalSep = after <= 2 ? '.' : null;
    }
  }

  let integerPart = s;
  let fracPart = '00';

  if (decimalSep) {
    const idx = s.lastIndexOf(decimalSep);
    if (idx !== -1) {
      integerPart = s.slice(0, idx);
      fracPart = s.slice(idx + 1);
    }
  }

  integerPart = integerPart.replace(/[.,]/g, '');
  if (!integerPart) integerPart = '0';
  if (!/^\d+$/.test(integerPart) || !/^\d*$/.test(fracPart)) return null;

  if (fracPart.length > 2) {
    // Arredondamento padrão para 2 casas decimais somente se houver dígitos extras
    const rounded = Math.round(Number(`${integerPart}.${fracPart}`) * 100);
    return negative ? -rounded : rounded;
  }

  const paddedFrac = fracPart.padEnd(2, '0');
  const cents = Number(integerPart) * 100 + Number(paddedFrac);
  if (!Number.isSafeInteger(cents)) return null;
  return negative && cents !== 0 ? -cents : cents;
}

/**
 * Divide exatamente totalCents em N parcelas inteiras sem perda ou excesso de centavos.
 * Ex: R$ 1.000,00 (100000) em 3x => [33334, 33333, 33333] (soma = 100000).
 */
export function splitInstallments(totalCents: number, count: number): number[] {
  if (!Number.isInteger(totalCents) || totalCents <= 0) {
    throw new Error('Valor total deve ser inteiro positivo em centavos');
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new Error('Quantidade de parcelas inválida');
  }
  const base = Math.floor(totalCents / count);
  const remainder = totalCents % count;
  const result: number[] = [];
  for (let i = 0; i < count; i++) {
    result.push(i < remainder ? base + 1 : base);
  }
  return result;
}

/**
 * Formata string YYYY-MM-DD para DD/MM/AAAA sem conversão de fuso UTC.
 */
export function formatCivilDateBR(isoDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate;
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

export function daysInMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

/**
 * Adiciona N meses a uma data civil YYYY-MM-DD preservando anchorDay com clamping ao último dia do mês.
 * Ex: anchorDay=31 em fevereiro => 28 ou 29.
 */
export function addMonthsCivil(isoDate: string, monthsToAdd: number, anchorDay?: number): string {
  const [yStr, mStr, dStr] = isoDate.split('-');
  const y = Number(yStr);
  const m = Number(mStr); // 1..12
  const d = anchorDay ?? Number(dStr);
  const totalMonths = y * 12 + (m - 1) + monthsToAdd;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = (totalMonths % 12) + 1;
  const maxDay = daysInMonth(targetYear, targetMonth);
  const finalDay = Math.min(d, maxDay);
  return `${String(targetYear).padStart(4, '0')}-${String(targetMonth).padStart(2, '0')}-${String(finalDay).padStart(2, '0')}`;
}

export function addDaysCivil(isoDate: string, daysToAdd: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + daysToAdd));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export function todayCivilSaoPaulo(): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * Neutraliza fórmulas perigosas em campos textuais exportados para CSV (=, +, -, @, tab, cr).
 */
export function sanitizeCsvCell(value: string): string {
  const s = String(value ?? '');
  const trimmedStart = s.replace(/^[\s]+/, '');
  const needsPrefix = /^[=+\-@\t\r]/.test(s) || /^[=+\-@]/.test(trimmedStart);
  const safe = needsPrefix ? `'${s}` : s;
  if (/[;"\n\r,]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}
