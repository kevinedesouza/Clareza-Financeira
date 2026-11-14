import React, { useState } from 'react';
import { Obligation, WorkspaceData } from '../../lib/domain/types';
import { computeObligationOpenCents, deriveObligationStatus } from '../../lib/domain/ledger';
import { formatCivilDateBR, parseMoneyToCents, todayCivilSaoPaulo } from '../../lib/domain/money';
import { apiRequest, createOperationKey } from '../../lib/api/client';
import { Button, FinancialValue, StatusTag } from '../ui/Primitives';
import { Calendar, Check, Plus, Repeat, X } from 'lucide-react';

interface Props {
  workspace: WorkspaceData;
  todayDate: string;
  onRefresh: () => Promise<void>;
}

export const AgendaView: React.FC<Props> = ({ workspace, todayDate, onRefresh }) => {
  const [filterDir, setFilterDir] = useState<'all' | 'payable' | 'receivable'>('all');
  const [showNewOb, setShowNewOb] = useState(false);
  const [showNewRec, setShowNewRec] = useState(false);
  const [settleTarget, setSettleTarget] = useState<Obligation | null>(null);

  // Campos nova obrigação / recorrência
  const [direction, setDirection] = useState<'payable' | 'receivable'>('payable');
  const [desc, setDesc] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [dueDate, setDueDate] = useState(todayCivilSaoPaulo());
  const [frequency, setFrequency] = useState<'monthly' | 'weekly' | 'yearly'>('monthly');
  const [accountId, setAccountId] = useState(workspace.accounts[0]?.id || '');

  // Campos liquidação parcial/total
  const [settleAmountStr, setSettleAmountStr] = useState('');
  const [settleAccId, setSettleAccId] = useState(workspace.accounts[0]?.id || '');
  const [settleDate, setSettleDate] = useState(todayCivilSaoPaulo());
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const privacy = workspace.profile.privacyMode;
  const liquidityAccounts = workspace.accounts.filter((a) => !a.isArchived && a.type !== 'credit_card');

  const obligations = workspace.obligations
    .filter((o) => filterDir === 'all' || o.direction === filterDir)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const handleCreateObligation = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const cents = parseMoneyToCents(amountStr, ',');
    if (!cents || cents <= 0) {
      setErrorMsg('Informe um valor positivo.');
      return;
    }
    setSaving(true);
    try {
      await apiRequest('/api/obligations', {
        method: 'POST',
        body: { direction, description: desc, originalCents: cents, dueDate, accountId: accountId || undefined },
      });
      await onRefresh();
      setShowNewOb(false);
      setDesc('');
      setAmountStr('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao cadastrar conta.');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateRecurrence = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const cents = parseMoneyToCents(amountStr, ',');
    if (!cents || cents <= 0) {
      setErrorMsg('Informe um valor positivo.');
      return;
    }
    setSaving(true);
    try {
      await apiRequest('/api/recurrences', {
        method: 'POST',
        body: {
          direction,
          description: desc,
          amountCents: cents,
          frequency,
          startDate: dueDate,
          accountId: accountId || undefined,
        },
      });
      await onRefresh();
      setShowNewRec(false);
      setDesc('');
      setAmountStr('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao criar recorrência.');
    } finally {
      setSaving(false);
    }
  };

  const openSettle = (ob: Obligation) => {
    const open = computeObligationOpenCents(ob, workspace.settlements);
    setSettleTarget(ob);
    setSettleAmountStr((open / 100).toFixed(2).replace('.', ','));
    setSettleAccId(ob.accountId || liquidityAccounts[0]?.id || '');
    setErrorMsg(null);
  };

  const handleSettle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settleTarget) return;
    setErrorMsg(null);
    const cents = parseMoneyToCents(settleAmountStr, ',');
    if (!cents || cents <= 0) {
      setErrorMsg('Informe um valor de liquidação positivo.');
      return;
    }
    setSaving(true);
    try {
      await apiRequest(`/api/obligations/${settleTarget.id}/settlements`, {
        method: 'POST',
        idempotencyKey: createOperationKey(),
        body: {
          accountId: settleAccId || liquidityAccounts[0]?.id,
          amountCents: cents,
          effectiveDate: settleDate,
        },
      });
      await onRefresh();
      setSettleTarget(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao registrar liquidação.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg bg-[var(--color-surface-muted)] p-1">
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
              onClick={() => setFilterDir(t.id)}
              className={`min-h-[36px] rounded-md px-3 text-xs font-medium cursor-pointer ${
                filterDir === t.id
                  ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm'
                  : 'text-[var(--color-text-secondary)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setShowNewRec(true)}>
            <Repeat className="h-4 w-4" aria-hidden="true" />
            Nova recorrência
          </Button>
          <Button variant="primary" onClick={() => setShowNewOb(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Agendar conta
          </Button>
        </div>
      </div>

      {obligations.length === 0 ? (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center">
          <Calendar className="mx-auto h-8 w-8 text-[var(--color-text-secondary)]" aria-hidden="true" />
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
            Nenhuma obrigação agendada neste filtro.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] divide-y divide-[var(--color-border)]">
          {obligations.map((ob) => {
            const open = computeObligationOpenCents(ob, workspace.settlements);
            const status = deriveObligationStatus(ob, workspace.settlements, todayDate);
            const statusLabel =
              status === 'settled'
                ? 'Liquidada'
                : status === 'partially_settled'
                  ? 'Parcial'
                  : status === 'overdue'
                    ? 'Vencida'
                    : status === 'canceled'
                      ? 'Cancelada'
                      : 'Prevista';
            const statusTone =
              status === 'settled'
                ? 'income'
                : status === 'overdue'
                  ? 'expense'
                  : status === 'partially_settled'
                    ? 'warning'
                    : 'neutral';

            return (
              <div key={ob.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-sm text-[var(--color-text)]">{ob.description}</span>
                    <StatusTag label={statusLabel} tone={statusTone} />
                  </div>
                  <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                    Vencimento: {formatCivilDateBR(ob.dueDate)} ·{' '}
                    {ob.direction === 'receivable' ? 'A receber' : 'A pagar'} · Original:{' '}
                    <FinancialValue cents={ob.originalCents} privacyMode={privacy} />
                  </p>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <span className="block text-[11px] text-[var(--color-text-secondary)]">Em aberto</span>
                    <span
                      className={`text-sm font-bold ${
                        ob.direction === 'receivable' ? 'text-[var(--color-income)]' : 'text-[var(--color-text)]'
                      }`}
                    >
                      <FinancialValue cents={open} privacyMode={privacy} />
                    </span>
                  </div>
                  {open > 0 && status !== 'canceled' && (
                    <Button variant="secondary" onClick={() => openSettle(ob)} className="text-xs">
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      Liquidar
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Agendar Conta ou Recorrência */}
      {(showNewOb || showNewRec) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
              <h3 className="text-base font-semibold text-[var(--color-text)]">
                {showNewRec ? 'Nova série recorrente' : 'Agendar conta a pagar/receber'}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setShowNewOb(false);
                  setShowNewRec(false);
                }}
                aria-label="Fechar"
                className="focus-ring flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-text-secondary)] cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={showNewRec ? handleCreateRecurrence : handleCreateObligation} className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-2 rounded-lg bg-[var(--color-surface-muted)] p-1">
                <button
                  type="button"
                  onClick={() => setDirection('payable')}
                  className={`min-h-[38px] rounded-md text-xs font-medium cursor-pointer ${
                    direction === 'payable' ? 'bg-[var(--color-surface)] shadow-sm' : 'text-[var(--color-text-secondary)]'
                  }`}
                >
                  A pagar
                </button>
                <button
                  type="button"
                  onClick={() => setDirection('receivable')}
                  className={`min-h-[38px] rounded-md text-xs font-medium cursor-pointer ${
                    direction === 'receivable' ? 'bg-[var(--color-surface)] shadow-sm' : 'text-[var(--color-text-secondary)]'
                  }`}
                >
                  A receber
                </button>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Descrição</label>
                <input
                  type="text"
                  required
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Valor (R$)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    required
                    value={amountStr}
                    onChange={(e) => setAmountStr(e.target.value)}
                    className="focus-ring financial-value w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                    {showNewRec ? 'Início' : 'Vencimento'}
                  </label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm"
                  />
                </div>
              </div>
              {showNewRec && (
                <div>
                  <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Frequência</label>
                  <select
                    value={frequency}
                    onChange={(e) => setFrequency(e.target.value as 'monthly' | 'weekly' | 'yearly')}
                    className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm"
                  >
                    <option value="monthly">Mensal (ajusta dia 31 ao último dia)</option>
                    <option value="weekly">Semanal</option>
                    <option value="yearly">Anual</option>
                  </select>
                </div>
              )}
              {errorMsg && <p className="text-xs text-[var(--color-expense)]">{errorMsg}</p>}
              <div className="flex justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setShowNewOb(false);
                    setShowNewRec(false);
                  }}
                >
                  Cancelar
                </Button>
                <Button type="submit" variant="primary" loading={saving}>
                  Salvar
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Liquidação Parcial ou Total */}
      {settleTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
              <h3 className="text-base font-semibold text-[var(--color-text)]">Registrar liquidação</h3>
              <button
                type="button"
                onClick={() => setSettleTarget(null)}
                aria-label="Fechar"
                className="focus-ring flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-text-secondary)] cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSettle} className="mt-4 space-y-4">
              <p className="text-xs text-[var(--color-text-secondary)]">
                Obrigação: <strong className="text-[var(--color-text)]">{settleTarget.description}</strong>
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                    Valor liquidado (R$)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    required
                    value={settleAmountStr}
                    onChange={(e) => setSettleAmountStr(e.target.value)}
                    className="focus-ring financial-value w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Data</label>
                  <input
                    type="date"
                    value={settleDate}
                    onChange={(e) => setSettleDate(e.target.value)}
                    className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Conta</label>
                <select
                  value={settleAccId}
                  onChange={(e) => setSettleAccId(e.target.value)}
                  className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm"
                >
                  {liquidityAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              {errorMsg && <p className="text-xs text-[var(--color-expense)]">{errorMsg}</p>}
              <div className="flex justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
                <Button variant="ghost" onClick={() => setSettleTarget(null)}>
                  Cancelar
                </Button>
                <Button type="submit" variant="primary" loading={saving}>
                  Confirmar liquidação
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
