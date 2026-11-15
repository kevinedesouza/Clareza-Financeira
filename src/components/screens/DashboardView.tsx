import React from 'react';
import { OnboardingChecklist } from '../dashboard/OnboardingChecklist';
import { InsightItem, WorkspaceData } from '../../lib/domain/types';
import {
  computeDashboardMetrics,
  computeObligationOpenCents,
  deriveObligationStatus,
  evaluateBudget,
} from '../../lib/domain/ledger';
import { formatCivilDateBR } from '../../lib/domain/money';
import { FinancialValue, StatusTag, Button } from '../ui/Primitives';
import { CashEvolutionChart } from '../charts/CashEvolutionChart';
import { CategorySpendingChart } from '../charts/CategorySpendingChart';
import { AlertTriangle, ArrowRight, CheckCircle2, Plus, Upload } from 'lucide-react';

interface Props {
  workspace: WorkspaceData;
  insights: InsightItem[];
  periodStart: string;
  periodEnd: string;
  todayDate: string;
  selectedAccountIds: string[];
  onNavigate: (tab: string, filter?: { categoryId?: string; reviewPending?: boolean }) => void;
  onNewTransaction: () => void;
  onOpenImport: () => void;
}

export const DashboardView: React.FC<Props> = ({
  workspace,
  insights,
  periodStart,
  periodEnd,
  todayDate,
  selectedAccountIds,
  onNavigate,
  onNewTransaction,
  onOpenImport,
}) => {
  const privacy = workspace.profile.privacyMode;
  const metrics = computeDashboardMetrics(workspace, {
    periodStart,
    periodEnd,
    accountIds: selectedAccountIds,
    todayDate,
  });

  // Estado vazio inicial para conta real recém-criada
  if (workspace.accounts.length === 0) {
    return (
      <div className="space-y-6">
      <OnboardingChecklist workspace={workspace} onNavigate={onNavigate} />
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center">
        <h2 className="text-xl font-semibold text-[var(--color-text)]">
          Comece cadastrando sua primeira conta ou importando um extrato
        </h2>
        <p className="mx-auto mt-2 max-w-lg text-sm text-[var(--color-text-secondary)]">
          Para começar, cadastre sua conta bancária com o saldo de hoje ou importe o extrato do banco (arquivo CSV ou OFX).
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button variant="primary" onClick={() => onNavigate('accounts')}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Cadastrar primeira conta
          </Button>
          <Button variant="secondary" onClick={onOpenImport}>
            <Upload className="h-4 w-4" aria-hidden="true" />
            Importar extrato CSV/OFX
          </Button>
        </div>
      </div>
      </div>
    );
  }

  const upcomingObligations = workspace.obligations
    .filter((o) => o.status !== 'canceled' && o.status !== 'settled')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 4);

  const monthKey = periodEnd.slice(0, 7);
  const categoryMap = new Map(workspace.categories.map((c) => [c.id, c]));
  const priorityBudgets = workspace.budgets.filter((b) => b.monthKey === monthKey).slice(0, 3);
  const topInsights = insights.filter((i) => i.status === 'active').slice(0, 3);

  const qualityPendencies =
    metrics.coverage.unclassifiedCount +
    metrics.coverage.pendingReviewCount +
    metrics.coverage.pendingImportBatches +
    metrics.coverage.unknownOpeningAccounts +
    metrics.coverage.divergentReconciliations;

  return (
    <div className="space-y-6 md:space-y-8">
      <OnboardingChecklist workspace={workspace} onNavigate={onNavigate} />
      {/* Primeira Linha: 4 KPIs prioritários */}
      <section aria-label="Indicadores principais de caixa" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* Card de Saldo Disponível em destaque institucional azul profundo */}
        <div className="rounded-xl bg-[var(--color-brand)] p-5 md:p-6 text-white shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-blue-100">Saldo em contas</span>
            {metrics.liquidityIsPartial && (
              <span className="rounded-md bg-amber-400/20 px-2 py-0.5 text-[11px] font-medium text-amber-200">
                Parcial
              </span>
            )}
          </div>
          <div className="mt-2 text-2xl md:text-3xl font-bold tracking-tight">
            <FinancialValue cents={metrics.liquidityBalanceCents} privacyMode={privacy} />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/15 pt-3 text-xs text-blue-100">
            <span>
              Livre após metas:{' '}
              <strong className="text-white">
                <FinancialValue cents={metrics.freeAfterReservesCents} privacyMode={privacy} />
              </strong>
            </span>
            <button
              type="button"
              onClick={() => onNavigate('accounts')}
              className="focus-ring inline-flex items-center gap-1 font-medium text-white hover:underline cursor-pointer"
            >
              Contas
              <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-blue-100">
            <span>
              Faturas de cartão em aberto:{' '}
              <strong className="text-white">
                <FinancialValue cents={metrics.cardDebtCents} privacyMode={privacy} />
              </strong>
            </span>
            <button
              type="button"
              onClick={() => onNavigate('cards')}
              className="focus-ring inline-flex items-center gap-1 font-medium text-white hover:underline cursor-pointer"
            >
              Cartões
              <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Receitas recebidas */}
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 md:p-6">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-[var(--color-text-secondary)]">Receitas recebidas</span>
            <span className="text-[11px] text-[var(--color-text-secondary)]" title="Só o que já entrou ou saiu das contas.">Já na conta</span>
          </div>
          <div className="mt-2 text-2xl md:text-3xl font-bold tracking-tight text-[var(--color-income)]">
            <FinancialValue cents={metrics.incomeReceivedCents} privacyMode={privacy} showSign />
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-text-secondary)]">
            <span>{metrics.incomeMovementIds.length} entrada(s)</span>
            <button
              type="button"
              onClick={() => onNavigate('transactions')}
              className="focus-ring font-medium text-[var(--color-primary)] hover:underline cursor-pointer"
            >
              Ver composição
            </button>
          </div>
        </div>

        {/* Despesas pagas */}
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 md:p-6">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-[var(--color-text-secondary)]">Despesas pagas</span>
            <span className="text-[11px] text-[var(--color-text-secondary)]" title="Só o que já entrou ou saiu das contas.">Já na conta</span>
          </div>
          <div className="mt-2 text-2xl md:text-3xl font-bold tracking-tight text-[var(--color-text)]">
            <FinancialValue cents={-metrics.expensesPaidCents} privacyMode={privacy} />
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-text-secondary)]">
            <span>{metrics.expenseMovementIds.length} saída(s)</span>
            <button
              type="button"
              onClick={() => onNavigate('transactions')}
              className="focus-ring font-medium text-[var(--color-primary)] hover:underline cursor-pointer"
            >
              Ver composição
            </button>
          </div>
        </div>

        {/* Resultado operacional de caixa */}
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 md:p-6">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-[var(--color-text-secondary)]">Resultado de caixa</span>
            <span className="text-[11px] text-[var(--color-text-secondary)]">Receitas − Despesas</span>
          </div>
          <div
            className={`mt-2 text-2xl md:text-3xl font-bold tracking-tight ${
              metrics.operatingCashResultCents >= 0 ? 'text-[var(--color-income)]' : 'text-[var(--color-expense)]'
            }`}
          >
            <FinancialValue cents={metrics.operatingCashResultCents} privacyMode={privacy} showSign />
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-text-secondary)]">
            <span>
              Taxa de sobra:{' '}
              {metrics.savingsRatePct !== null ? `${metrics.savingsRatePct.toFixed(1)}%` : 'Sem base'}
            </span>
            <button
              type="button"
              onClick={() => onNavigate('reports')}
              className="focus-ring font-medium text-[var(--color-primary)] hover:underline cursor-pointer"
            >
              Relatórios
            </button>
          </div>
        </div>
      </section>

      {/* Patrimônio: contas + investimentos - faturas de cartão em aberto */}
      <section aria-label="Patrimônio líquido" className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-[var(--color-text-secondary)]">Patrimônio líquido</p>
            <p className="mt-1 text-2xl font-bold tracking-tight text-[var(--color-text)]">
              <FinancialValue cents={metrics.netWorthCents} privacyMode={privacy} />
            </p>
          </div>
          {metrics.netWorthIsPartial && (
            <span className="rounded-md bg-[var(--color-warning-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-warning)]">
              Parcial
            </span>
          )}
        </div>
        <dl className="mt-4 grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-[var(--color-text-secondary)]">Em contas</dt>
            <dd className="font-medium text-[var(--color-text)]"><FinancialValue cents={metrics.liquidityBalanceCents} privacyMode={privacy} /></dd>
          </div>
          <div>
            <dt className="text-[var(--color-text-secondary)]">Investimentos</dt>
            <dd className="font-medium text-[var(--color-text)]"><FinancialValue cents={(metrics.netWorthCents - metrics.liquidityBalanceCents + metrics.cardDebtCents)} privacyMode={privacy} /></dd>
          </div>
          <div>
            <dt className="text-[var(--color-text-secondary)]">Faturas de cartão em aberto</dt>
            <dd className="font-medium text-[var(--color-expense)]">
              <FinancialValue cents={-metrics.cardDebtCents} privacyMode={privacy} />
            </dd>
          </div>
        </dl>
      </section>

      {/* Segunda Linha: Evolução de caixa + Gastos por categoria (competência) */}
      <section className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="xl:col-span-7 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 md:p-6">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-[var(--color-text)]">Evolução do saldo de caixa</h2>
              <p className="text-xs text-[var(--color-text-secondary)]">
                Projeção 30d: <FinancialValue cents={metrics.projected30dCents} privacyMode={privacy} className="font-semibold text-[var(--color-text)]" /> · 60d:{' '}
                <FinancialValue cents={metrics.projected60dCents} privacyMode={privacy} className="font-medium" />
              </p>
            </div>
            <span className="text-xs text-[var(--color-text-secondary)]">
              {formatCivilDateBR(periodStart)} – {formatCivilDateBR(periodEnd)}
            </span>
          </div>
          <CashEvolutionChart series={metrics.evolutionSeries} todayDate={todayDate} privacyMode={privacy} />
        </div>

        <div className="xl:col-span-5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 md:p-6">
          <div className="mb-4 flex items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-[var(--color-text)]">Gastos por categoria</h2>
            <span title="Conta o gasto no mês em que a compra foi feita, mesmo que o pagamento seja depois (ex.: cartão)."><StatusTag label="Pela data da compra" tone="neutral" /></span>
          </div>
          <CategorySpendingChart
            items={metrics.categorySpending}
            privacyMode={privacy}
            onSelectCategory={(catId) => onNavigate('transactions', { categoryId: catId })}
          />
        </div>
      </section>

      {/* Terceira Linha: Vencimentos, Planejamento (Orçamentos/Metas) e Insights + Qualidade */}
      <section className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-12">
        {/* Próximos vencimentos */}
        <div className="xl:col-span-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 md:p-6">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-[var(--color-text)]">Próximos vencimentos</h2>
            <button
              type="button"
              onClick={() => onNavigate('agenda')}
              className="focus-ring text-xs font-medium text-[var(--color-primary)] hover:underline cursor-pointer"
            >
              Ver agenda
            </button>
          </div>
          {upcomingObligations.length === 0 ? (
            <p className="text-sm text-[var(--color-text-secondary)]">Nenhuma obrigação pendente cadastrada.</p>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {upcomingObligations.map((ob) => {
                const open = computeObligationOpenCents(ob, workspace.settlements);
                const status = deriveObligationStatus(ob, workspace.settlements, todayDate);
                return (
                  <li key={ob.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--color-text)]">{ob.description}</p>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                        <span>{formatCivilDateBR(ob.dueDate)}</span>
                        <span>·</span>
                        <span>{ob.direction === 'receivable' ? 'A receber' : 'A pagar'}</span>
                        {status === 'overdue' && <StatusTag label="Vencida" tone="expense" />}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span
                        className={`text-sm font-semibold ${
                          ob.direction === 'receivable' ? 'text-[var(--color-income)]' : 'text-[var(--color-text)]'
                        }`}
                      >
                        <FinancialValue cents={open} privacyMode={privacy} />
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Orçamentos prioritários e Metas */}
        <div className="xl:col-span-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 md:p-6 space-y-5">
          <div>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-[var(--color-text)]">Orçamentos do mês</h2>
              <button
                type="button"
                onClick={() => onNavigate('planning')}
                className="focus-ring text-xs font-medium text-[var(--color-primary)] hover:underline cursor-pointer"
              >
                Gerenciar
              </button>
            </div>
            {priorityBudgets.length === 0 ? (
              <p className="text-sm text-[var(--color-text-secondary)]">Nenhum orçamento mensal definido.</p>
            ) : (
              <div className="space-y-3">
                {priorityBudgets.map((b) => {
                  const res = evaluateBudget(b, workspace.events, workspace.categories);
                  const catName = categoryMap.get(b.categoryId)?.name ?? 'Categoria';
                  const barColor =
                    res.status === 'exceeded'
                      ? 'bg-[var(--color-expense)]'
                      : res.status === 'warning'
                        ? 'bg-[var(--color-warning)]'
                        : 'bg-[var(--color-primary)]';
                  return (
                    <div key={b.id}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="font-medium text-[var(--color-text)]">{catName}</span>
                        <span className="financial-value text-[var(--color-text-secondary)]">
                          <FinancialValue cents={res.spentCents} privacyMode={privacy} /> /{' '}
                          <FinancialValue cents={b.limitCents} privacyMode={privacy} /> ({res.pct.toFixed(0)}%)
                        </span>
                      </div>
                      <div className="relative h-2 w-full rounded-sm bg-[var(--color-surface-muted)] overflow-hidden">
                        <div className={`h-full ${barColor}`} style={{ width: `${Math.min(100, res.pct)}%` }} />
                      </div>
                      {res.excessCents > 0 && (
                        <p className="mt-0.5 text-[11px] font-medium text-[var(--color-expense)]">
                          Excedido em <FinancialValue cents={res.excessCents} privacyMode={privacy} />
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="border-t border-[var(--color-border)] pt-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--color-text)]">Metas e reservas</h3>
              <span className="text-xs text-[var(--color-goal)] font-medium">
                <FinancialValue cents={metrics.totalReservedInGoalsCents} privacyMode={privacy} />
              </span>
            </div>
            {workspace.goals.slice(0, 2).map((g) => {
              const pct = Math.min(100, Math.round((g.reservedCents / g.targetCents) * 100));
              return (
                <div key={g.id} className="mt-2">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-[var(--color-text)]">{g.name}</span>
                    <span className="financial-value text-[var(--color-text-secondary)]">{pct}%</span>
                  </div>
                  <div className="h-1.5 w-full rounded-sm bg-[var(--color-goal-soft)] overflow-hidden">
                    <div className="h-full bg-[var(--color-goal)]" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Insights verificáveis + Qualidade dos dados */}
        <div className="md:col-span-2 xl:col-span-4 space-y-6">
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 md:p-6">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-[var(--color-text)]">Insights verificáveis</h2>
              <button
                type="button"
                onClick={() => onNavigate('insights')}
                className="focus-ring text-xs font-medium text-[var(--color-primary)] hover:underline cursor-pointer"
              >
                Ver todos
              </button>
            </div>
            {topInsights.length === 0 ? (
              <p className="text-sm text-[var(--color-text-secondary)]">
                Importe mais períodos para comparar seus gastos com segurança.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--color-border)]">
                {topInsights.map((ins) => (
                  <li key={ins.id} className="py-3 first:pt-0 last:pb-0">
                    <p className="text-sm font-medium text-[var(--color-text)]">{ins.title}</p>
                    <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{ins.observation}</p>
                    <button
                      type="button"
                      onClick={() => onNavigate('insights')}
                      className="focus-ring mt-1.5 text-xs font-medium text-[var(--color-primary)] hover:underline cursor-pointer"
                    >
                      {ins.actionLabel} →
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-[var(--color-text)]">Qualidade e cobertura</h2>
                <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                  {qualityPendencies === 0
                    ? 'Todas as contas e lançamentos revisados até o momento.'
                    : `${qualityPendencies} pendência(s) aguardando conferência (${metrics.coverage.unclassifiedCount} sem categoria, ${metrics.coverage.divergentReconciliations} divergência(s)).`}
                </p>
              </div>
              {qualityPendencies === 0 ? (
                <CheckCircle2 className="h-5 w-5 text-[var(--color-income)] shrink-0" aria-hidden="true" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-[var(--color-warning)] shrink-0" aria-hidden="true" />
              )}
            </div>
            {qualityPendencies > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={() => onNavigate('transactions', { reviewPending: true })}
                  className="text-xs"
                >
                  Revisar pendências
                </Button>
                <Button variant="ghost" onClick={onNewTransaction} className="text-xs">
                  Novo lançamento
                </Button>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};
