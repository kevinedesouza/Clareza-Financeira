import React, { useState } from 'react';
import { Budget, Goal, WorkspaceData } from '../../lib/domain/types';
import { computeDashboardMetrics, evaluateBudget } from '../../lib/domain/ledger';
import { daysInMonth, formatCivilDateBR, parseMoneyToCents } from '../../lib/domain/money';
import { apiRequest } from '../../lib/api/client';
import { Button, FinancialValue, StatusTag } from '../ui/Primitives';
import { PaginationBar, usePagination } from '../ui/Pagination';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Pencil, Plus, Target, Trash2 } from 'lucide-react';

interface Props {
  workspace: WorkspaceData;
  monthKey: string;
  todayDate: string;
  onRefresh: () => Promise<void>;
}

const inputClass =
  'focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]';
const labelClass = 'mb-1 block text-xs font-medium text-[var(--color-text-secondary)]';

/** "2026-11" → "novembro de 2026" */
function formatMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  if (!y || !m) return monthKey;
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Centavos → "1.234,56" para preencher campos de edição */
function centsToInput(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type PendingDelete = { kind: 'goal'; goal: Goal } | { kind: 'budget'; budget: Budget; categoryName: string };

export const PlanningView: React.FC<Props> = ({ workspace, monthKey, todayDate, onRefresh }) => {
  const expenseCategories = workspace.categories.filter((c) => c.kind === 'expense' && !c.isArchived);
  const [budCatId, setBudCatId] = useState(expenseCategories[0]?.id || '');
  const [budLimitStr, setBudLimitStr] = useState('');
  const [budgetSaving, setBudgetSaving] = useState(false);

  const [goalName, setGoalName] = useState('');
  const [goalTargetStr, setGoalTargetStr] = useState('');
  const [goalDeadline, setGoalDeadline] = useState('');
  const [goalSaving, setGoalSaving] = useState(false);

  const [contribGoalId, setContribGoalId] = useState<string | null>(null);
  const [contribStr, setContribStr] = useState('');
  const [contribMode, setContribMode] = useState<'add' | 'withdraw'>('add');

  const [editGoalId, setEditGoalId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editTargetStr, setEditTargetStr] = useState('');
  const [editDeadline, setEditDeadline] = useState('');
  const [rowSaving, setRowSaving] = useState(false);

  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  const privacy = workspace.profile.privacyMode;
  const categoryMap = new Map(workspace.categories.map((c) => [c.id, c]));
  const monthBudgets = workspace.budgets.filter((b) => b.monthKey === monthKey);
  const monthLabel = formatMonthLabel(monthKey);

  const [mY, mM] = monthKey.split('-').map(Number);
  const metrics = computeDashboardMetrics(workspace, {
    periodStart: `${monthKey}-01`,
    periodEnd: `${monthKey}-${String(daysInMonth(mY, mM)).padStart(2, '0')}`,
    todayDate,
  });

  const fail = (err: unknown, fallback: string) =>
    setMsg({ tone: 'error', text: err instanceof Error ? err.message : fallback });

  const handleSaveBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const cents = parseMoneyToCents(budLimitStr, ',');
    if (!cents || cents <= 0 || !budCatId) {
      setMsg({ tone: 'error', text: 'Selecione uma categoria e informe um limite maior que zero.' });
      return;
    }
    setBudgetSaving(true);
    try {
      await apiRequest('/api/budgets', {
        method: 'POST',
        body: { monthKey, categoryId: budCatId, limitCents: cents, alertThresholdPct: 80 },
      });
      await onRefresh();
      setBudLimitStr('');
      setMsg({ tone: 'success', text: 'Limite salvo.' });
    } catch (err) {
      fail(err, 'Erro ao salvar orçamento.');
    } finally {
      setBudgetSaving(false);
    }
  };

  const startEditBudget = (b: Budget) => {
    setBudCatId(b.categoryId);
    setBudLimitStr(centsToInput(b.limitCents));
    setMsg(null);
    document.getElementById('budget-limit')?.focus();
  };

  const handleSaveGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const cents = parseMoneyToCents(goalTargetStr, ',');
    if (!goalName.trim() || !cents || cents <= 0) {
      setMsg({ tone: 'error', text: 'Informe o nome da meta e um valor-alvo maior que zero.' });
      return;
    }
    setGoalSaving(true);
    try {
      await apiRequest('/api/goals', {
        method: 'POST',
        body: { name: goalName, targetCents: cents, deadlineDate: goalDeadline || undefined },
      });
      await onRefresh();
      setGoalName('');
      setGoalTargetStr('');
      setGoalDeadline('');
      setMsg({ tone: 'success', text: 'Meta criada.' });
    } catch (err) {
      fail(err, 'Erro ao criar meta.');
    } finally {
      setGoalSaving(false);
    }
  };

  const openContribute = (g: Goal) => {
    setEditGoalId(null);
    setContribGoalId(g.id);
    setContribStr('');
    setContribMode('add');
  };

  const handleContribute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contribGoalId) return;
    setMsg(null);
    const cents = parseMoneyToCents(contribStr, ',');
    if (!cents || cents <= 0) {
      setMsg({ tone: 'error', text: 'Informe um valor maior que zero.' });
      return;
    }
    setRowSaving(true);
    try {
      await apiRequest(`/api/goals/${contribGoalId}/contribute`, {
        method: 'POST',
        body: { amountCents: contribMode === 'withdraw' ? -cents : cents },
      });
      await onRefresh();
      setContribGoalId(null);
      setContribStr('');
    } catch (err) {
      fail(err, 'Erro ao ajustar a reserva da meta.');
    } finally {
      setRowSaving(false);
    }
  };

  const openEditGoal = (g: Goal) => {
    setContribGoalId(null);
    setEditGoalId(g.id);
    setEditName(g.name);
    setEditTargetStr(centsToInput(g.targetCents));
    setEditDeadline(g.deadlineDate || '');
  };

  const handleUpdateGoal = async (e: React.FormEvent, g: Goal) => {
    e.preventDefault();
    setMsg(null);
    const cents = parseMoneyToCents(editTargetStr, ',');
    if (!editName.trim() || !cents || cents <= 0) {
      setMsg({ tone: 'error', text: 'Informe o nome da meta e um valor-alvo maior que zero.' });
      return;
    }
    setRowSaving(true);
    try {
      await apiRequest(`/api/goals/${g.id}`, {
        method: 'PATCH',
        body: { expectedVersion: g.version, name: editName, targetCents: cents, deadlineDate: editDeadline || null },
      });
      await onRefresh();
      setEditGoalId(null);
      setMsg({ tone: 'success', text: 'Meta atualizada.' });
    } catch (err) {
      fail(err, 'Erro ao atualizar a meta.');
    } finally {
      setRowSaving(false);
    }
  };

  const handleConfirmDelete = async (password?: string) => {
    if (!pendingDelete) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const path =
        pendingDelete.kind === 'goal' ? `/api/goals/${pendingDelete.goal.id}` : `/api/budgets/${pendingDelete.budget.id}`;
      await apiRequest(path, { method: 'DELETE', body: { password } });
      await onRefresh();
      setMsg({ tone: 'success', text: pendingDelete.kind === 'goal' ? 'Meta excluída.' : 'Limite removido.' });
      setPendingDelete(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Falha ao excluir.');
    } finally {
      setDeleteBusy(false);
    }
  };

  const goalPg = usePagination(workspace.goals, undefined, 'metas');
  const budgetPg = usePagination(monthBudgets, undefined, 'orcamentos');

  const iconBtn =
    'focus-ring inline-flex h-10 w-10 md:h-9 md:w-9 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)] cursor-pointer';

  return (
    <div className="space-y-6 md:space-y-8">
      {msg && (
        <div
          role={msg.tone === 'error' ? 'alert' : 'status'}
          className={`rounded-lg px-4 py-2.5 text-xs ${
            msg.tone === 'error'
              ? 'bg-[var(--color-expense-soft)] text-[var(--color-expense)]'
              : 'bg-[var(--color-income-soft)] text-[var(--color-income)]'
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* Orçamentos */}
      <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-5 md:p-6 space-y-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text)]">
              Orçamentos de <span className="first-letter:uppercase inline-block">{monthLabel}</span>
            </h2>
            <p className="text-xs text-[var(--color-text-secondary)]">
              Limite de gasto por categoria no mês. Você recebe alerta ao chegar em 80% e ao passar de 100%.
            </p>
          </div>
          <StatusTag label="Por competência" tone="neutral" />
        </div>

        <form onSubmit={handleSaveBudget} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-end">
          <div>
            <label htmlFor="budget-cat" className={labelClass}>
              Categoria
            </label>
            <select id="budget-cat" value={budCatId} onChange={(e) => setBudCatId(e.target.value)} className={inputClass}>
              {expenseCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="budget-limit" className={labelClass}>
              Limite no mês (R$)
            </label>
            <input
              id="budget-limit"
              type="text"
              inputMode="decimal"
              placeholder="Ex.: 900,00"
              value={budLimitStr}
              onChange={(e) => setBudLimitStr(e.target.value)}
              className={`${inputClass} financial-value`}
            />
          </div>
          <Button type="submit" variant="primary" loading={budgetSaving} className="sm:col-span-2 lg:col-span-1">
            <Plus className="h-4 w-4" aria-hidden="true" />
            {monthBudgets.some((b) => b.categoryId === budCatId) ? 'Atualizar limite' : 'Definir limite'}
          </Button>
        </form>

        <div className="space-y-3">
          {monthBudgets.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-text-secondary)]">
              Nenhum limite definido para {monthLabel}. Escolha uma categoria acima e defina quanto quer gastar no mês.
            </p>
          ) : (
            <>
              {budgetPg.pageItems.map((b) => {
                const res = evaluateBudget(b, workspace.events, workspace.categories);
                const catName = categoryMap.get(b.categoryId)?.name ?? 'Categoria';
                return (
                  <div key={b.id} className="rounded-lg border border-[var(--color-border)] p-3 sm:p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-sm text-[var(--color-text)]">{catName}</span>
                          <StatusTag
                            label={res.status === 'exceeded' ? 'Excedido' : res.status === 'warning' ? 'Atenção ≥80%' : 'Dentro do limite'}
                            tone={res.status === 'exceeded' ? 'expense' : res.status === 'warning' ? 'warning' : 'income'}
                          />
                        </div>
                        <p className="text-xs text-[var(--color-text-secondary)]">
                          <FinancialValue cents={res.spentCents} privacyMode={privacy} /> de{' '}
                          <FinancialValue cents={b.limitCents} privacyMode={privacy} /> ({res.pct.toFixed(1)}%)
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center">
                        <button type="button" onClick={() => startEditBudget(b)} aria-label={`Editar limite de ${catName}`} title="Editar limite" className={iconBtn}>
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteError(null);
                            setPendingDelete({ kind: 'budget', budget: b, categoryName: catName });
                          }}
                          aria-label={`Remover limite de ${catName}`}
                          title="Remover limite"
                          className={`${iconBtn} hover:text-[var(--color-expense)]`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                    <div
                      className="relative h-2.5 w-full rounded-sm bg-[var(--color-surface-muted)] overflow-hidden"
                      role="progressbar"
                      aria-label={`Uso do limite de ${catName}`}
                      aria-valuenow={Math.round(res.pct)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
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
                        Passou do limite em <FinancialValue cents={res.excessCents} privacyMode={privacy} />
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
      <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-5 md:p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text)]">Metas e reservas</h2>
            <p className="text-xs text-[var(--color-text-secondary)]">
              Separe mentalmente parte do seu saldo para um objetivo. A reserva não movimenta dinheiro no banco. Livre
              após metas:{' '}
              <strong className="text-[var(--color-text)]">
                <FinancialValue cents={metrics.freeAfterReservesCents} privacyMode={privacy} />
              </strong>
            </p>
          </div>
          <StatusTag label="Planejamento" tone="goal" />
        </div>

        <form onSubmit={handleSaveGoal} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          <div>
            <label htmlFor="goal-name" className={labelClass}>
              Nome da meta
            </label>
            <input id="goal-name" type="text" placeholder="Ex.: Viagem de férias" value={goalName} onChange={(e) => setGoalName(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor="goal-target" className={labelClass}>
              Valor-alvo (R$)
            </label>
            <input
              id="goal-target"
              type="text"
              inputMode="decimal"
              placeholder="Ex.: 10.000,00"
              value={goalTargetStr}
              onChange={(e) => setGoalTargetStr(e.target.value)}
              className={`${inputClass} financial-value`}
            />
          </div>
          <div>
            <label htmlFor="goal-deadline" className={labelClass}>
              Prazo (opcional)
            </label>
            <input id="goal-deadline" type="date" value={goalDeadline} min={todayDate} onChange={(e) => setGoalDeadline(e.target.value)} className={inputClass} />
          </div>
          <Button type="submit" variant="primary" loading={goalSaving}>
            <Target className="h-4 w-4" aria-hidden="true" />
            Criar meta
          </Button>
        </form>

        {workspace.goals.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-text-secondary)]">
            Você ainda não tem metas. Crie a primeira acima: dê um nome, o valor que quer juntar e, se quiser, um prazo.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {goalPg.pageItems.map((g) => {
                const pct = Math.min(100, Math.round((g.reservedCents / g.targetCents) * 100));
                const remaining = Math.max(0, g.targetCents - g.reservedCents);
                const editing = editGoalId === g.id;
                return (
                  <div key={g.id} className="rounded-xl border border-[var(--color-border)] p-4 space-y-3">
                    {editing ? (
                      <form onSubmit={(e) => handleUpdateGoal(e, g)} className="space-y-3">
                        <div>
                          <label htmlFor={`eg-name-${g.id}`} className={labelClass}>
                            Nome da meta
                          </label>
                          <input id={`eg-name-${g.id}`} type="text" value={editName} onChange={(e) => setEditName(e.target.value)} className={inputClass} />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label htmlFor={`eg-target-${g.id}`} className={labelClass}>
                              Valor-alvo (R$)
                            </label>
                            <input
                              id={`eg-target-${g.id}`}
                              type="text"
                              inputMode="decimal"
                              value={editTargetStr}
                              onChange={(e) => setEditTargetStr(e.target.value)}
                              className={`${inputClass} financial-value`}
                            />
                          </div>
                          <div>
                            <label htmlFor={`eg-deadline-${g.id}`} className={labelClass}>
                              Prazo (opcional)
                            </label>
                            <input id={`eg-deadline-${g.id}`} type="date" value={editDeadline} onChange={(e) => setEditDeadline(e.target.value)} className={inputClass} />
                          </div>
                        </div>
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button variant="ghost" onClick={() => setEditGoalId(null)} disabled={rowSaving}>
                            Cancelar
                          </Button>
                          <Button type="submit" variant="primary" loading={rowSaving}>
                            Salvar meta
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="font-semibold text-sm text-[var(--color-text)] break-words">{g.name}</h3>
                              <StatusTag label={`${pct}%`} tone="goal" />
                            </div>
                            <p className="text-xs text-[var(--color-text-secondary)]">
                              {g.deadlineDate ? `Prazo: ${formatCivilDateBR(g.deadlineDate)}` : 'Sem prazo definido'}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center">
                            <button type="button" onClick={() => openEditGoal(g)} aria-label={`Editar meta ${g.name}`} title="Editar meta" className={iconBtn}>
                              <Pencil className="h-4 w-4" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setDeleteError(null);
                                setPendingDelete({ kind: 'goal', goal: g });
                              }}
                              aria-label={`Excluir meta ${g.name}`}
                              title="Excluir meta"
                              className={`${iconBtn} hover:text-[var(--color-expense)]`}
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </button>
                          </div>
                        </div>

                        <div
                          className="h-2.5 w-full rounded-sm bg-[var(--color-goal-soft)] overflow-hidden"
                          role="progressbar"
                          aria-label={`Progresso da meta ${g.name}`}
                          aria-valuenow={pct}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        >
                          <div className="h-full bg-[var(--color-goal)]" style={{ width: `${pct}%` }} />
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
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
                          <form onSubmit={handleContribute} className="space-y-2 pt-1">
                            <div className="grid grid-cols-2 gap-1 rounded-lg bg-[var(--color-surface-muted)] p-1" role="radiogroup" aria-label="Tipo de ajuste">
                              {(['add', 'withdraw'] as const).map((mode) => (
                                <button
                                  key={mode}
                                  type="button"
                                  role="radio"
                                  aria-checked={contribMode === mode}
                                  onClick={() => setContribMode(mode)}
                                  className={`focus-ring min-h-[40px] rounded-md text-xs font-medium cursor-pointer ${
                                    contribMode === mode
                                      ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm'
                                      : 'text-[var(--color-text-secondary)]'
                                  }`}
                                >
                                  {mode === 'add' ? 'Guardar' : 'Retirar'}
                                </button>
                              ))}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <input
                                type="text"
                                inputMode="decimal"
                                aria-label={contribMode === 'add' ? 'Valor a guardar na meta' : 'Valor a retirar da meta'}
                                placeholder="Valor (R$)"
                                value={contribStr}
                                onChange={(e) => setContribStr(e.target.value)}
                                autoFocus
                                className={`${inputClass} financial-value flex-1 min-w-[140px] w-auto`}
                              />
                              <Button type="submit" variant="primary" loading={rowSaving}>
                                {contribMode === 'add' ? 'Guardar' : 'Retirar'}
                              </Button>
                              <Button variant="ghost" onClick={() => setContribGoalId(null)} disabled={rowSaving}>
                                Cancelar
                              </Button>
                            </div>
                          </form>
                        ) : (
                          <Button variant="secondary" onClick={() => openContribute(g)} className="w-full sm:w-auto">
                            Guardar ou retirar valor
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            <PaginationBar page={goalPg.page} totalPages={goalPg.totalPages} totalItems={goalPg.totalItems} pageSize={goalPg.pageSize} setPage={goalPg.setPage} label="metas" />
          </>
        )}
      </section>

      <ConfirmDialog
        open={!!pendingDelete}
        title={pendingDelete?.kind === 'goal' ? 'Excluir esta meta?' : 'Remover este limite?'}
        message={
          pendingDelete?.kind === 'goal'
            ? `A meta "${pendingDelete.goal.name}" e o histórico de reservas dela serão apagados. Seu saldo bancário não muda.`
            : pendingDelete
              ? `O limite de ${pendingDelete.categoryName} em ${monthLabel} será removido. Seus lançamentos não mudam.`
              : ''
        }
        confirmLabel={pendingDelete?.kind === 'goal' ? 'Excluir meta' : 'Remover limite'}
        destructive
        requirePassword
        error={deleteError}
        loading={deleteBusy}
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
};
