import {
  Account,
  AccountMovement,
  Budget,
  Card,
  Category,
  FinancialEvent,
  Goal,
  Obligation,
  Recurrence,
  Settlement,
  WorkspaceData,
} from './types';
import { addDaysCivil, addMonthsCivil, splitInstallments } from './money';

export interface AccountBalanceSummary {
  account: Account;
  balanceCents: number | null; // null quando abertura desconhecida (não validado)
  rawComputedCents: number;
  known: boolean;
  lastMovementDate?: string;
  reconciledUntil?: string;
  hasDivergence: boolean;
}

export interface CategorySpendItem {
  categoryId: string;
  categoryName: string;
  totalCents: number;
  previousCents: number | null;
  deltaCents: number | null;
  deltaPct: number | null;
  eventIds: string[];
}

export interface CashEvolutionPoint {
  date: string;
  realizedCents: number | null;
  projectedCents: number | null;
  inflowCents: number;
  outflowCents: number;
}

export interface DashboardMetrics {
  periodStart: string;
  periodEnd: string;
  liquidityBalanceCents: number;
  liquidityIsPartial: boolean;
  cardDebtCents: number; // faturas em aberto de cartões (não entram no saldo em contas)
  freeAfterReservesCents: number;
  totalReservedInGoalsCents: number;
  incomeReceivedCents: number;
  incomeMovementIds: string[];
  expensesPaidCents: number;
  expenseMovementIds: string[];
  operatingCashResultCents: number;
  liquidityDeltaCents: number;
  savingsRatePct: number | null; // null se receitas <= 0
  commitmentRatePct: number | null; // obrigações / receitas previstas
  netWorthCents: number;
  netWorthIsPartial: boolean;
  openPayableCents: number;
  openReceivableCents: number;
  projected30dCents: number;
  projected60dCents: number;
  projected90dCents: number;
  categorySpending: CategorySpendItem[];
  evolutionSeries: CashEvolutionPoint[];
  coverage: {
    unclassifiedCount: number;
    pendingReviewCount: number;
    pendingImportBatches: number;
    unknownOpeningAccounts: number;
    divergentReconciliations: number;
  };
}

export function isLiquidityAccount(acc: Account): boolean {
  return !acc.isArchived && acc.includeInLiquidity && acc.type !== 'credit_card' && acc.type !== 'investment_manual';
}

export function computeAccountBalance(
  account: Account,
  movements: AccountMovement[],
  reconciliations: WorkspaceData['reconciliations'],
  cutoffDate?: string
): AccountBalanceSummary {
  const effectiveMovs = movements.filter(
    (m) =>
      !m.isDeleted &&
      m.accountId === account.id &&
      m.effectiveDate >= account.openingDate &&
      (!cutoffDate || m.effectiveDate <= cutoffDate)
  );

  const delta = effectiveMovs.reduce((acc, m) => acc + m.signedCents, 0);
  const rawComputed = account.openingBalanceCents + delta;
  const lastMovementDate = effectiveMovs
    .map((m) => m.effectiveDate)
    .sort()
    .at(-1);

  const accReconciliations = reconciliations
    .filter((r) => r.accountId === account.id && r.status !== 'invalidated')
    .sort((a, b) => b.cutoffDate.localeCompare(a.cutoffDate));
  const latestRec = accReconciliations[0];

  return {
    account,
    balanceCents: account.openingBalanceKnown ? rawComputed : null,
    rawComputedCents: rawComputed,
    known: account.openingBalanceKnown,
    lastMovementDate,
    reconciledUntil: latestRec?.status === 'matched' ? latestRec.cutoffDate : undefined,
    hasDivergence: latestRec?.status === 'divergent' || effectiveMovs.some((m) => m.reconciliationStatus === 'divergent'),
  };
}

/**
 * Saldo do cartão de crédito:
 * Compras reduzem saldo contábil assinado; pagamentos aumentam.
 * Dívida positiva exibida = max(0, -signedBalance); Crédito a favor = max(0, signedBalance).
 */
export function computeCardDebtSummary(
  card: Card,
  account: Account,
  movements: AccountMovement[],
  obligations: Obligation[],
  settlements: Settlement[]
) {
  const cardMovs = movements.filter((m) => !m.isDeleted && m.accountId === account.id);
  const signedBalance = account.openingBalanceCents + cardMovs.reduce((acc, m) => acc + m.signedCents, 0);
  const debtCents = signedBalance < 0 ? -signedBalance : 0;
  const creditInFavorCents = signedBalance > 0 ? signedBalance : 0;

  const futureInstallmentsCents = obligations
    .filter((o) => o.cardId === card.id && o.status !== 'canceled' && o.status !== 'settled')
    .reduce((acc, o) => acc + computeObligationOpenCents(o, settlements), 0);

  return {
    signedBalanceCents: signedBalance,
    debtCents,
    creditInFavorCents,
    futureInstallmentsCents,
    availableEstimatedCents: Math.max(0, card.creditLimitCents - debtCents),
  };
}

export function computeObligationOpenCents(obligation: Obligation, settlements: Settlement[]): number {
  if (obligation.status === 'canceled') return 0;
  const paid = settlements
    .filter((s) => s.obligationId === obligation.id)
    .reduce((acc, s) => acc + s.allocatedCents, 0);
  return Math.max(0, obligation.originalCents - obligation.canceledCents - paid);
}

export function deriveObligationStatus(
  obligation: Obligation,
  settlements: Settlement[],
  referenceDate: string
): Obligation['status'] | 'overdue' {
  if (obligation.status === 'canceled') return 'canceled';
  const open = computeObligationOpenCents(obligation, settlements);
  if (open === 0) return 'settled';
  if (obligation.dueDate < referenceDate) return 'overdue';
  const paid = settlements
    .filter((s) => s.obligationId === obligation.id)
    .reduce((acc, s) => acc + s.allocatedCents, 0);
  return paid > 0 ? 'partially_settled' : 'expected';
}

export function generateRecurrenceDates(recurrence: Recurrence, untilDate: string): string[] {
  if (!recurrence.isActive) return [];
  const dates: string[] = [];
  const hardEnd = recurrence.endDate && recurrence.endDate < untilDate ? recurrence.endDate : untilDate;
  let current = recurrence.startDate;
  let step = 0;

  while (current <= hardEnd && step < 240) {
    dates.push(current);
    step += 1;
    if (recurrence.frequency === 'weekly') {
      current = addDaysCivil(recurrence.startDate, step * 7);
    } else if (recurrence.frequency === 'monthly') {
      current = addMonthsCivil(recurrence.startDate, step, recurrence.anchorDay);
    } else {
      current = addMonthsCivil(recurrence.startDate, step * 12, recurrence.anchorDay);
    }
  }
  return dates;
}

export function computeDashboardMetrics(
  data: WorkspaceData,
  filters: {
    periodStart: string;
    periodEnd: string;
    accountIds?: string[];
    categoryIds?: string[];
    projectId?: string;
    todayDate: string;
  }
): DashboardMetrics {
  const { periodStart, periodEnd, accountIds, categoryIds, projectId, todayDate } = filters;
  const accountMap = new Map(data.accounts.map((a) => [a.id, a]));
  const eventMap = new Map(data.events.map((e) => [e.id, e]));
  const transferMap = new Map(data.transferGroups.map((t) => [t.id, t]));
  const categoryMap = new Map(data.categories.map((c) => [c.id, c]));

  const filteredAccounts = data.accounts.filter(
    (a) => !a.isArchived && (!accountIds || accountIds.length === 0 || accountIds.includes(a.id))
  );

  // 1. Saldo líquido das contas de liquidez no corte periodEnd
  const liquidityAccounts = filteredAccounts.filter(isLiquidityAccount);
  let liquidityBalanceCents = 0;
  let liquidityIsPartial = false;
  let unknownOpeningAccounts = 0;

  for (const acc of liquidityAccounts) {
    const summary = computeAccountBalance(acc, data.movements, data.reconciliations, periodEnd);
    if (!summary.known) {
      liquidityIsPartial = true;
      unknownOpeningAccounts += 1;
    } else {
      liquidityBalanceCents += summary.balanceCents ?? 0;
    }
  }

  // Saldo inicial da liquidez antes do período
  let initialLiquidityCents = 0;
  const dayBeforeStart = addDaysCivil(periodStart, -1);
  for (const acc of liquidityAccounts) {
    if (acc.openingBalanceKnown) {
      if (acc.openingDate > dayBeforeStart) {
        initialLiquidityCents += acc.openingBalanceCents;
      } else {
        const s = computeAccountBalance(acc, data.movements, data.reconciliations, dayBeforeStart);
        initialLiquidityCents += s.balanceCents ?? 0;
      }
    }
  }

  // 2. Movimentos de caixa realizado no período (apenas contas de liquidez selecionadas)
  const liquidityIds = new Set(liquidityAccounts.map((a) => a.id));
  const periodMovements = data.movements.filter((m) => {
    if (m.isDeleted) return false;
    if (!liquidityIds.has(m.accountId)) return false;
    if (m.effectiveDate < periodStart || m.effectiveDate > periodEnd) return false;
    if (projectId) {
      const ev = m.eventId ? eventMap.get(m.eventId) : undefined;
      if (ev?.projectId !== projectId) return false;
    }
    if (categoryIds && categoryIds.length > 0) {
      const ev = m.eventId ? eventMap.get(m.eventId) : undefined;
      if (!ev?.categoryId || !categoryIds.includes(ev.categoryId)) return false;
    }
    return true;
  });

  let incomeReceivedCents = 0;
  const incomeMovementIds: string[] = [];
  let expensesPaidCents = 0;
  const expenseMovementIds: string[] = [];

  for (const mov of periodMovements) {
    const tg = mov.transferGroupId ? transferMap.get(mov.transferGroupId) : undefined;
    const ev = mov.eventId ? eventMap.get(mov.eventId) : undefined;

    if (tg) {
      // Transferência interna entre contas líquidas NÃO é receita nem despesa operacional
      if (tg.nature === 'internal_transfer') {
        continue;
      }
      // Pagamento de fatura de cartão sai do caixa uma vez como despesa paga
      if (tg.nature === 'card_payment' && mov.signedCents < 0) {
        expensesPaidCents += Math.abs(mov.signedCents);
        expenseMovementIds.push(mov.id);
      }
      // Aporte/resgate de principal ou desembolso/principal de empréstimo não entra em receita/despesa operacional
      continue;
    }

    if (ev) {
      if (ev.nature === 'opening' || ev.nature === 'transfer' || ev.nature === 'financing' || ev.nature === 'investment_flow') {
        continue;
      }
      if (ev.nature === 'income' && mov.signedCents > 0) {
        incomeReceivedCents += mov.signedCents;
        incomeMovementIds.push(mov.id);
      } else if ((ev.nature === 'expense' || ev.nature === 'refund') && mov.signedCents < 0) {
        expensesPaidCents += Math.abs(mov.signedCents);
        expenseMovementIds.push(mov.id);
      } else if (ev.nature === 'refund' && mov.signedCents > 0) {
        // Estorno em conta corrente reduz despesa paga no período do estorno
        expensesPaidCents -= mov.signedCents;
        expenseMovementIds.push(mov.id);
      }
    } else {
      // Movimento importado ainda sem evento vinculado: tratar temporariamente pelo sinal exceto se marcado
      if (mov.signedCents > 0) {
        incomeReceivedCents += mov.signedCents;
        incomeMovementIds.push(mov.id);
      } else if (mov.signedCents < 0) {
        expensesPaidCents += Math.abs(mov.signedCents);
        expenseMovementIds.push(mov.id);
      }
    }
  }

  const operatingCashResultCents = incomeReceivedCents - expensesPaidCents;
  const liquidityDeltaCents = liquidityBalanceCents - initialLiquidityCents;
  const savingsRatePct =
    incomeReceivedCents > 0 ? Math.round((operatingCashResultCents / incomeReceivedCents) * 1000) / 10 : null;

  // 3. Gastos por competência (eventos econômicos líquidos de estornos; NÃO inclui pagamento de fatura!)
  const durationDays = Math.max(
    1,
    Math.round((Date.parse(periodEnd) - Date.parse(periodStart)) / (1000 * 60 * 60 * 24)) + 1
  );
  const prevEnd = addDaysCivil(periodStart, -1);
  const prevStart = addDaysCivil(prevEnd, -(durationDays - 1));

  const accumulateCompetenceByCategory = (start: string, end: string) => {
    const totals = new Map<string, { cents: number; eventIds: string[] }>();
    for (const ev of data.events) {
      if (ev.isDeleted) continue;
      if (ev.competenceDate < start || ev.competenceDate > end) continue;
      if (ev.nature !== 'expense' && ev.nature !== 'refund') continue;
      if (projectId && ev.projectId !== projectId) continue;

      const sign = ev.nature === 'refund' ? -1 : 1;

      if (ev.allocations && ev.allocations.length > 0) {
        for (const alloc of ev.allocations) {
          const catId = alloc.categoryId ?? 'uncategorized';
          if (categoryIds && categoryIds.length > 0 && !categoryIds.includes(catId)) continue;
          const prev = totals.get(catId) ?? { cents: 0, eventIds: [] };
          prev.cents += sign * alloc.amountCents;
          prev.eventIds.push(ev.id);
          totals.set(catId, prev);
        }
      } else {
        const catId = ev.categoryId ?? 'uncategorized';
        if (categoryIds && categoryIds.length > 0 && !categoryIds.includes(catId)) continue;
        const prev = totals.get(catId) ?? { cents: 0, eventIds: [] };
        prev.cents += sign * ev.magnitudeCents;
        prev.eventIds.push(ev.id);
        totals.set(catId, prev);
      }
    }
    return totals;
  };

  const currCats = accumulateCompetenceByCategory(periodStart, periodEnd);
  const prevCats = accumulateCompetenceByCategory(prevStart, prevEnd);

  const categorySpending: CategorySpendItem[] = Array.from(currCats.entries())
    .map(([categoryId, info]) => {
      const prevInfo = prevCats.get(categoryId);
      const prevCents = prevInfo ? prevInfo.cents : null;
      const deltaCents = prevCents !== null ? info.cents - prevCents : null;
      const deltaPct =
        prevCents !== null && prevCents > 0
          ? Math.round(((info.cents - prevCents) / prevCents) * 1000) / 10
          : null;
      return {
        categoryId,
        categoryName: categoryId === 'uncategorized' ? 'Sem categoria' : categoryMap.get(categoryId)?.name ?? 'Outros',
        totalCents: info.cents,
        previousCents: prevCents,
        deltaCents,
        deltaPct,
        eventIds: Array.from(new Set(info.eventIds)),
      };
    })
    .filter((item) => item.totalCents !== 0)
    .sort((a, b) => b.totalCents - a.totalCents);

  // 4. Obrigações em aberto e projeção 30 / 60 / 90 dias
  let openPayableCents = 0;
  let openReceivableCents = 0;
  let payablePeriodCents = 0;
  let receivablePeriodCents = 0;

  for (const ob of data.obligations) {
    if (ob.status === 'canceled') continue;
    const open = computeObligationOpenCents(ob, data.settlements);
    if (open <= 0) continue;
    if (ob.direction === 'payable') {
      openPayableCents += open;
      if (ob.dueDate >= periodStart && ob.dueDate <= periodEnd) payablePeriodCents += open;
    } else {
      openReceivableCents += open;
      if (ob.dueDate >= periodStart && ob.dueDate <= periodEnd) receivablePeriodCents += open;
    }
  }

  const commitmentRatePct =
    receivablePeriodCents > 0 ? Math.round((payablePeriodCents / receivablePeriodCents) * 1000) / 10 : null;

  const projectAtDays = (days: number) => {
    const horizon = addDaysCivil(todayDate, days);
    let netFuture = 0;
    for (const ob of data.obligations) {
      if (ob.status === 'canceled' || ob.status === 'settled') continue;
      if (ob.dueDate > horizon) continue;
      // Para faturas/parcelas de cartão, só projeta obrigações de fatura consolidada ou contas a pagar de caixa;
      // aqui modelamos obrigações como compromissos de caixa sem duplicar compras no cartão
      if (ob.cardId && !ob.description.toLowerCase().includes('fatura')) {
        // Parcelas futuras compõem a fatura futura na data de vencimento do cartão
        netFuture -= computeObligationOpenCents(ob, data.settlements);
        continue;
      }
      const open = computeObligationOpenCents(ob, data.settlements);
      netFuture += ob.direction === 'receivable' ? open : -open;
    }
    return liquidityBalanceCents + netFuture;
  };

  // 5. Patrimônio acompanhado = ativos conhecidos - passivos conhecidos
  let assetsCents = liquidityBalanceCents;
  let netWorthIsPartial = liquidityIsPartial;
  for (const acc of filteredAccounts) {
    if (acc.type === 'investment_manual') {
      const s = computeAccountBalance(acc, data.movements, data.reconciliations, periodEnd);
      if (!s.known) netWorthIsPartial = true;
      else assetsCents += s.balanceCents ?? 0;
    }
  }
  let liabilitiesCents = 0;
  for (const card of data.cards) {
    if (card.isArchived) continue;
    const acc = accountMap.get(card.accountId);
    if (!acc) continue;
    const summary = computeCardDebtSummary(card, acc, data.movements, data.obligations, data.settlements);
    liabilitiesCents += summary.debtCents;
  }

  // 6. Reservas virtuais em Metas
  const totalReservedInGoalsCents = data.goals.reduce((acc, g) => acc + g.reservedCents, 0);
  const freeAfterReservesCents = liquidityBalanceCents - totalReservedInGoalsCents;

  // 7. Série de evolução de caixa (realizado até todayDate + 30 dias de projeção tracejada sem datas duplicadas)
  const evolutionSeries: CashEvolutionPoint[] = [];
  const realizedCutoff = periodEnd < todayDate ? periodEnd : todayDate;
  const allDatesInRange: string[] = [];
  let cursor = periodStart;
  let safety = 0;
  while (cursor <= realizedCutoff && safety < 95) {
    allDatesInRange.push(cursor);
    cursor = addDaysCivil(cursor, 1);
    safety += 1;
  }

  let runningBalance = initialLiquidityCents;
  for (let idx = 0; idx < allDatesInRange.length; idx++) {
    const dt = allDatesInRange[idx];
    const dayMovs = data.movements.filter(
      (m) => !m.isDeleted && liquidityIds.has(m.accountId) && m.effectiveDate === dt
    );
    const inflow = dayMovs.filter((m) => m.signedCents > 0).reduce((s, m) => s + m.signedCents, 0);
    const outflow = dayMovs.filter((m) => m.signedCents < 0).reduce((s, m) => s + Math.abs(m.signedCents), 0);
    runningBalance += inflow - outflow;
    const isBridgePoint = idx === allDatesInRange.length - 1 && periodEnd >= todayDate;
    evolutionSeries.push({
      date: dt,
      realizedCents: runningBalance,
      projectedCents: isBridgePoint ? runningBalance : null,
      inflowCents: inflow,
      outflowCents: outflow,
    });
  }

  // Acrescentar pontos futuros estritamente após todayDate até +30 dias
  if (periodEnd >= todayDate) {
    let projBalance = liquidityBalanceCents;
    for (let d = 5; d <= 30; d += 5) {
      const dt = addDaysCivil(todayDate, d);
      const prevDt = addDaysCivil(todayDate, d - 5);
      const dueObs = data.obligations.filter(
        (o) => o.status !== 'canceled' && o.status !== 'settled' && o.dueDate > prevDt && o.dueDate <= dt
      );
      let delta = 0;
      for (const o of dueObs) {
        const open = computeObligationOpenCents(o, data.settlements);
        delta += o.direction === 'receivable' ? open : -open;
      }
      projBalance += delta;
      evolutionSeries.push({
        date: dt,
        realizedCents: null,
        projectedCents: projBalance,
        inflowCents: delta > 0 ? delta : 0,
        outflowCents: delta < 0 ? Math.abs(delta) : 0,
      });
    }
  }

  // 8. Cobertura e qualidade dos dados
  const unclassifiedCount = data.movements.filter(
    (m) => !m.isDeleted && m.reviewStatus === 'pending_category'
  ).length;
  const pendingReviewCount = data.movements.filter(
    (m) => !m.isDeleted && m.reviewStatus === 'pending_review'
  ).length;
  const pendingImportBatches = data.importBatches.filter(
    (b) => b.status === 'awaiting_review' || b.status === 'parsing'
  ).length;
  const divergentReconciliations = data.reconciliations.filter((r) => r.status === 'divergent').length;

  return {
    periodStart,
    periodEnd,
    liquidityBalanceCents,
    liquidityIsPartial,
    cardDebtCents: liabilitiesCents,
    freeAfterReservesCents,
    totalReservedInGoalsCents,
    incomeReceivedCents,
    incomeMovementIds,
    expensesPaidCents,
    expenseMovementIds,
    operatingCashResultCents,
    liquidityDeltaCents,
    savingsRatePct,
    commitmentRatePct,
    netWorthCents: assetsCents - liabilitiesCents,
    netWorthIsPartial,
    openPayableCents,
    openReceivableCents,
    projected30dCents: projectAtDays(30),
    projected60dCents: projectAtDays(60),
    projected90dCents: projectAtDays(90),
    categorySpending,
    evolutionSeries,
    coverage: {
      unclassifiedCount,
      pendingReviewCount,
      pendingImportBatches,
      unknownOpeningAccounts,
      divergentReconciliations,
    },
  };
}

export function evaluateBudget(
  budget: Budget,
  events: FinancialEvent[],
  categories: Category[]
): { spentCents: number; pct: number; excessCents: number; status: 'ok' | 'warning' | 'exceeded' } {
  // Evita dupla contagem de categoria pai + subcategorias
  const childIds = new Set(categories.filter((c) => c.parentId === budget.categoryId).map((c) => c.id));
  const targetIds = new Set([budget.categoryId, ...childIds]);

  let spentCents = 0;
  for (const ev of events) {
    if (ev.isDeleted) continue;
    if (!ev.competenceDate.startsWith(budget.monthKey)) continue;
    if (ev.nature !== 'expense' && ev.nature !== 'refund') continue;
    const sign = ev.nature === 'refund' ? -1 : 1;

    if (ev.allocations && ev.allocations.length > 0) {
      for (const a of ev.allocations) {
        if (a.categoryId && targetIds.has(a.categoryId)) {
          spentCents += sign * a.amountCents;
        }
      }
    } else if (ev.categoryId && targetIds.has(ev.categoryId)) {
      spentCents += sign * ev.magnitudeCents;
    }
  }

  const pct = budget.limitCents > 0 ? Math.round((spentCents / budget.limitCents) * 1000) / 10 : 0;
  const excessCents = Math.max(0, spentCents - budget.limitCents);
  const status = pct >= 100 ? 'exceeded' : pct >= budget.alertThresholdPct ? 'warning' : 'ok';

  return { spentCents, pct, excessCents, status };
}

export function createDefaultCategories(ownerId: string): Category[] {
  const expenses = [
    'Moradia',
    'Alimentação',
    'Mercado',
    'Transporte',
    'Saúde',
    'Educação',
    'Filhos/Família',
    'Lazer',
    'Assinaturas',
    'Compras',
    'Serviços',
    'Tarifas/Juros',
    'Outros',
  ];
  const incomes = ['Salário', 'Serviços', 'Vendas', 'Rendimentos'];

  return [
    ...expenses.map((name, idx) => ({
      id: `cat-exp-${idx + 1}`,
      ownerId,
      name,
      kind: 'expense' as const,
      essentiality: (['Moradia', 'Alimentação', 'Mercado', 'Transporte', 'Saúde', 'Educação'].includes(name)
        ? 'essential'
        : 'discretionary') as 'essential' | 'discretionary',
      isArchived: false,
    })),
    ...incomes.map((name, idx) => ({
      id: `cat-inc-${idx + 1}`,
      ownerId,
      name,
      kind: 'income' as const,
      essentiality: 'unassigned' as const,
      isArchived: false,
    })),
  ];
}

export function createEmptyWorkspace(ownerId: string, email: string, displayName: string): WorkspaceData {
  return {
    profile: {
      id: ownerId,
      email,
      displayName,
      currency: 'BRL',
      timezone: 'America/Sao_Paulo',
      theme: 'system',
      privacyMode: false,
    },
    accounts: [],
    cards: [],
    categories: createDefaultCategories(ownerId),
    projects: [],
    events: [],
    movements: [],
    transferGroups: [],
    recurrences: [],
    installmentPlans: [],
    obligations: [],
    settlements: [],
    importBatches: [],
    externalIdentities: [],
    sourceLinks: [],
    importProfiles: [],
    reconciliations: [],
    budgets: [],
    goals: [],
    goalContributions: [],
    categoryRules: [],
    auditLogs: [],
    dismissedInsightIds: [],
  };
}

/**
 * Constrói o Cenário de Referência exato da seção 16 do PRD:
 * Abertura: Conta A R$ 1.000; Conta B R$ 200.
 * Receita R$ 3.000 em A; mercado R$ 200 pago por A; transferência R$ 500 A->B;
 * compra cartão R$ 300; pagamento da fatura R$ 300 por A.
 */
export function buildReferenceScenarioWorkspace(payCardBill: boolean): WorkspaceData {
  const ownerId = 'ref-owner';
  const base = createEmptyWorkspace(ownerId, 'referencia@clareza.local', 'Cenário de Referência');
  base.accounts = [
    {
      id: 'acc-a',
      ownerId,
      name: 'Conta A',
      institution: 'Banco Alfa',
      type: 'checking',
      currency: 'BRL',
      maskedIdentifier: '•••• 1042',
      color: '#2955D9',
      openingBalanceCents: 100000,
      openingDate: '2026-11-01',
      openingBalanceKnown: true,
      includeInLiquidity: true,
      isArchived: false,
      version: 1,
    },
    {
      id: 'acc-b',
      ownerId,
      name: 'Conta B',
      institution: 'Banco Beta',
      type: 'savings',
      currency: 'BRL',
      maskedIdentifier: '•••• 8821',
      color: '#087F5B',
      openingBalanceCents: 20000,
      openingDate: '2026-11-01',
      openingBalanceKnown: true,
      includeInLiquidity: true,
      isArchived: false,
      version: 1,
    },
    {
      id: 'acc-card',
      ownerId,
      name: 'Cartão Principal',
      institution: 'Banco Alfa',
      type: 'credit_card',
      currency: 'BRL',
      maskedIdentifier: '•••• 4490',
      color: '#172554',
      openingBalanceCents: 0,
      openingDate: '2026-11-01',
      openingBalanceKnown: true,
      includeInLiquidity: false,
      isArchived: false,
      version: 1,
    },
  ];
  base.cards = [
    {
      id: 'card-1',
      ownerId,
      accountId: 'acc-card',
      name: 'Cartão Principal',
      maskedLast4: '4490',
      creditLimitCents: 500000,
      limitVerified: false,
      closingDay: 10,
      dueDay: 18,
      payingAccountId: 'acc-a',
      isArchived: false,
      version: 1,
    },
  ];

  base.events = [
    {
      id: 'ev-inc',
      ownerId,
      nature: 'income',
      description: 'Salário mensal',
      competenceDate: '2026-11-05',
      magnitudeCents: 300000,
      currency: 'BRL',
      categoryId: 'cat-inc-1',
      tags: [],
      isDeleted: false,
      version: 1,
    },
    {
      id: 'ev-mkt',
      ownerId,
      nature: 'expense',
      description: 'Mercado Central',
      competenceDate: '2026-11-06',
      magnitudeCents: 20000,
      currency: 'BRL',
      categoryId: 'cat-exp-3',
      tags: [],
      isDeleted: false,
      version: 1,
    },
    {
      id: 'ev-card-buy',
      ownerId,
      nature: 'expense',
      description: 'Compra no cartão — Farmácia & Casa',
      competenceDate: '2026-11-08',
      magnitudeCents: 30000,
      currency: 'BRL',
      categoryId: 'cat-exp-5',
      tags: [],
      isDeleted: false,
      version: 1,
    },
  ];

  base.transferGroups = [
    {
      id: 'tg-1',
      ownerId,
      nature: 'internal_transfer',
      fromAccountId: 'acc-a',
      toAccountId: 'acc-b',
      amountCents: 50000,
      effectiveDate: '2026-11-07',
      description: 'Reserva para Conta B',
    },
  ];

  base.movements = [
    {
      id: 'mov-inc',
      ownerId,
      accountId: 'acc-a',
      eventId: 'ev-inc',
      signedCents: 300000,
      effectiveDate: '2026-11-05',
      description: 'Salário mensal',
      origin: 'manual',
      reviewStatus: 'reviewed',
      reconciliationStatus: 'reconciled',
      isDeleted: false,
      version: 1,
      createdAt: '2026-11-05T12:00:00Z',
    },
    {
      id: 'mov-mkt',
      ownerId,
      accountId: 'acc-a',
      eventId: 'ev-mkt',
      signedCents: -20000,
      effectiveDate: '2026-11-06',
      description: 'Mercado Central',
      origin: 'manual',
      reviewStatus: 'reviewed',
      reconciliationStatus: 'reconciled',
      isDeleted: false,
      version: 1,
      createdAt: '2026-11-06T12:00:00Z',
    },
    {
      id: 'mov-tr-out',
      ownerId,
      accountId: 'acc-a',
      transferGroupId: 'tg-1',
      signedCents: -50000,
      effectiveDate: '2026-11-07',
      description: 'Reserva para Conta B (Saída)',
      origin: 'system_transfer',
      reviewStatus: 'reviewed',
      reconciliationStatus: 'reconciled',
      isDeleted: false,
      version: 1,
      createdAt: '2026-11-07T12:00:00Z',
    },
    {
      id: 'mov-tr-in',
      ownerId,
      accountId: 'acc-b',
      transferGroupId: 'tg-1',
      signedCents: 50000,
      effectiveDate: '2026-11-07',
      description: 'Reserva para Conta B (Entrada)',
      origin: 'system_transfer',
      reviewStatus: 'reviewed',
      reconciliationStatus: 'reconciled',
      isDeleted: false,
      version: 1,
      createdAt: '2026-11-07T12:00:00Z',
    },
    {
      id: 'mov-card-buy',
      ownerId,
      accountId: 'acc-card',
      eventId: 'ev-card-buy',
      signedCents: -30000,
      effectiveDate: '2026-11-08',
      description: 'Compra no cartão — Farmácia & Casa',
      origin: 'manual',
      reviewStatus: 'reviewed',
      reconciliationStatus: 'unreconciled',
      isDeleted: false,
      version: 1,
      createdAt: '2026-11-08T12:00:00Z',
    },
  ];

  if (payCardBill) {
    base.transferGroups.push({
      id: 'tg-bill',
      ownerId,
      nature: 'card_payment',
      fromAccountId: 'acc-a',
      toAccountId: 'acc-card',
      amountCents: 30000,
      effectiveDate: '2026-11-12',
      description: 'Pagamento fatura Cartão Principal',
    });
    base.movements.push(
      {
        id: 'mov-bill-out',
        ownerId,
        accountId: 'acc-a',
        transferGroupId: 'tg-bill',
        signedCents: -30000,
        effectiveDate: '2026-11-12',
        description: 'Pagamento fatura Cartão Principal (Saída)',
        origin: 'system_transfer',
        reviewStatus: 'reviewed',
        reconciliationStatus: 'reconciled',
        isDeleted: false,
        version: 1,
        createdAt: '2026-11-12T12:00:00Z',
      },
      {
        id: 'mov-bill-in',
        ownerId,
        accountId: 'acc-card',
        transferGroupId: 'tg-bill',
        signedCents: 30000,
        effectiveDate: '2026-11-12',
        description: 'Pagamento fatura Cartão Principal (Entrada)',
        origin: 'system_transfer',
        reviewStatus: 'reviewed',
        reconciliationStatus: 'reconciled',
        isDeleted: false,
        version: 1,
        createdAt: '2026-11-12T12:00:00Z',
      }
    );
  }

  return base;
}

/**
 * Ambiente Demonstrativo completo e isolado (PRD §1 e §9), com dados sintéticos coerentes
 * para inspeção de todos os módulos P0 e P1.
 */
export function buildDemoWorkspace(): WorkspaceData {
  const ownerId = 'demo-user';
  const base = createEmptyWorkspace(ownerId, 'demonstracao@clareza.local', 'Titular (Ambiente Demonstrativo)');

  base.accounts = [
    {
      id: 'demo-acc-corrente',
      ownerId,
      name: 'Conta Corrente Principal',
      institution: 'Banco Itaú',
      type: 'checking',
      currency: 'BRL',
      maskedIdentifier: '•••• 4521',
      color: '#2955D9',
      openingBalanceCents: 425000,
      openingDate: '2026-10-01',
      openingBalanceKnown: true,
      includeInLiquidity: true,
      isArchived: false,
      version: 1,
    },
    {
      id: 'demo-acc-reserva',
      ownerId,
      name: 'Reserva Liquidez',
      institution: 'Nubank',
      type: 'digital_wallet',
      currency: 'BRL',
      maskedIdentifier: '•••• 9012',
      color: '#087F5B',
      openingBalanceCents: 840000,
      openingDate: '2026-10-01',
      openingBalanceKnown: true,
      includeInLiquidity: true,
      isArchived: false,
      version: 1,
    },
    {
      id: 'demo-acc-dinheiro',
      ownerId,
      name: 'Carteira em Dinheiro',
      type: 'cash',
      currency: 'BRL',
      color: '#526078',
      openingBalanceCents: 35000,
      openingDate: '2026-10-01',
      openingBalanceKnown: true,
      includeInLiquidity: true,
      isArchived: false,
      version: 1,
    },
    {
      id: 'demo-acc-cartao',
      ownerId,
      name: 'Cartão Platinum',
      institution: 'Banco Itaú',
      type: 'credit_card',
      currency: 'BRL',
      maskedIdentifier: '•••• 7788',
      color: '#172554',
      openingBalanceCents: 0,
      openingDate: '2026-10-01',
      openingBalanceKnown: true,
      includeInLiquidity: false,
      isArchived: false,
      version: 1,
    },
  ];

  base.cards = [
    {
      id: 'demo-card-1',
      ownerId,
      accountId: 'demo-acc-cartao',
      name: 'Cartão Platinum',
      maskedLast4: '7788',
      creditLimitCents: 800000,
      limitVerified: false,
      closingDay: 10,
      dueDay: 18,
      payingAccountId: 'demo-acc-corrente',
      isArchived: false,
      version: 1,
    },
  ];

  base.projects = [
    { id: 'proj-casa', ownerId, name: 'Casa & Reforma', isArchived: false },
    { id: 'proj-freela', ownerId, name: 'Consultoria Pessoal', isArchived: false },
  ];

  // Eventos de Outubro e Novembro/2026 (permitindo comparação de período e insights reais!)
  const sampleEvents: FinancialEvent[] = [
    {
      id: 'ev-out-sal',
      ownerId,
      nature: 'income',
      description: 'Salário Mensal',
      competenceDate: '2026-10-05',
      magnitudeCents: 780000,
      currency: 'BRL',
      categoryId: 'cat-inc-1',
      tags: ['fixo'],
      isDeleted: false,
      version: 1,
    },
    {
      id: 'ev-out-alug',
      ownerId,
      nature: 'expense',
      description: 'Aluguel Residencial',
      competenceDate: '2026-10-10',
      magnitudeCents: 240000,
      currency: 'BRL',
      categoryId: 'cat-exp-1',
      tags: ['moradia'],
      isDeleted: false,
      version: 1,
    },
    {
      id: 'ev-out-merc',
      ownerId,
      nature: 'expense',
      description: 'Supermercado Bairro',
      competenceDate: '2026-10-12',
      magnitudeCents: 75000,
      currency: 'BRL',
      categoryId: 'cat-exp-3',
      tags: [],
      isDeleted: false,
      version: 1,
    },
    {
      id: 'ev-out-stream',
      ownerId,
      nature: 'expense',
      description: 'Assinatura Nuvem Pro',
      competenceDate: '2026-10-14',
      magnitudeCents: 4990,
      currency: 'BRL',
      categoryId: 'cat-exp-9',
      tags: ['assinatura'],
      isDeleted: false,
      version: 1,
    },
    // Novembro 2026
    {
      id: 'ev-nov-sal',
      ownerId,
      nature: 'income',
      description: 'Salário Mensal',
      competenceDate: '2026-11-05',
      magnitudeCents: 780000,
      currency: 'BRL',
      categoryId: 'cat-inc-1',
      tags: ['fixo'],
      isDeleted: false,
      version: 1,
    },
    {
      id: 'ev-nov-cons',
      ownerId,
      nature: 'income',
      description: 'Projeto Consultoria',
      competenceDate: '2026-11-08',
      magnitudeCents: 165000,
      currency: 'BRL',
      categoryId: 'cat-inc-2',
      projectId: 'proj-freela',
      tags: ['profissional'],
      isDeleted: false,
      version: 1,
    },
    {
      id: 'ev-nov-alug',
      ownerId,
      nature: 'expense',
      description: 'Aluguel Residencial',
      competenceDate: '2026-11-10',
      magnitudeCents: 240000,
      currency: 'BRL',
      categoryId: 'cat-exp-1',
      tags: ['moradia'],
      isDeleted: false,
      version: 1,
    },
    {
      id: 'ev-nov-merc-1',
      ownerId,
      nature: 'expense',
      description: 'Mercado Extra — Compras da Semana',
      competenceDate: '2026-11-03',
      magnitudeCents: 42000,
      currency: 'BRL',
      categoryId: 'cat-exp-3',
      tags: [],
      isDeleted: false,
      version: 1,
    },
    {
      id: 'ev-nov-merc-2',
      ownerId,
      nature: 'expense',
      description: 'Hortifrúti & Açougue',
      competenceDate: '2026-11-09',
      magnitudeCents: 31000,
      currency: 'BRL',
      categoryId: 'cat-exp-3',
      tags: [],
      isDeleted: false,
      version: 1,
    },
    {
      id: 'ev-nov-merc-3',
      ownerId,
      nature: 'expense',
      description: 'Atacadão Mensal',
      competenceDate: '2026-11-12',
      magnitudeCents: 20000,
      currency: 'BRL',
      categoryId: 'cat-exp-3',
      tags: [],
      isDeleted: false,
      version: 1,
    },
    {
      id: 'ev-nov-transp',
      ownerId,
      nature: 'expense',
      description: 'Combustível Posto Central',
      competenceDate: '2026-11-07',
      magnitudeCents: 26500,
      currency: 'BRL',
      categoryId: 'cat-exp-4',
      tags: [],
      isDeleted: false,
      version: 1,
    },
    {
      id: 'ev-nov-saude',
      ownerId,
      nature: 'expense',
      description: 'Farmácia São Paulo',
      competenceDate: '2026-11-11',
      magnitudeCents: 18400,
      currency: 'BRL',
      categoryId: 'cat-exp-5',
      tags: [],
      isDeleted: false,
      version: 1,
    },
    {
      id: 'ev-nov-stream',
      ownerId,
      nature: 'expense',
      description: 'Assinatura Nuvem Pro',
      competenceDate: '2026-11-13',
      magnitudeCents: 4990,
      currency: 'BRL',
      categoryId: 'cat-exp-9',
      tags: ['assinatura'],
      isDeleted: false,
      version: 1,
    },
    {
      id: 'ev-nov-tarifa',
      ownerId,
      nature: 'expense',
      description: 'Tarifa Pacote Bancário',
      competenceDate: '2026-11-04',
      magnitudeCents: 3200,
      currency: 'BRL',
      categoryId: 'cat-exp-12',
      tags: ['tarifa'],
      isDeleted: false,
      version: 1,
    },
  ];
  base.events = sampleEvents;

  base.transferGroups = [
    {
      id: 'demo-tg-1',
      ownerId,
      nature: 'internal_transfer',
      fromAccountId: 'demo-acc-corrente',
      toAccountId: 'demo-acc-reserva',
      amountCents: 150000,
      effectiveDate: '2026-11-06',
      description: 'Aporte para Reserva de Emergência',
    },
  ];

  base.movements = [
    {
      id: 'mov-out-sal',
      ownerId,
      accountId: 'demo-acc-corrente',
      eventId: 'ev-out-sal',
      signedCents: 780000,
      effectiveDate: '2026-10-05',
      description: 'Salário Mensal',
      origin: 'ofx',
      reviewStatus: 'reviewed',
      reconciliationStatus: 'reconciled',
      isDeleted: false,
      version: 1,
      createdAt: '2026-10-05T10:00:00Z',
    },
    {
      id: 'mov-out-alug',
      ownerId,
      accountId: 'demo-acc-corrente',
      eventId: 'ev-out-alug',
      signedCents: -240000,
      effectiveDate: '2026-10-10',
      description: 'Aluguel Residencial',
      origin: 'ofx',
      reviewStatus: 'reviewed',
      reconciliationStatus: 'reconciled',
      isDeleted: false,
      version: 1,
      createdAt: '2026-10-10T10:00:00Z',
    },
    {
      id: 'mov-out-merc',
      ownerId,
      accountId: 'demo-acc-corrente',
      eventId: 'ev-out-merc',
      signedCents: -75000,
      effectiveDate: '2026-10-12',
      description: 'Supermercado Bairro',
      origin: 'csv',
      reviewStatus: 'reviewed',
      reconciliationStatus: 'reconciled',
      isDeleted: false,
      version: 1,
      createdAt: '2026-10-12T10:00:00Z',
    },
    {
      id: 'mov-out-stream',
      ownerId,
      accountId: 'demo-acc-cartao',
      eventId: 'ev-out-stream',
      signedCents: -4990,
      effectiveDate: '2026-10-14',
      description: 'Assinatura Nuvem Pro',
      origin: 'manual',
      reviewStatus: 'reviewed',
      reconciliationStatus: 'reconciled',
      isDeleted: false,
      version: 1,
      createdAt: '2026-10-14T10:00:00Z',
    },
    {
      id: 'mov-nov-sal',
      ownerId,
      accountId: 'demo-acc-corrente',
      eventId: 'ev-nov-sal',
      signedCents: 780000,
      effectiveDate: '2026-11-05',
      description: 'Salário Mensal',
      origin: 'ofx',
      reviewStatus: 'reviewed',
      reconciliationStatus: 'reconciled',
      isDeleted: false,
      version: 1,
      createdAt: '2026-11-05T10:00:00Z',
    },
    {
      id: 'mov-nov-cons',
      ownerId,
      accountId: 'demo-acc-corrente',
      eventId: 'ev-nov-cons',
      signedCents: 165000,
      effectiveDate: '2026-11-08',
      description: 'Projeto Consultoria',
      origin: 'manual',
      reviewStatus: 'reviewed',
      reconciliationStatus: 'unreconciled',
      isDeleted: false,
      version: 1,
      createdAt: '2026-11-08T10:00:00Z',
    },
    {
      id: 'mov-nov-tr-out',
      ownerId,
      accountId: 'demo-acc-corrente',
      transferGroupId: 'demo-tg-1',
      signedCents: -150000,
      effectiveDate: '2026-11-06',
      description: 'Aporte para Reserva de Emergência (Saída)',
      origin: 'system_transfer',
      reviewStatus: 'reviewed',
      reconciliationStatus: 'reconciled',
      isDeleted: false,
      version: 1,
      createdAt: '2026-11-06T12:00:00Z',
    },
    {
      id: 'mov-nov-tr-in',
      ownerId,
      accountId: 'demo-acc-reserva',
      transferGroupId: 'demo-tg-1',
      signedCents: 150000,
      effectiveDate: '2026-11-06',
      description: 'Aporte para Reserva de Emergência (Entrada)',
      origin: 'system_transfer',
      reviewStatus: 'reviewed',
      reconciliationStatus: 'reconciled',
      isDeleted: false,
      version: 1,
      createdAt: '2026-11-06T12:00:00Z',
    },
    {
      id: 'mov-nov-alug',
      ownerId,
      accountId: 'demo-acc-corrente',
      eventId: 'ev-nov-alug',
      signedCents: -240000,
      effectiveDate: '2026-11-10',
      description: 'Aluguel Residencial',
      origin: 'ofx',
      reviewStatus: 'reviewed',
      reconciliationStatus: 'reconciled',
      isDeleted: false,
      version: 1,
      createdAt: '2026-11-10T10:00:00Z',
    },
    {
      id: 'mov-nov-merc-1',
      ownerId,
      accountId: 'demo-acc-corrente',
      eventId: 'ev-nov-merc-1',
      signedCents: -42000,
      effectiveDate: '2026-11-03',
      description: 'Mercado Extra — Compras da Semana',
      origin: 'csv',
      reviewStatus: 'reviewed',
      reconciliationStatus: 'reconciled',
      isDeleted: false,
      version: 1,
      createdAt: '2026-11-03T10:00:00Z',
    },
    {
      id: 'mov-nov-merc-2',
      ownerId,
      accountId: 'demo-acc-cartao',
      eventId: 'ev-nov-merc-2',
      signedCents: -31000,
      effectiveDate: '2026-11-09',
      description: 'Hortifrúti & Açougue',
      origin: 'manual',
      reviewStatus: 'reviewed',
      reconciliationStatus: 'unreconciled',
      isDeleted: false,
      version: 1,
      createdAt: '2026-11-09T10:00:00Z',
    },
    {
      id: 'mov-nov-merc-3',
      ownerId,
      accountId: 'demo-acc-corrente',
      eventId: 'ev-nov-merc-3',
      signedCents: -20000,
      effectiveDate: '2026-11-12',
      description: 'Atacadão Mensal',
      origin: 'manual',
      reviewStatus: 'reviewed',
      reconciliationStatus: 'unreconciled',
      isDeleted: false,
      version: 1,
      createdAt: '2026-11-12T10:00:00Z',
    },
    {
      id: 'mov-nov-transp',
      ownerId,
      accountId: 'demo-acc-cartao',
      eventId: 'ev-nov-transp',
      signedCents: -26500,
      effectiveDate: '2026-11-07',
      description: 'Combustível Posto Central',
      origin: 'manual',
      reviewStatus: 'reviewed',
      reconciliationStatus: 'unreconciled',
      isDeleted: false,
      version: 1,
      createdAt: '2026-11-07T10:00:00Z',
    },
    {
      id: 'mov-nov-saude',
      ownerId,
      accountId: 'demo-acc-cartao',
      eventId: 'ev-nov-saude',
      signedCents: -18400,
      effectiveDate: '2026-11-11',
      description: 'Farmácia São Paulo',
      origin: 'manual',
      reviewStatus: 'pending_category',
      reconciliationStatus: 'unreconciled',
      isDeleted: false,
      version: 1,
      createdAt: '2026-11-11T10:00:00Z',
    },
    {
      id: 'mov-nov-stream',
      ownerId,
      accountId: 'demo-acc-cartao',
      eventId: 'ev-nov-stream',
      signedCents: -4990,
      effectiveDate: '2026-11-13',
      description: 'Assinatura Nuvem Pro',
      origin: 'manual',
      reviewStatus: 'reviewed',
      reconciliationStatus: 'unreconciled',
      isDeleted: false,
      version: 1,
      createdAt: '2026-11-13T10:00:00Z',
    },
    {
      id: 'mov-nov-tarifa',
      ownerId,
      accountId: 'demo-acc-corrente',
      eventId: 'ev-nov-tarifa',
      signedCents: -3200,
      effectiveDate: '2026-11-04',
      description: 'Tarifa Pacote Bancário',
      origin: 'ofx',
      reviewStatus: 'reviewed',
      reconciliationStatus: 'reconciled',
      isDeleted: false,
      version: 1,
      createdAt: '2026-11-04T10:00:00Z',
    },
  ];

  // Parcelamento de R$ 1.000,00 em 3x no cartão
  const parts = splitInstallments(100000, 3);
  base.installmentPlans = [
    {
      id: 'plan-notebook',
      ownerId,
      cardId: 'demo-card-1',
      description: 'Monitor Profissional 27"',
      totalContractedCents: 100000,
      installmentCount: 3,
      purchaseDate: '2026-11-02',
      categoryId: 'cat-exp-10',
    },
  ];

  base.obligations = [
    {
      id: 'ob-energia',
      ownerId,
      direction: 'payable',
      description: 'Conta de Energia Elétrica',
      dueDate: '2026-11-20',
      competenceDate: '2026-11-01',
      originalCents: 28500,
      canceledCents: 0,
      status: 'expected',
      accountId: 'demo-acc-corrente',
      categoryId: 'cat-exp-1',
      version: 1,
    },
    {
      id: 'ob-internet',
      ownerId,
      direction: 'payable',
      description: 'Internet Fibra 500Mb',
      dueDate: '2026-11-12',
      competenceDate: '2026-11-01',
      originalCents: 12990,
      canceledCents: 0,
      status: 'expected',
      accountId: 'demo-acc-corrente',
      categoryId: 'cat-exp-1',
      version: 1,
    },
    {
      id: 'ob-fatura-nov',
      ownerId,
      direction: 'payable',
      description: 'Fatura Cartão Platinum (Novembro)',
      dueDate: '2026-11-18',
      competenceDate: '2026-11-10',
      originalCents: 80890,
      canceledCents: 0,
      status: 'expected',
      accountId: 'demo-acc-corrente',
      cardId: 'demo-card-1',
      version: 1,
    },
    {
      id: 'ob-receb-freela',
      ownerId,
      direction: 'receivable',
      description: 'Segunda parcela Consultoria',
      dueDate: '2026-11-25',
      competenceDate: '2026-11-15',
      originalCents: 180000,
      canceledCents: 0,
      status: 'expected',
      accountId: 'demo-acc-corrente',
      categoryId: 'cat-inc-2',
      version: 1,
    },
    ...parts.map((cents, i) => ({
      id: `ob-parc-${i + 1}`,
      ownerId,
      direction: 'payable' as const,
      description: `Monitor Profissional 27" (${i + 1}/3)`,
      dueDate: addMonthsCivil('2026-12-18', i, 18),
      competenceDate: addMonthsCivil('2026-11-02', i, 2),
      originalCents: cents,
      canceledCents: 0,
      status: 'expected' as const,
      cardId: 'demo-card-1',
      categoryId: 'cat-exp-10',
      installmentPlanId: 'plan-notebook',
      installmentIndex: i + 1,
      version: 1,
    })),
  ];

  base.budgets = [
    {
      id: 'bud-mercado',
      ownerId,
      monthKey: '2026-11',
      categoryId: 'cat-exp-3',
      limitCents: 85000,
      alertThresholdPct: 80,
      version: 1,
    },
    {
      id: 'bud-moradia',
      ownerId,
      monthKey: '2026-11',
      categoryId: 'cat-exp-1',
      limitCents: 260000,
      alertThresholdPct: 80,
      version: 1,
    },
    {
      id: 'bud-transp',
      ownerId,
      monthKey: '2026-11',
      categoryId: 'cat-exp-4',
      limitCents: 50000,
      alertThresholdPct: 80,
      version: 1,
    },
  ];

  base.goals = [
    {
      id: 'goal-reserva',
      ownerId,
      name: 'Reserva de 6 meses',
      targetCents: 2400000,
      reservedCents: 800000,
      deadlineDate: '2027-06-30',
      version: 1,
    },
    {
      id: 'goal-viagem',
      ownerId,
      name: 'Viagem em Família',
      targetCents: 600000,
      reservedCents: 190000,
      deadlineDate: '2027-01-15',
      version: 1,
    },
  ];

  base.reconciliations = [
    {
      id: 'rec-demo-1',
      ownerId,
      accountId: 'demo-acc-corrente',
      cutoffDate: '2026-11-10',
      reportedBalanceCents: 1094800,
      calculatedBalanceCents: 1094800,
      differenceCents: 0,
      status: 'matched',
      createdAt: '2026-11-10T18:00:00Z',
    },
  ];

  base.categoryRules = [
    {
      id: 'rule-1',
      ownerId,
      priority: 10,
      matchText: 'mercado|hortifruti|atacadao',
      targetCategoryId: 'cat-exp-3',
      isActive: true,
    },
    {
      id: 'rule-2',
      ownerId,
      priority: 20,
      matchText: 'farmacia|drogaria',
      targetCategoryId: 'cat-exp-5',
      isActive: true,
    },
  ];

  return base;
}
