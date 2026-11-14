import React, { useState } from 'react';
import { WorkspaceData } from '../../lib/domain/types';
import { computeDashboardMetrics, evaluateBudget } from '../../lib/domain/ledger';
import { formatCivilDateBR, parseMoneyToCents } from '../../lib/domain/money';
import { apiRequest } from '../../lib/api/client';
import { Button, FinancialValue, StatusTag } from '../ui/Primitives';
import { PaginationBar, usePagination } from '../ui/Pagination';
import { Plus, Target } from 'lucide-react';

interface Props {
  workspace: WorkspaceData;
  monthKey: string;
  todayDate: string;
  onRefresh: () => Promise<void>;
}

export const PlanningView: React.FC<Props> = ({ workspace, monthKey, todayDate, onRefresh }) => {
  const [budCatId, setBudCatId] = useState(
    workspace.categories.find((c) => c.kind === 'expense')?.id || ''
  );
  const [budLimitStr, setBudLimitStr] = useState('');
  const [goalName, setGoalName] = useState('');
  const [goalTargetStr, setGoalTargetStr] = useState('');
  const [goalDeadline, setGoalDeadline] = useState('');
  const [contribGoalId, setContribGoalId] = useState<string | null>(null);
  const [contribStr, setContribStr] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const privacy = workspace.profile.privacyMode;
  const categoryMap = new Map(workspace.categories.map((c) => [c.id, c]));
  const monthBudgets = workspace.budgets.filter((b) => b.monthKey === monthKey);

  const metrics = computeDashboardMetrics(workspace, {
    periodStart: `${monthKey}-01`,
    periodEnd: `${monthKey}-30`,
    todayDate,
  });

  const handleSaveBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const cents = parseMoneyToCents(budLimitStr, ',');
    if (!cents || cents <= 0 || !budCatId) {
      setMsg('Selecione uma categoria e um limite positivo.');
      return;
    }
    setSaving(true);
    try {
      await apiRequest('/api/budgets', {
        method: 'POST',
        body: { monthKey, categoryId: budCatId, limitCents: cents, alertThresholdPct: 80 },
      });
      await onRefresh();
      setBudLimitStr('');
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Erro ao salvar orçamento.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const cents = parseMoneyToCents(goalTargetStr, ',');
    if (!goalName.trim() || !cents || cents <= 0) {
      setMsg('Informe o nome da meta e valor-alvo positivo.');
      return;
    }
    setSaving(true);
    try {
      await apiRequest('/api/goals', {
        method: 'POST',
        body: { name: goalName, targetCents: cents, deadlineDate: goalDeadline || undefined },
      });
      await onRefresh();
      setGoalName('');
      setGoalTargetStr('');
      setGoalDeadline('');
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Erro ao criar meta.');
    } finally {
      setSaving(false);
    }
  };

  const handleContribute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contribGoalId) return;
    setMsg(null);
    const cents = parseMoneyToCents(contribStr, ',');
    if (!cents || cents === 0) {
      setMsg('Informe um valor válido.');
      return;
    }
    setSaving(true);
    try {
      await apiRequest(`/api/goals/${contribGoalId}/contribute`, {
        method: 'POST',
        body: { amountCents: cents },
      });
      await onRefresh();
      setContribGoalId(null);
      setContribStr('');
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Erro ao reservar na meta.');
    } finally {
      setSaving(false);
    }
  };

  const goalPg = usePagination(workspace.goals, undefined, 'metas');
  const budgetPg = usePagination(monthBudgets, undefined, 'orcamentos');
  return (
    <div className="space-y-8">
      {msg && (
        <div role="alert" className="rounded-lg bg-[var(--color-expense-soft)] px-4 py-2.5 text-xs text-[var(--color-expense)]">
          {msg}
        </div>
      )}

      {/* Orçamentos */}
      <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 md:p-6 space-y-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text)]">Orçamentos ({monthKey})</h2>
            <p className="text-xs text-[var(--color-text-secondary)]">
              Base: Gastos por competência · Alertas visuais em 80% e 100%.
            </p>
          </div>
          <StatusTag label="Por competência" tone="neutral" />
        </div>

        <form onSubmit={handleSaveBudget} className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <select
            aria-label="Categoria do orçamento"
            value={budCatId}
            onChange={(e) => setBudCatId(e.target.value)}
            className="focus-ring min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm"
          >
            {workspace.categories
              .filter((c) => c.kind === 'expense')
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
          <input
            type="text"
            inputMode="decimal"
            aria-label="Limite mensal em reais"
            placeholder="Limite (ex: 900,00)"
            value={budLimitStr}
            onChange={(e) => setBudLimitStr(e.target.value)}
            className="focus-ring financial-value min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm"
          />
          <Button type="submit" variant="primary" loading={saving}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Definir limite
          </Button>
        </form>

        <div className="space-y-4">
          {monthBudgets.length === 0 ? (
            <p className="text-sm text-[var(--color-text-secondary)]">Nenhum limite definido para {monthKey}.</p>
          ) : (
            <>
            {budgetPg.pageItems.map((b) => {
              const res = evaluateBudget(b, workspace.events, workspace.categories);
              const catName = categoryMap.get(b.categoryId)?.name ?? 'Categoria';
              return (
                <div key={b.id} className="rounded-lg border border-[var(--color-border)] p-4 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-sm text-[var(--color-text)]">{catName}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[var(--color-text-secondary)]">
                        <FinancialValue cents={res.spentCents} privacyMode={privacy} /> /{' '}
                        <FinancialValue cents={b.limitCents} privacyMode={privacy} /> ({res.pct.toFixed(1)}%)
                      </span>
                      <StatusTag
                        label={res.status === 'exceeded' ? 'Excedido' : res.status === 'warning' ? 'Atenção ≥80%' : 'Dentro do limite'}
                        tone={res.status === 'exceeded' ? 'expense' : res.status === 'warning' ? 'warning' : 'income'}
                      />
                    </div>
                  </div>
                  <div className="relative h-2.5 w-full rounded-sm bg-[var(--color-surface-muted)] overflow-hidden">
                    <div
                      className={`h-full ${
                        res.status === 'exceeded'
                          ? 'bg-[var(--color-expense)]'
                          : res.status === 'warning'
                            ? 'bg-[var(--color-warning)]'
                            : 'bg-[var(--color-primary)]'
                      }`}
                      style={{ width: `${Math.min(100, res.pct)}%` }}
                    />
                    <div className="absolute top-0 bottom-0 left-[80%] w-0.5 bg-[var(--color-text-secondary)]/40" />
                  </div>
                  {res.excessCents > 0 && (
                    <p className="text-xs font-medium text-[var(--color-expense)]">
                      Excesso real: <FinancialValue cents={res.excessCents} privacyMode={privacy} />
                    </p>
                  )}
                </div>
              );
            })}
          <PaginationBar page={budgetPg.page} totalPages={budgetPg.totalPages} totalItems={budgetPg.totalItems} pageSize={budgetPg.pageSize} setPage={budgetPg.setPage} label="limites" />
            </>
          )}
        </div>
      </section>

      {/* Metas e Reservas Virtuais */}
      <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 md:p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text)]">Metas e reservas virtuais</h2>
            <p className="text-xs text-[var(--color-text-secondary)]">
              Reservas virtuais não criam despesa nem alteram saldo bancário. Liquidez livre após metas:{' '}
              <strong className="text-[var(--color-text)]">
                <FinancialValue cents={metrics.freeAfterReservesCents} privacyMode={privacy} />
              </strong>
            </p>
          </div>
          <StatusTag label="Planejamento" tone="goal" />
        </div>

        <form onSubmit={handleSaveGoal} className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input
            type="text"
            aria-label="Nome da meta"
            placeholder="Nome da meta"
            value={goalName}
            onChange={(e) => setGoalName(e.target.value)}
            className="focus-ring min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm"
          />
          <input
            type="text"
            inputMode="decimal"
            aria-label="Valor-alvo em reais"
            placeholder="Alvo (ex: 10.000,00)"
            value={goalTargetStr}
            onChange={(e) => setGoalTargetStr(e.target.value)}
            className="focus-ring financial-value min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm"
          />
          <input
            type="date"
            aria-label="Prazo opcional"
            value={goalDeadline}
            onChange={(e) => setGoalDeadline(e.target.value)}
            className="focus-ring min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm"
          />
          <Button type="submit" variant="primary" loading={saving}>
            <Target className="h-4 w-4" aria-hidden="true" />
            Criar meta
          </Button>
        </form>

        <>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {workspace.goals.map((g) => {
            const pct = Math.min(100, Math.round((g.reservedCents / g.targetCents) * 100));
            const remaining = Math.max(0, g.targetCents - g.reservedCents);
            return (
              <div key={g.id} className="rounded-xl border border-[var(--color-border)] p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-sm text-[var(--color-text)]">{g.name}</h3>
                    <p className="text-xs text-[var(--color-text-secondary)]">
                      {g.deadlineDate ? `Prazo: ${formatCivilDateBR(g.deadlineDate)}` : 'Sem prazo definido'}
                    </p>
                  </div>
                  <StatusTag label={`${pct}%`} tone="goal" />
                </div>

                <div className="h-2.5 w-full rounded-sm bg-[var(--color-goal-soft)] overflow-hidden">
                  <div className="h-full bg-[var(--color-goal)]" style={{ width: `${pct}%` }} />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span>
                    Reservado:{' '}
                    <strong className="text-[var(--color-goal)]">
                      <FinancialValue cents={g.reservedCents} privacyMode={privacy} />
                    </strong>{' '}
                    de <FinancialValue cents={g.targetCents} privacyMode={privacy} />
                  </span>
                  <span className="text-[var(--color-text-secondary)]">
                    Falta: <FinancialValue cents={remaining} privacyMode={privacy} />
                  </span>
                </div>

                {contribGoalId === g.id ? (
                  <form onSubmit={handleContribute} className="flex gap-2 pt-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="Valor (R$)"
                      value={contribStr}
                      onChange={(e) => setContribStr(e.target.value)}
                      className="focus-ring financial-value flex-1 min-h-[38px] rounded-lg border border-[var(--color-control-border)] px-2.5 text-sm"
                    />
                    <Button type="submit" variant="primary" loading={saving} className="text-xs">
                      Reservar
                    </Button>
                    <Button variant="ghost" onClick={() => setContribGoalId(null)} className="text-xs">
                      Cancelar
                    </Button>
                  </form>
                ) : (
                  <Button variant="secondary" onClick={() => setContribGoalId(g.id)} className="text-xs">
                    Ajustar reserva virtual
                  </Button>
                )}
              </div>
            );
          })}
        </div>
        <PaginationBar page={goalPg.page} totalPages={goalPg.totalPages} totalItems={goalPg.totalItems} pageSize={goalPg.pageSize} setPage={goalPg.setPage} label="metas" />
        </>
      </section>
    </div>
  );
};
