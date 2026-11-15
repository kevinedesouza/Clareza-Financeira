/**
 * Regras de fatura de cartão usadas na importação (funciona no navegador e no servidor).
 * - Ciclo: a compra entra na fatura cujo fechamento é a primeira data de fechamento ≥ data da compra.
 * - Parcela: "Descrição - Parcela N/M" indica que a compra tem M parcelas e esta é a N-ésima.
 * - Pagamento de fatura: não é gasto; é a quitação do cartão feita pela conta corrente.
 */
import { daysInMonth, addDaysCivil } from '../domain/money';

export interface InstallmentRef {
  base: string;
  index: number;
  total: number;
}

const INSTALLMENT_RE = /^(.*?)[\s\-–]*parcela\s+(\d{1,2})\s*\/\s*(\d{1,2})\s*$/i;

export function parseInstallment(description: string): InstallmentRef | null {
  const m = description.trim().match(INSTALLMENT_RE);
  if (!m) return null;
  const index = Number(m[2]);
  const total = Number(m[3]);
  if (!(total >= 2 && index >= 1 && index <= total)) return null;
  const base = m[1].replace(/[\s\-–]+$/, '').trim();
  if (!base) return null;
  return { base, index, total };
}

export function isCardPayment(description: string): boolean {
  return /pagamento\s+(recebido|de\s+fatura|da\s+fatura|fatura)|pagto\.?\s+fatura/i.test(description);
}

/** Data civil YYYY-MM-DD para (ano, mês, dia), ajustando o dia ao fim do mês e o mês ao ano. */
export function civil(year: number, month: number, day: number): string {
  const base = new Date(Date.UTC(year, month - 1, 1));
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth() + 1;
  const d = Math.min(day, daysInMonth(y, m));
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Desloca uma data civil em meses, mantendo o dia indicado (ajustado ao fim do mês). */
export function shiftCivil(iso: string, months: number, day: number): string {
  const [y, m] = iso.split('-').map(Number);
  return civil(y, m + months, day);
}

/** Fechamento e vencimento da fatura à qual uma compra feita em `date` pertence. */
export function invoiceFor(date: string, closingDay: number, dueDay: number): { closeDate: string; dueDate: string } {
  const [y, m, d] = date.split('-').map(Number);
  const closeShift = d <= closingDay ? 0 : 1;
  return {
    closeDate: civil(y, m + closeShift, closingDay),
    dueDate: civil(y, m + closeShift + 1, dueDay),
  };
}

/** Primeiro dia do ciclo aberto (dia seguinte ao último fechamento já ocorrido) em `today`. */
export function currentCycleStart(closingDay: number, today: string): string {
  const [y, m, d] = today.split('-').map(Number);
  const lastClose = d > closingDay ? civil(y, m, closingDay) : civil(y, m - 1, closingDay);
  return addDaysCivil(lastClose, 1);
}

/** Datas das parcelas que ainda vão cair em faturas futuras (N+1 até M). */
export function futureInstallmentDates(
  ref: InstallmentRef,
  purchaseDate: string,
  closingDay: number,
  dueDay: number
): Array<{ index: number; closeDate: string; dueDate: string }> {
  const inv = invoiceFor(purchaseDate, closingDay, dueDay);
  const out: Array<{ index: number; closeDate: string; dueDate: string }> = [];
  for (let k = ref.index + 1; k <= ref.total; k++) {
    const shift = k - ref.index;
    out.push({
      index: k,
      closeDate: shiftCivil(inv.closeDate, shift, closingDay),
      dueDate: shiftCivil(inv.dueDate, shift, dueDay),
    });
  }
  return out;
}
