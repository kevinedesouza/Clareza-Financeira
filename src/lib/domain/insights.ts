import { InsightItem, WorkspaceData } from './types';
import { computeDashboardMetrics, evaluateBudget } from './ledger';
import { formatBRL, addDaysCivil } from './money';

/**
 * Motor determinístico de insights financeiros (PRD §9).
 * Nenhuma chamada externa de IA; cada insight expõe cálculo, período, evidências, limitações e ação.
 */
export function computeDeterministicInsights(
  data: WorkspaceData,
  params: { periodStart: string; periodEnd: string; todayDate: string }
): InsightItem[] {
  const { periodStart, periodEnd, todayDate } = params;
  const metrics = computeDashboardMetrics(data, { periodStart, periodEnd, todayDate });
  const dismissed = new Set(data.dismissedInsightIds ?? []);
  const insights: InsightItem[] = [];

  // Regra 1: Categoria cresceu (>= 20% e >= R$ 100 contra intervalo anterior equivalente)
  for (const cat of metrics.categorySpending) {
    if (cat.deltaCents !== null && cat.deltaPct !== null) {
      if (cat.deltaCents >= 10000 && cat.deltaPct >= 20) {
        const id = `ins-growth-${cat.categoryId}-${periodStart}`;
        if (!dismissed.has(id)) {
          const evIds = data.movements
            .filter((m) => !m.isDeleted && m.eventId && cat.eventIds.includes(m.eventId))
            .map((m) => m.id);
          insights.push({
            id,
            ruleKey: 'category_growth',
            severity: 'warning',
            title: `${cat.categoryName} aumentou ${formatBRL(cat.deltaCents)} (+${cat.deltaPct.toFixed(0)}%)`,
            observation: `${cat.categoryName} somou ${formatBRL(cat.totalCents)} neste período contra ${formatBRL(cat.previousCents ?? 0)} no intervalo anterior equivalente. ${cat.eventIds.length} lançamento(s) explicam a variação.`,
            formula: `(Atual ${formatBRL(cat.totalCents)} − Anterior ${formatBRL(cat.previousCents ?? 0)}) ÷ Anterior × 100`,
            periodLabel: `${periodStart} a ${periodEnd}`,
            confidenceNote: 'Base: eventos por competência. Compara intervalo de igual duração imediatamente anterior.',
            evidenceMovementIds: evIds,
            evidenceLabel: `${cat.eventIds.length} lançamento(s) em ${cat.categoryName}`,
            actionLabel: 'Ver lançamentos',
            actionTarget: `transactions?category=${cat.categoryId}`,
            status: 'active',
          });
        }
      }
    }
  }

  // Regra 2: Orçamento próximo (>=80%) ou excedido (>=100%)
  const monthKey = periodEnd.slice(0, 7);
  const categoryMap = new Map(data.categories.map((c) => [c.id, c]));
  for (const bud of data.budgets.filter((b) => b.monthKey === monthKey)) {
    const evalRes = evaluateBudget(bud, data.events, data.categories);
    if (evalRes.status !== 'ok') {
      const id = `ins-budget-${bud.id}-${evalRes.status}`;
      if (!dismissed.has(id)) {
        const catName = categoryMap.get(bud.categoryId)?.name ?? 'Categoria';
        insights.push({
          id,
          ruleKey: 'budget_threshold',
          severity: evalRes.status === 'exceeded' ? 'danger' : 'warning',
          title:
            evalRes.status === 'exceeded'
              ? `Orçamento de ${catName} excedido em ${formatBRL(evalRes.excessCents)}`
              : `Orçamento de ${catName} em ${evalRes.pct.toFixed(0)}% do limite`,
          observation: `Gasto por competência de ${formatBRL(evalRes.spentCents)} frente ao limite definido de ${formatBRL(bud.limitCents)}.`,
          formula: `Gasto competência ${formatBRL(evalRes.spentCents)} ÷ Limite ${formatBRL(bud.limitCents)}`,
          periodLabel: `Competência ${monthKey}`,
          confidenceNote: 'Considera eventos por competência incluindo subcategorias sem dupla contagem.',
          evidenceMovementIds: [],
          evidenceLabel: `Limite mensal: ${formatBRL(bud.limitCents)}`,
          actionLabel: 'Revisar orçamento',
          actionTarget: 'budgets',
          status: 'active',
        });
      }
    }
  }

  // Regra 3: Caixa insuficiente nos próximos 30 dias
  if (metrics.projected30dCents < 0) {
    const id = `ins-proj-neg-${todayDate.slice(0, 7)}`;
    if (!dismissed.has(id)) {
      insights.push({
        id,
        ruleKey: 'negative_projection',
        severity: 'danger',
        title: `Projeção de caixa negativa em 30 dias (${formatBRL(metrics.projected30dCents)})`,
        observation: `Com os recebimentos e obrigações cadastrados até ${addDaysCivil(todayDate, 30)}, o saldo líquido projetado fica abaixo de zero.`,
        formula: `Saldo líquido atual ${formatBRL(metrics.liquidityBalanceCents)} + Recebimentos futuros − Obrigações a pagar`,
        periodLabel: `Próximos 30 dias a partir de ${todayDate}`,
        confidenceNote: 'Estimativa baseada apenas em obrigações cadastradas, sem receitas variáveis não registradas.',
        isEstimate: true,
        evidenceMovementIds: [],
        evidenceLabel: `Em aberto a pagar: ${formatBRL(metrics.openPayableCents)}`,
        actionLabel: 'Abrir Agenda',
        actionTarget: 'agenda',
        status: 'active',
      });
    }
  }

  // Regra 6: Tarifas e Juros identificados
  const feeCatIds = new Set(
    data.categories
      .filter((c) => c.name.toLowerCase().includes('tarifa') || c.name.toLowerCase().includes('juros'))
      .map((c) => c.id)
  );
  const feeEvents = data.events.filter(
    (e) =>
      !e.isDeleted &&
      e.competenceDate >= periodStart &&
      e.competenceDate <= periodEnd &&
      e.categoryId &&
      feeCatIds.has(e.categoryId)
  );
  if (feeEvents.length > 0) {
    const totalFees = feeEvents.reduce((acc, e) => acc + e.magnitudeCents, 0);
    const id = `ins-fees-${periodStart}`;
    if (!dismissed.has(id) && totalFees > 0) {
      const feeMovs = data.movements
        .filter((m) => !m.isDeleted && m.eventId && feeEvents.some((e) => e.id === m.eventId))
        .map((m) => m.id);
      insights.push({
        id,
        ruleKey: 'fees_interest',
        severity: 'info',
        title: `Tarifas e juros somam ${formatBRL(totalFees)} no período`,
        observation: `Foram identificados ${feeEvents.length} lançamento(s) classificados em Tarifas/Juros no intervalo analisado.`,
        formula: `Soma dos eventos em Tarifas/Juros (${feeEvents.length} registro(s))`,
        periodLabel: `${periodStart} a ${periodEnd}`,
        confidenceNote: 'Baseado nos lançamentos classificados na categoria Tarifas/Juros.',
        evidenceMovementIds: feeMovs,
        evidenceLabel: `${feeEvents.length} cobrança(s) de tarifa/juros`,
        actionLabel: 'Ver lançamentos',
        actionTarget: 'transactions',
        status: 'active',
      });
    }
  }

  // Regra 8: Dados pendentes (classificação, revisão, conciliação ou abertura desconhecida)
  const pendingTotal =
    metrics.coverage.unclassifiedCount +
    metrics.coverage.pendingReviewCount +
    metrics.coverage.pendingImportBatches +
    metrics.coverage.unknownOpeningAccounts +
    metrics.coverage.divergentReconciliations;
  if (pendingTotal > 0) {
    const id = `ins-pending-quality`;
    if (!dismissed.has(id)) {
      insights.push({
        id,
        ruleKey: 'pending_data',
        severity: 'warning',
        title: `${pendingTotal} pendência(s) afetam a confiança dos números`,
        observation: `${metrics.coverage.unclassifiedCount} sem categoria, ${metrics.coverage.pendingImportBatches} importação(ões) aguardando revisão e ${metrics.coverage.unknownOpeningAccounts} conta(s) sem saldo inicial validado.`,
        formula: 'Contagem de registros com revisão/conciliação pendente',
        periodLabel: 'Base atual',
        confidenceNote: 'Resolver pendências garante precisão nos totais por categoria e liquidez.',
        evidenceMovementIds: data.movements
          .filter((m) => !m.isDeleted && m.reviewStatus !== 'reviewed')
          .map((m) => m.id),
        evidenceLabel: `${pendingTotal} item(ns) para revisar`,
        actionLabel: 'Revisar pendências',
        actionTarget: 'transactions?review=pending',
        status: 'active',
      });
    }
  }

  // Regra 4: Possível assinatura (pelo menos 2 ou 3 cobranças recorrentes por descrição normalizada com ~25-35 dias)
  const byDesc = new Map<string, typeof data.movements>();
  for (const m of data.movements) {
    if (m.isDeleted || m.signedCents >= 0 || m.transferGroupId) continue;
    const key = m.description.trim().toLowerCase().replace(/\d+/g, '').trim();
    const list = byDesc.get(key) ?? [];
    list.push(m);
    byDesc.set(key, list);
  }
  for (const [descKey, list] of byDesc.entries()) {
    if (list.length >= 2) {
      const sorted = [...list].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
      let hasMonthlyCadence = false;
      for (let i = 1; i < sorted.length; i++) {
        const diffDays = Math.round(
          (Date.parse(sorted[i].effectiveDate) - Date.parse(sorted[i - 1].effectiveDate)) / 86400000
        );
        const amountDiff = Math.abs(Math.abs(sorted[i].signedCents) - Math.abs(sorted[i - 1].signedCents));
        if (diffDays >= 25 && diffDays <= 35 && amountDiff <= 500) {
          hasMonthlyCadence = true;
        }
      }
      if (hasMonthlyCadence) {
        const id = `ins-sub-${descKey.slice(0, 18)}`;
        if (!dismissed.has(id)) {
          insights.push({
            id,
            ruleKey: 'possible_subscription',
            severity: 'info',
            title: `Possível cobrança recorrente: ${sorted[sorted.length - 1].description}`,
            observation: `Identificadas ${sorted.length} cobranças com intervalo mensal (25–35 dias) e valor aproximado de ${formatBRL(Math.abs(sorted[sorted.length - 1].signedCents))}.`,
            formula: 'Intervalo 25–35 dias com mesmo favorecido e valor semelhante',
            periodLabel: `${sorted[0].effectiveDate} a ${sorted[sorted.length - 1].effectiveDate}`,
            confidenceNote:
              sorted.length < 3
                ? 'Amostra parcial (2 ocorrências). Confirme na Agenda se desejar acompanhar recorrência.'
                : 'Padrão recorrente confirmado em 3 ou mais ciclos.',
            evidenceMovementIds: sorted.map((s) => s.id),
            evidenceLabel: `${sorted.length} cobranças detectadas`,
            actionLabel: 'Abrir Agenda',
            actionTarget: 'agenda',
            status: 'active',
          });
        }
      }
    }
  }

  return insights;
}
