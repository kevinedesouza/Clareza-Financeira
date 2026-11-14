import React, { useState } from 'react';
import { AccountType, WorkspaceData } from '../../lib/domain/types';
import { computeAccountBalance } from '../../lib/domain/ledger';
import { formatBRL, formatCivilDateBR, parseMoneyToCents, todayCivilSaoPaulo } from '../../lib/domain/money';
import { apiRequest, createOperationKey } from '../../lib/api/client';
import { Button, FinancialValue, StatusTag } from '../ui/Primitives';
import { PaginationBar, usePagination } from '../ui/Pagination';
import { ArrowLeftRight, CheckCircle2, Pencil, Plus, Scale, X } from 'lucide-react';

interface Props {
  workspace: WorkspaceData;
  onRefresh: () => Promise<void>;
  onOpenTransfer: () => void;
}

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  checking: 'Conta corrente',
  savings: 'Poupança',
  cash: 'Dinheiro',
  digital_wallet: 'Carteira digital',
  investment_manual: 'Investimento (saldo manual)',
  credit_card: 'Cartão de crédito',
};

export const AccountsView: React.FC<Props> = ({ workspace, onRefresh, onOpenTransfer }) => {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [institution, setInstitution] = useState('');
  const [type, setType] = useState<AccountType>('checking');
  const [maskedIdentifier, setMaskedIdentifier] = useState('');
  const [openingStr, setOpeningStr] = useState('0,00');
  const [openingDate, setOpeningDate] = useState(todayCivilSaoPaulo());
  const [openingKnown, setOpeningKnown] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Conciliação
  const [recAccountId, setRecAccountId] = useState<string | null>(null);

  // Edição de conta
  const [editAccId, setEditAccId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editInstitution, setEditInstitution] = useState('');
  const [editMasked, setEditMasked] = useState('');
  const [editIncludeLiq, setEditIncludeLiq] = useState(true);
  const [editOpeningKnown, setEditOpeningKnown] = useState(true);
  const [editOpeningStr, setEditOpeningStr] = useState('0,00');
  const [editOpeningDate, setEditOpeningDate] = useState(todayCivilSaoPaulo());
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [recCutoff, setRecCutoff] = useState(todayCivilSaoPaulo());
  const [recBalanceStr, setRecBalanceStr] = useState('');
  const [recSaving, setRecSaving] = useState(false);
  const [recMsg, setRecMsg] = useState<string | null>(null);

  const privacy = workspace.profile.privacyMode;
  const accounts = workspace.accounts.filter((a) => !a.isArchived && a.type !== 'credit_card');

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const cents = openingKnown ? parseMoneyToCents(openingStr, ',') : 0;
    if (openingKnown && cents === null) {
      setErrorMsg('Informe um saldo inicial válido (ex: 1.000,00).');
      return;
    }
    setSaving(true);
    try {
      await apiRequest('/api/accounts', {
        method: 'POST',
        idempotencyKey: createOperationKey(),
        body: {
          name,
          institution,
          type,
          maskedIdentifier,
          openingBalanceCents: cents ?? 0,
          openingDate,
          openingBalanceKnown: openingKnown,
        },
      });
      await onRefresh();
      setShowCreate(false);
      setName('');
      setInstitution('');
      setMaskedIdentifier('');
      setOpeningStr('0,00');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao criar conta.');
    } finally {
      setSaving(false);
    }
  };

  const openEditAccount = (acc: (typeof accounts)[number]) => {
    setEditAccId(acc.id);
    setEditName(acc.name);
    setEditInstitution(acc.institution || '');
    setEditMasked(acc.maskedIdentifier || '');
    setEditIncludeLiq(acc.includeInLiquidity);
    setEditOpeningKnown(acc.openingBalanceKnown);
    setEditOpeningStr((acc.openingBalanceCents / 100).toFixed(2).replace('.', ','));
    setEditOpeningDate(acc.openingDate);
    setEditError(null);
  };

  const handleEditAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editAccId) return;
    setEditError(null);
    const cents = editOpeningKnown ? parseMoneyToCents(editOpeningStr, ',') : 0;
    if (editOpeningKnown && cents === null) {
      setEditError('Informe um saldo inicial válido (ex: 1.000,00).');
      return;
    }
    setEditSaving(true);
    try {
      await apiRequest(`/api/accounts/${editAccId}`, {
        method: 'PATCH',
        body: {
          name: editName,
          institution: editInstitution,
          maskedIdentifier: editMasked,
          includeInLiquidity: editIncludeLiq,
          openingBalanceKnown: editOpeningKnown,
          openingBalanceCents: cents ?? 0,
          openingDate: editOpeningDate,
        },
      });
      setEditAccId(null);
      await onRefresh();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Não foi possível salvar a conta.');
    } finally {
      setEditSaving(false);
    }
  };

  const handleReconcile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recAccountId) return;
    setRecMsg(null);
    const cents = parseMoneyToCents(recBalanceStr, ',');
    if (cents === null) {
      setRecMsg('Informe o saldo final do extrato (ex: 3.000,00).');
      return;
    }
    setRecSaving(true);
    try {
      const res = await apiRequest<{
        reconciliation: { status: string; differenceCents: number };
      }>('/api/reconciliations', {
        method: 'POST',
        body: {
          accountId: recAccountId,
          cutoffDate: recCutoff,
          reportedBalanceCents: cents,
        },
      });
      await onRefresh();
      if (res.reconciliation.status === 'matched') {
        setRecAccountId(null);
      } else {
        setRecMsg(
          `Divergência detectada de ${formatBRL(res.reconciliation.differenceCents)} frente ao saldo calculado.`
        );
      }
    } catch (err) {
      setRecMsg(err instanceof Error ? err.message : 'Falha ao conciliar conta.');
    } finally {
      setRecSaving(false);
    }
  };

  const accPg = usePagination(accounts, undefined, 'contas');
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-text)]">Contas e conciliação</h2>
          <p className="text-xs text-[var(--color-text-secondary)]">
            Abertura representa a posição imediatamente anterior aos movimentos da data inicial.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={onOpenTransfer} disabled={workspace.accounts.length < 2}>
            <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
            Transferir
          </Button>
          <Button variant="primary" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Nova conta
          </Button>
        </div>
      </div>

      {accounts.length === 0 ? (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center">
          <p className="text-sm text-[var(--color-text-secondary)]">
            Nenhuma conta cadastrada ainda. Cadastre sua conta corrente, poupança ou carteira para acompanhar saldos.
          </p>
        </div>
      ) : (
        <>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {accounts.map((acc) => {
            const summary = computeAccountBalance(acc, workspace.movements, workspace.reconciliations);
            return (
              <div
                key={acc.id}
                className="flex flex-col justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-base font-semibold text-[var(--color-text)]">{acc.name}</h3>
                      <p className="text-xs text-[var(--color-text-secondary)]">
                        {ACCOUNT_TYPE_LABELS[acc.type]}
                        {acc.institution ? ` · ${acc.institution}` : ''}
                        {acc.maskedIdentifier ? ` · ${acc.maskedIdentifier}` : ''}
                      </p>
                    </div>
                    {summary.hasDivergence ? (
                      <StatusTag label="Divergência" tone="warning" />
                    ) : summary.reconciledUntil ? (
                      <StatusTag label="Conciliada" tone="income" />
                    ) : null}
                  </div>

                  <div className="mt-4">
                    <span className="text-xs text-[var(--color-text-secondary)]">Saldo calculado</span>
                    <div className="mt-1 text-2xl font-bold text-[var(--color-text)]">
                      <FinancialValue cents={summary.balanceCents} privacyMode={privacy} />
                    </div>
                  </div>
                </div>

                <div className="mt-5 flex items-center justify-between border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-text-secondary)]">
                  <span>
                    {summary.reconciledUntil
                      ? `Conciliada até ${formatCivilDateBR(summary.reconciledUntil)}`
                      : summary.lastMovementDate
                        ? `Último mov.: ${formatCivilDateBR(summary.lastMovementDate)}`
                        : `Abertura em ${formatCivilDateBR(acc.openingDate)}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => openEditAccount(acc)}
                    className="focus-ring inline-flex items-center gap-1 font-medium text-[var(--color-primary)] hover:underline cursor-pointer"
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRecAccountId(acc.id);
                      setRecMsg(null);
                      setRecBalanceStr('');
                    }}
                    className="focus-ring inline-flex items-center gap-1 font-medium text-[var(--color-primary)] hover:underline cursor-pointer"
                  >
                    <Scale className="h-3.5 w-3.5" aria-hidden="true" />
                    Conciliar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <PaginationBar page={accPg.page} totalPages={accPg.totalPages} totalItems={accPg.totalItems} pageSize={accPg.pageSize} setPage={accPg.setPage} label="contas" />
        </>
      )}

      {/* Modal Nova Conta */}
      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-acc-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
              <h3 id="new-acc-title" className="text-base font-semibold text-[var(--color-text)]">
                Cadastrar conta
              </h3>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                aria-label="Fechar"
                className="focus-ring flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-text-secondary)] cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateAccount} className="mt-4 space-y-4">
              <div>
                <label htmlFor="acc-name" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                  Nome da conta
                </label>
                <input
                  id="acc-name"
                  type="text"
                  required
                  placeholder="Ex.: Conta Corrente Itaú"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="acc-type" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                    Tipo
                  </label>
                  <select
                    id="acc-type"
                    value={type}
                    onChange={(e) => setType(e.target.value as AccountType)}
                    className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
                  >
                    <option value="checking">Corrente</option>
                    <option value="savings">Poupança</option>
                    <option value="digital_wallet">Carteira digital</option>
                    <option value="cash">Dinheiro</option>
                    <option value="investment_manual">Investimento manual</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="acc-inst" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                    Instituição (opcional)
                  </label>
                  <input
                    id="acc-inst"
                    type="text"
                    placeholder="Ex.: Banco Alfa"
                    value={institution}
                    onChange={(e) => setInstitution(e.target.value)}
                    className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="acc-mask" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                  Identificação mascarada (opcional, nunca senha)
                </label>
                <input
                  id="acc-mask"
                  type="text"
                  placeholder="Ex.: •••• 1234"
                  value={maskedIdentifier}
                  onChange={(e) => setMaskedIdentifier(e.target.value)}
                  className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-[var(--color-text)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={openingKnown}
                  onChange={(e) => setOpeningKnown(e.target.checked)}
                />
                Conheço o saldo inicial na data de abertura
              </label>

              {openingKnown && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="acc-open-bal" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                      Saldo inicial (R$)
                    </label>
                    <input
                      id="acc-open-bal"
                      type="text"
                      inputMode="decimal"
                      value={openingStr}
                      onChange={(e) => setOpeningStr(e.target.value)}
                      className="focus-ring financial-value w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm font-semibold text-[var(--color-text)]"
                    />
                  </div>
                  <div>
                    <label htmlFor="acc-open-date" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                      Data de referência
                    </label>
                    <input
                      id="acc-open-date"
                      type="date"
                      value={openingDate}
                      onChange={(e) => setOpeningDate(e.target.value)}
                      className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
                    />
                  </div>
                </div>
              )}

              {errorMsg && (
                <p role="alert" className="text-xs text-[var(--color-expense)]">
                  {errorMsg}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
                <Button variant="ghost" onClick={() => setShowCreate(false)}>
                  Cancelar
                </Button>
                <Button type="submit" variant="primary" loading={saving}>
                  Criar conta
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Conciliação */}
      {editAccId && (
        <div
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 p-0 md:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-account-title"
        >
          <div className="w-full max-w-md rounded-t-[20px] md:rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 md:p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
              <h2 id="edit-account-title" className="text-lg font-semibold text-[var(--color-text)]">
                Editar conta
              </h2>
              <button
                type="button"
                onClick={() => setEditAccId(null)}
                aria-label="Fechar janela"
                className="focus-ring flex h-10 w-10 items-center justify-center rounded-lg text-[var(--color-text-secondary)] cursor-pointer"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <form onSubmit={handleEditAccount} className="mt-4 space-y-4">
              <div>
                <label htmlFor="edit-acc-name" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                  Nome da conta
                </label>
                <input
                  id="edit-acc-name"
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="edit-acc-inst" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                    Instituição
                  </label>
                  <input
                    id="edit-acc-inst"
                    type="text"
                    value={editInstitution}
                    onChange={(e) => setEditInstitution(e.target.value)}
                    className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="edit-acc-masked" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                    Identificação
                  </label>
                  <input
                    id="edit-acc-masked"
                    type="text"
                    value={editMasked}
                    onChange={(e) => setEditMasked(e.target.value)}
                    className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="edit-acc-open" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                    Saldo de abertura (R$)
                  </label>
                  <input
                    id="edit-acc-open"
                    type="text"
                    inputMode="decimal"
                    disabled={!editOpeningKnown}
                    value={editOpeningStr}
                    onChange={(e) => setEditOpeningStr(e.target.value)}
                    className="focus-ring financial-value w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm disabled:opacity-50"
                  />
                </div>
                <div>
                  <label htmlFor="edit-acc-date" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                    Data de abertura
                  </label>
                  <input
                    id="edit-acc-date"
                    type="date"
                    value={editOpeningDate}
                    onChange={(e) => setEditOpeningDate(e.target.value)}
                    className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-[var(--color-text)] cursor-pointer">
                <input type="checkbox" checked={editOpeningKnown} onChange={(e) => setEditOpeningKnown(e.target.checked)} className="h-4 w-4" />
                Saldo de abertura conhecido
              </label>
              <label className="flex items-center gap-2 text-sm text-[var(--color-text)] cursor-pointer">
                <input type="checkbox" checked={editIncludeLiq} onChange={(e) => setEditIncludeLiq(e.target.checked)} className="h-4 w-4" />
                Incluir no saldo em contas
              </label>
              {editError && (
                <div role="alert" className="rounded-lg bg-[var(--color-expense-soft)] px-3 py-2 text-xs text-[var(--color-expense)]">
                  {editError}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
                <Button variant="ghost" onClick={() => setEditAccId(null)}>
                  Cancelar
                </Button>
                <Button type="submit" variant="primary" loading={editSaving}>
                  Salvar alterações
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {recAccountId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rec-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
              <h3 id="rec-title" className="text-base font-semibold text-[var(--color-text)]">
                Conciliar saldo com extrato
              </h3>
              <button
                type="button"
                onClick={() => setRecAccountId(null)}
                aria-label="Fechar"
                className="focus-ring flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-text-secondary)] cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleReconcile} className="mt-4 space-y-4">
              <div>
                <label htmlFor="rec-cutoff" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                  Data de corte do extrato
                </label>
                <input
                  id="rec-cutoff"
                  type="date"
                  value={recCutoff}
                  onChange={(e) => setRecCutoff(e.target.value)}
                  className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm"
                />
              </div>
              <div>
                <label htmlFor="rec-bal" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                  Saldo informado no extrato (R$)
                </label>
                <input
                  id="rec-bal"
                  type="text"
                  inputMode="decimal"
                  required
                  placeholder="0,00"
                  value={recBalanceStr}
                  onChange={(e) => setRecBalanceStr(e.target.value)}
                  className="focus-ring financial-value w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm font-semibold"
                />
              </div>

              {recMsg && (
                <div role="alert" className="rounded-lg bg-[var(--color-warning-soft)] p-3 text-xs text-[var(--color-warning)]">
                  {recMsg}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
                <Button variant="ghost" onClick={() => setRecAccountId(null)}>
                  Cancelar
                </Button>
                <Button type="submit" variant="primary" loading={recSaving}>
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  Conferir saldo
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
