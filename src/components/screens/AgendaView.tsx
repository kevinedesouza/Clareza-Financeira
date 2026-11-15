import React, { useEffect, useState } from 'react';
import { Obligation, Recurrence, WorkspaceData } from '../../lib/domain/types';
import { computeObligationOpenCents, deriveObligationStatus } from '../../lib/domain/ledger';
import { formatCivilDateBR, parseMoneyToCents, todayCivilSaoPaulo } from '../../lib/domain/money';
import { apiRequest, createOperationKey } from '../../lib/api/client';
import { Button, FinancialValue, StatusTag } from '../ui/Primitives';
import { PaginationBar, usePagination } from '../ui/Pagination';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useToast } from '../ui/Toast';
import { Ban, Calendar, Check, Pause, Pencil, Play, Plus, Repeat, RotateCcw, Trash2, X } from 'lucide-react';

interface Props {
  workspace: WorkspaceData;
  todayDate: string;
  onRefresh: () => Promise<void>;
}

const inputCls =
  'focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]';
const labelCls = 'block text-xs font-medium text-[var(--color-text-secondary)] mb-1';
const iconBtn =
  'focus-ring inline-flex h-10 w-10 md:h-9 md:w-9 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)] cursor-pointer';

const FREQ_LABEL: Record<Recurrence['frequency'], string> = { weekly: 'Semanal', monthly: 'Mensal', yearly: 'Anual' };

function centsToInput(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Janela modal que vira "folha" no celular. Fecha com Esc e ao tocar fora. */
const Sheet: React.FC<{ title: string; onClose: () => void; busy?: boolean; children: React.ReactNode }> = ({ title, onClose, busy, children }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 p-0 md:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div className="w-full max-w-md max-h-[92vh] overflow-y-auto rounded-t-[20px] md:rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 md:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
          <h3 className="text-base font-semibold text-[var(--color-text)]">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Fechar" className={iconBtn}>
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};

type EditTarget = { kind: 'obligation'; ob: Obligation } | { kind: 'recurrence'; rec: Recurrence };
type DeleteTarget = { kind: 'obligation'; ob: Obligation } | { kind: 'recurrence'; rec: Recurrence };

export const AgendaView: React.FC<Props> = ({ workspace, todayDate, onRefresh }) => {
  const toast = useToast();
  const [filterDir, setFilterDir] = useState<'all' | 'payable' | 'receivable'>('all');
  const [showClosed, setShowClosed] = useState(false);
  const [showNewOb, setShowNewOb] = useState(false);
  const [showNewRec, setShowNewRec] = useState(false);
  const [settleTarget, setSettleTarget] = useState<Obligation | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const liquidityAccounts = workspace.accounts.filter((a) => !a.isArchived && a.type !== 'credit_card');
  const activeCategories = workspace.categories.filter((c) => !c.isArchived && (c.kind === 'expense' || c.kind === 'income'));

  // Campos nova conta / recorrência / edição
  const [direction, setDirection] = useState<'payable' | 'receivable'>('payable');
  const [desc, setDesc] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [dueDate, setDueDate] = useState(todayCivilSaoPaulo());
  const [endDate, setEndDate] = useState('');
  const [frequency, setFrequency] = useState<'monthly' | 'weekly' | 'yearly'>('monthly');
  const [accountId, setAccountId] = useState(liquidityAccounts[0]?.id || '');
  const [categoryId, setCategoryId] = useState('');

  // Campos liquidação parcial/total
  const [settleAmountStr, setSettleAmountStr] = useState('');
  const [settleAccId, setSettleAccId] = useState(liquidityAccounts[0]?.id || '');
  const [settleDate, setSettleDate] = useState(todayCivilSaoPaulo());
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const privacy = workspace.profile.privacyMode;
  const categoryMap = new Map(workspace.categories.map((c) => [c.id, c]));
  const accountMap = new Map(workspace.accounts.map((a) => [a.id, a]));

  const obligations = workspace.obligations
    .filter((o) => filterDir === 'all' || o.direction === filterDir)
    .filter((o) => {
      if (showClosed) return true;
      const st = deriveObligationStatus(o, workspace.settlements, todayDate);
      return st !== 'settled' && st !== 'canceled';
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const obPg = usePagination(obligations, undefined, 'agenda');

  const recurrences = [...workspace.recurrences].sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.description.localeCompare(b.description));

  const resetForm = () => {
    setDirection('payable');
    setDesc('');
    setAmountStr('');
    setDueDate(todayCivilSaoPaulo());
    setEndDate('');
    setFrequency('monthly');
    setAccountId(liquidityAccounts[0]?.id || '');
    setCategoryId('');
    setErrorMsg(null);
  };

  const closeForms = () => {
    setShowNewOb(false);
    setShowNewRec(false);
    setEditTarget(null);
    setErrorMsg(null);
  };

  const run = async (fn: () => Promise<void>, fallback: string) => {
    setErrorMsg(null);
    setSaving(true);
    try {
      await fn();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : fallback);
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const cents = parseMoneyToCents(amountStr, ',');
    if (!desc.trim()) return setErrorMsg('Informe a descrição.');
    if (!cents || cents <= 0) return setErrorMsg('Informe um valor maior que zero.');
    await run(async () => {
      if (showNewRec) {
        await apiRequest('/api/recurrences', {
          method: 'POST',
          body: {
            direction,
            description: desc,
            amountCents: cents,
            frequency,
            startDate: dueDate,
            endDate: endDate || undefined,
            accountId: accountId || undefined,
            categoryId: categoryId || undefined,
          },
        });
      } else {
        await apiRequest('/api/obligations', {
          method: 'POST',
          body: { direction, description: desc, originalCents: cents, dueDate, accountId: accountId || undefined, categoryId: categoryId || undefined },
        });
      }
      await onRefresh();
      toast({ message: showNewRec ? 'Recorrência criada.' : 'Conta agendada.' });
      closeForms();
      resetForm();
    }, 'Erro ao salvar.');
  };

  const openEdit = (t: EditTarget) => {
    setShowNewOb(false);
    setShowNewRec(false);
    setErrorMsg(null);
    if (t.kind === 'obligation') {
      setDesc(t.ob.description);
      setAmountStr(centsToInput(t.ob.originalCents));
      setDueDate(t.ob.dueDate);
      setAccountId(t.ob.accountId || '');
      setCategoryId(t.ob.categoryId || '');
    } else {
      setDesc(t.rec.description);
      setAmountStr(centsToInput(t.rec.amountCents));
      setEndDate(t.rec.endDate || '');
      setAccountId(t.rec.accountId || '');
      setCategoryId(t.rec.categoryId || '');
    }
    setEditTarget(t);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    const cents = parseMoneyToCents(amountStr, ',');
    if (!desc.trim()) return setErrorMsg('Informe a descrição.');
    if (!cents || cents <= 0) return setErrorMsg('Informe um valor maior que zero.');
    await run(async () => {
      if (editTarget.kind === 'obligation') {
        await apiRequest(`/api/obligations/${editTarget.ob.id}`, {
          method: 'PATCH',
          body: {
            expectedVersion: editTarget.ob.version,
            description: desc,
            originalCents: cents,
            dueDate,
            accountId: accountId || null,
            categoryId: categoryId || null,
          },
        });
      } else {
        await apiRequest(`/api/recurrences/${editTarget.rec.id}`, {
          method: 'PATCH',
          body: { description: desc, amountCents: cents, endDate: endDate || null, accountId: accountId || null, categoryId: categoryId || null },
        });
      }
      await onRefresh();
      toast({ message: 'Alterações salvas.' });
      closeForms();
      resetForm();
    }, 'Erro ao salvar alterações.');
  };

  const patchQuick = async (path: string, body: Record<string, unknown>, okMsg: string, undoBody?: Record<string, unknown>) => {
    try {
      await apiRequest(path, { method: 'PATCH', body });
      await onRefresh();
      toast({
        message: okMsg,
        ...(undoBody
          ? {
              actionLabel: 'Desfazer',
              onAction: async () => {
                await apiRequest(path, { method: 'PATCH', body: undoBody });
                await onRefresh();
              },
            }
          : {}),
      });
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : 'Não foi possível concluir.', tone: 'error' });
    }
  };

  const handleDelete = async (password?: string) => {
    if (!deleteTarget) return;
    setSaving(true);
    setDeleteError(null);
    try {
      const path = deleteTarget.kind === 'obligation' ? `/api/obligations/${deleteTarget.ob.id}` : `/api/recurrences/${deleteTarget.rec.id}`;
      await apiRequest(path, { method: 'DELETE', body: { password } });
      await onRefresh();
      toast({ message: deleteTarget.kind === 'obligation' ? 'Conta excluída.' : 'Recorrência excluída.' });
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Falha ao excluir.');
    } finally {
      setSaving(false);
    }
  };

  const openSettle = (ob: Obligation) => {
    const open = computeObligationOpenCents(ob, workspace.settlements);
    setSettleTarget(ob);
    setSettleAmountStr(centsToInput(open));
    setSettleAccId(ob.accountId || liquidityAccounts[0]?.id || '');
    setSettleDate(todayCivilSaoPaulo());
    setErrorMsg(null);
  };

  const handleSettle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settleTarget) return;
    const cents = parseMoneyToCents(settleAmountStr, ',');
    if (!cents || cents <= 0) return setErrorMsg('Informe um valor maior que zero.');
    await run(async () => {
      await apiRequest(`/api/obligations/${settleTarget.id}/settlements`, {
        method: 'POST',
        idempotencyKey: createOperationKey(),
        body: { accountId: settleAccId || liquidityAccounts[0]?.id, amountCents: cents, effectiveDate: settleDate },
      });
      await onRefresh();
      toast({ message: settleTarget.direction === 'receivable' ? 'Recebimento registrado.' : 'Pagamento registrado.' });
      setSettleTarget(null);
    }, 'Erro ao registrar pagamento.');
  };

  const statusInfo = (ob: Obligation) => {
    const status = deriveObligationStatus(ob, workspace.settlements, todayDate);
    const label =
      status === 'settled'
        ? ob.direction === 'receivable' ? 'Recebida' : 'Paga'
        : status === 'partially_settled'
          ? 'Parcial'
          : status === 'overdue'
            ? 'Vencida'
            : status === 'canceled'
              ? 'Cancelada'
              : 'Prevista';
    const tone =
      status === 'settled' ? 'income' : status === 'overdue' ? 'expense' : status === 'partially_settled' ? 'warning' : 'neutral';
    return { status, label, tone } as const;
  };

  const editingObligation = editTarget?.kind === 'obligation';
  const editingRecurrence = editTarget?.kind === 'recurrence';
  const formOpen = showNewOb || showNewRec || !!editTarget;
  const formTitle = editingObligation
    ? 'Editar conta agendada'
    : editingRecurrence
      ? 'Editar recorrência'
      : showNewRec
        ? 'Nova recorrência'
        : 'Agendar conta a pagar ou receber';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg bg-[var(--color-surface-muted)] p-1" role="tablist" aria-label="Filtrar agenda">
            {(
              [
                { id: 'all', label: 'Todos' },
                { id: 'payable', label: 'A pagar' },
                { id: 'receivable', label: 'A receber' },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={filterDir === t.id}
                onClick={() => setFilterDir(t.id)}
                className={`focus-ring min-h-[40px] rounded-md px-3 text-xs font-medium cursor-pointer ${
                  filterDir === t.id ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm' : 'text-[var(--color-text-secondary)]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)] cursor-pointer">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} className="h-4 w-4" />
            Mostrar pagas e canceladas
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              resetForm();
              setEditTarget(null);
              setShowNewRec(true);
            }}
          >
            <Repeat className="h-4 w-4" aria-hidden="true" />
            Nova recorrência
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              resetForm();
              setEditTarget(null);
              setShowNewOb(true);
            }}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Agendar conta
          </Button>
        </div>
      </div>

      {obligations.length === 0 ? (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center">
          <Calendar className="mx-auto h-8 w-8 text-[var(--color-text-secondary)]" aria-hidden="true" />
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
            Nenhuma conta {showClosed ? '' : 'em aberto '}neste filtro. Use "Agendar conta" para lembrar de um pagamento ou recebimento.
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] divide-y divide-[var(--color-border)]">
            {obPg.pageItems.map((ob) => {
              const open = computeObligationOpenCents(ob, workspace.settlements);
              const { status, label, tone } = statusInfo(ob);
              const hasPayments = workspace.settlements.some((st) => st.obligationId === ob.id);
              const closed = status === 'settled' || status === 'canceled';
              const acc = ob.accountId ? accountMap.get(ob.accountId) : undefined;
              const cat = ob.categoryId ? categoryMap.get(ob.categoryId) : undefined;
              return (
                <div key={ob.id} className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-sm text-[var(--color-text)]">{ob.description}</span>
                      <StatusTag label={label} tone={tone} />
                      {ob.recurrenceId && <StatusTag label="Recorrente" tone="transfer" />}
                    </div>
                    <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                      Vence em {formatCivilDateBR(ob.dueDate)} · {ob.direction === 'receivable' ? 'A receber' : 'A pagar'} · Valor:{' '}
                      <FinancialValue cents={ob.originalCents} privacyMode={privacy} />
                      {acc ? ` · ${acc.name}` : ''}
                      {cat ? ` · ${cat.name}` : ''}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 md:justify-end md:shrink-0">
                    <div className="md:text-right md:mr-1">
                      <span className="block text-[11px] text-[var(--color-text-secondary)]">Em aberto</span>
                      <span className={`text-sm font-bold ${ob.direction === 'receivable' ? 'text-[var(--color-income)]' : 'text-[var(--color-text)]'}`}>
                        <FinancialValue cents={open} privacyMode={privacy} />
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      {open > 0 && !closed && (
                        <Button variant="secondary" onClick={() => openSettle(ob)} className="text-xs">
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          {ob.direction === 'receivable' ? 'Recebi' : 'Paguei'}
                        </Button>
                      )}
                      {!closed && (
                        <button type="button" onClick={() => openEdit({ kind: 'obligation', ob })} aria-label={`Editar ${ob.description}`} title="Editar" className={iconBtn}>
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                      {status === 'canceled' || (closed && ob.canceledCents > 0) ? (
                        <button
                          type="button"
                          onClick={() => patchQuick(`/api/obligations/${ob.id}`, { reopen: true }, 'Conta reaberta.')}
                          aria-label={`Reabrir ${ob.description}`}
                          title="Reabrir"
                          className={iconBtn}
                        >
                          <RotateCcw className="h-4 w-4" aria-hidden="true" />
                        </button>
                      ) : (
                        !closed && (
                          <button
                            type="button"
                            onClick={() =>
                              patchQuick(
                                `/api/obligations/${ob.id}`,
                                { cancelRemaining: true },
                                hasPayments ? 'Saldo restante cancelado.' : 'Conta cancelada.',
                                { reopen: true }
                              )
                            }
                            aria-label={hasPayments ? `Cancelar saldo restante de ${ob.description}` : `Cancelar ${ob.description}`}
                            title={hasPayments ? 'Cancelar saldo restante' : 'Cancelar (não vai mais acontecer)'}
                            className={iconBtn}
                          >
                            <Ban className="h-4 w-4" aria-hidden="true" />
                          </button>
                        )
                      )}
                      {!hasPayments && (
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteError(null);
                            setDeleteTarget({ kind: 'obligation', ob });
                          }}
                          aria-label={`Excluir ${ob.description}`}
                          title="Excluir"
                          className={`${iconBtn} hover:text-[var(--color-expense)]`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <PaginationBar page={obPg.page} totalPages={obPg.totalPages} totalItems={obPg.totalItems} pageSize={obPg.pageSize} setPage={obPg.setPage} label="contas" />
        </>
      )}

      {/* Recorrências */}
      <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:p-5 space-y-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--color-text)]">Recorrências</h2>
          <p className="text-xs text-[var(--color-text-secondary)]">
            Contas que se repetem (aluguel, assinaturas, salário). O app agenda automaticamente as próximas ocorrências.
          </p>
        </div>
        {recurrences.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-text-secondary)]">
            Nenhuma recorrência cadastrada.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {recurrences.map((rec) => {
              const ended = !!rec.endDate && rec.endDate < todayDate;
              return (
                <li key={rec.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-sm font-medium ${rec.isActive && !ended ? 'text-[var(--color-text)]' : 'text-[var(--color-text-secondary)] line-through'}`}>
                        {rec.description}
                      </span>
                      <StatusTag
                        label={!rec.isActive ? 'Pausada' : ended ? 'Encerrada' : rec.endDate ? `Até ${formatCivilDateBR(rec.endDate)}` : 'Ativa'}
                        tone={!rec.isActive || ended ? 'neutral' : 'income'}
                      />
                    </div>
                    <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                      {FREQ_LABEL[rec.frequency]} · {rec.direction === 'receivable' ? 'A receber' : 'A pagar'} ·{' '}
                      <FinancialValue cents={rec.amountCents} privacyMode={privacy} /> · desde {formatCivilDateBR(rec.startDate)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button type="button" onClick={() => openEdit({ kind: 'recurrence', rec })} aria-label={`Editar recorrência ${rec.description}`} title="Editar" className={iconBtn}>
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </button>
                    {rec.isActive ? (
                      <button
                        type="button"
                        onClick={() =>
                          patchQuick(`/api/recurrences/${rec.id}`, { isActive: false }, 'Recorrência pausada.', { isActive: true })
                        }
                        aria-label={`Pausar ${rec.description}`}
                        title="Pausar"
                        className={iconBtn}
                      >
                        <Pause className="h-4 w-4" aria-hidden="true" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => patchQuick(`/api/recurrences/${rec.id}`, { isActive: true }, 'Recorrência retomada.')}
                        aria-label={`Retomar ${rec.description}`}
                        title="Retomar"
                        className={iconBtn}
                      >
                        <Play className="h-4 w-4" aria-hidden="true" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteError(null);
                        setDeleteTarget({ kind: 'recurrence', rec });
                      }}
                      aria-label={`Excluir recorrência ${rec.description}`}
                      title="Excluir"
                      className={`${iconBtn} hover:text-[var(--color-expense)]`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Formulário: nova conta, nova recorrência ou edição */}
      {formOpen && (
        <Sheet title={formTitle} onClose={closeForms} busy={saving}>
          <form onSubmit={editTarget ? handleSaveEdit : handleCreate} className="mt-4 space-y-4">
            {!editTarget && (
              <div className="grid grid-cols-2 gap-2 rounded-lg bg-[var(--color-surface-muted)] p-1" role="radiogroup" aria-label="Tipo">
                {(['payable', 'receivable'] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    role="radio"
                    aria-checked={direction === d}
                    onClick={() => setDirection(d)}
                    className={`focus-ring min-h-[40px] rounded-md text-xs font-medium cursor-pointer ${
                      direction === d ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm' : 'text-[var(--color-text-secondary)]'
                    }`}
                  >
                    {d === 'payable' ? 'A pagar' : 'A receber'}
                  </button>
                ))}
              </div>
            )}
            <div>
              <label htmlFor="ag-desc" className={labelCls}>
                Descrição
              </label>
              <input id="ag-desc" type="text" required value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Ex.: Conta de luz" className={inputCls} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="ag-amount" className={labelCls}>
                  Valor (R$)
                </label>
                <input id="ag-amount" type="text" inputMode="decimal" required value={amountStr} onChange={(e) => setAmountStr(e.target.value)} placeholder="Ex.: 150,00" className={`${inputCls} financial-value`} />
              </div>
              {!editingRecurrence && (
                <div>
                  <label htmlFor="ag-date" className={labelCls}>
                    {showNewRec ? 'Primeira data' : 'Vencimento'}
                  </label>
                  <input id="ag-date" type="date" required value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} />
                </div>
              )}
              {(showNewRec || editingRecurrence) && (
                <div>
                  <label htmlFor="ag-end" className={labelCls}>
                    Termina em (opcional)
                  </label>
                  <input id="ag-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputCls} />
                </div>
              )}
            </div>
            {showNewRec && (
              <div>
                <label htmlFor="ag-freq" className={labelCls}>
                  Repete
                </label>
                <select id="ag-freq" value={frequency} onChange={(e) => setFrequency(e.target.value as 'monthly' | 'weekly' | 'yearly')} className={inputCls}>
                  <option value="monthly">Todo mês (dia 31 vira o último dia do mês)</option>
                  <option value="weekly">Toda semana</option>
                  <option value="yearly">Todo ano</option>
                </select>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="ag-acc" className={labelCls}>
                  Conta (opcional)
                </label>
                <select id="ag-acc" value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputCls}>
                  <option value="">Sem conta definida</option>
                  {liquidityAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="ag-cat" className={labelCls}>
                  Categoria (opcional)
                </label>
                <select id="ag-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputCls}>
                  <option value="">Sem categoria</option>
                  {activeCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {editingRecurrence && (
              <p className="rounded-lg bg-[var(--color-surface-muted)] p-3 text-xs text-[var(--color-text-secondary)]">
                As mudanças valem para as próximas ocorrências que ainda não foram pagas. As já pagas não mudam.
              </p>
            )}
            {errorMsg && (
              <p role="alert" className="rounded-lg bg-[var(--color-expense-soft)] px-3 py-2 text-xs text-[var(--color-expense)]">
                {errorMsg}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
              <Button variant="ghost" onClick={closeForms} disabled={saving}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" loading={saving}>
                {editTarget ? 'Salvar alterações' : 'Salvar'}
              </Button>
            </div>
          </form>
        </Sheet>
      )}

      {/* Pagamento / recebimento (parcial ou total) */}
      {settleTarget && (
        <Sheet title={settleTarget.direction === 'receivable' ? 'Registrar recebimento' : 'Registrar pagamento'} onClose={() => setSettleTarget(null)} busy={saving}>
          <form onSubmit={handleSettle} className="mt-4 space-y-4">
            <p className="text-xs text-[var(--color-text-secondary)]">
              <strong className="text-[var(--color-text)]">{settleTarget.description}</strong>. Pode ser um valor parcial: o restante continua em aberto.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="st-amount" className={labelCls}>
                  Valor (R$)
                </label>
                <input id="st-amount" type="text" inputMode="decimal" required value={settleAmountStr} onChange={(e) => setSettleAmountStr(e.target.value)} className={`${inputCls} financial-value font-semibold`} />
              </div>
              <div>
                <label htmlFor="st-date" className={labelCls}>
                  Data
                </label>
                <input id="st-date" type="date" value={settleDate} onChange={(e) => setSettleDate(e.target.value)} className={inputCls} />
              </div>
            </div>
            <div>
              <label htmlFor="st-acc" className={labelCls}>
                {settleTarget.direction === 'receivable' ? 'Recebido na conta' : 'Pago com a conta'}
              </label>
              <select id="st-acc" value={settleAccId} onChange={(e) => setSettleAccId(e.target.value)} className={inputCls}>
                {liquidityAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            {errorMsg && (
              <p role="alert" className="rounded-lg bg-[var(--color-expense-soft)] px-3 py-2 text-xs text-[var(--color-expense)]">
                {errorMsg}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
              <Button variant="ghost" onClick={() => setSettleTarget(null)} disabled={saving}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" loading={saving}>
                Confirmar
              </Button>
            </div>
          </form>
        </Sheet>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title={deleteTarget?.kind === 'recurrence' ? 'Excluir esta recorrência?' : 'Excluir esta conta agendada?'}
        message={
          deleteTarget?.kind === 'recurrence'
            ? `"${deleteTarget.rec.description}" deixa de se repetir e as próximas ocorrências ainda não pagas somem da agenda. As já pagas continuam no histórico. Se quiser só parar por um tempo, use "Pausar".`
            : deleteTarget
              ? `"${deleteTarget.ob.description}" (vence em ${formatCivilDateBR(deleteTarget.ob.dueDate)}) será apagada da agenda e das previsões.`
              : ''
        }
        confirmLabel="Excluir"
        destructive
        requirePassword
        error={deleteError}
        loading={saving}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
