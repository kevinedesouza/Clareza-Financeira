/**
 * Análises de longo prazo: tendência mensal (competência e saldo de fim de mês),
 * rendimento de investimentos e histórico de metas. Funções puras, sem I/O.
 */
import { WorkspaceData } from './types';
import { computeAccountBalance } from './ledger';
import { daysInMonth } from './money';

export interface MonthlyTrendPoint {
  monthKey: string; // YYYY-MM
  incomeCents: number; // receitas por competência
  expenseCents: number; // despesas por competência (já descontados estornos)
  resultCents: number; // receitas - despesas
  liquidityEndCents: number | null; // saldo das contas de liquidez no último dia do mês
}

/** Últimos `months` meses terminando em `endMonth` (YYYY-MM), do mais antigo para o mais recente. */
export function computeMonthlyTrend(data: WorkspaceData, endMonth: string, months = 12): {
  points: MonthlyTrendPoint[];
  liquidityIsPartial: boolean;
} {
  const [endY, endM] = endMonth.split('-').map(Number);
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(endY, endM - 1 - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }

  const liquidityAccounts = data.accounts.filter(
    (a) => !a.isArchived && a.includeInLiquidity && a.type !== 'credit_card' && a.type !== 'investment_manual'
  );
  let liquidityIsPartial = false;

  const points = keys.map((monthKey): MonthlyTrendPoint => {
    let income = 0;
    let expense = 0;
    for (const ev of data.events) {
      if (ev.isDeleted || !ev.competenceDate.startsWith(monthKey)) continue;
      if (ev.nature === 'income') income += ev.magnitudeCents;
      else if (ev.nature === 'expense') expense += ev.magnitudeCents;
      else if (ev.nature === 'refund') expense -= ev.magnitudeCents;
    }

    const [y, m] = monthKey.split('-').map(Number);
    const lastDay = `${monthKey}-${String(daysInMonth(y, m)).padStart(2, '0')}`;
    let liquidity = 0;
    // Contas só existem a partir da data de abertura: antes disso o saldo não se aplica ao mês.
    const active = liquidityAccounts.filter((a) => a.openingDate <= lastDay);
    let known = active.length > 0;
    for (const acc of active) {
      const s = computeAccountBalance(acc, data.movements, data.reconciliations, lastDay);
      if (!s.known || s.balanceCents === null) {
        known = false;
        liquidityIsPartial = true;
      } else {
        liquidity += s.balanceCents;
      }
    }

    return {
      monthKey,
      incomeCents: income,
      expenseCents: expense,
      resultCents: income - expense,
      liquidityEndCents: known ? liquidity : null,
    };
  });

  return { points, liquidityIsPartial };
}

export interface InvestmentReturn {
  accountId: string;
  name: string;
  capitalCents: number; // saldo inicial + aportes - resgates
  currentCents: number | null; // saldo atual (null se o saldo inicial não é conhecido)
  gainCents: number | null;
  gainPct: number | null; // null se capital <= 0
  hasContributions: boolean;
}

/**
 * Rendimento de investimentos (saldo manual). Capital = saldo inicial + aportes por transferência
 * - resgates. Rendimento = saldo atual - capital. Se o saldo foi atualizado por fora dos aportes,
 * a diferença aparece como rendimento: a tela deixa isso explícito.
 */
export function computeInvestmentReturns(data: WorkspaceData): InvestmentReturn[] {
  const investments = data.accounts.filter((a) => a.type === 'investment_manual' && !a.isArchived);
  return investments.map((acc) => {
    let contributed = 0;
    let hasContributions = false;
    for (const tg of data.transferGroups) {
      if (tg.nature === 'investment_aport' && tg.toAccountId === acc.id) {
        contributed += tg.amountCents;
        hasContributions = true;
      } else if (tg.nature === 'investment_redemption' && tg.fromAccountId === acc.id) {
        contributed -= tg.amountCents;
        hasContributions = true;
      }
    }
    const s = computeAccountBalance(acc, data.movements, data.reconciliations);
    const capital = acc.openingBalanceCents + contributed;
    const current = s.known && s.balanceCents !== null ? s.balanceCents : null;
    const gain = current === null ? null : current - capital;
    return {
      accountId: acc.id,
      name: acc.name,
      capitalCents: capital,
      currentCents: current,
      gainCents: gain,
      gainPct: gain === null || capital <= 0 ? null : Math.round((gain / capital) * 1000) / 10,
      hasContributions,
    };
  });
}
