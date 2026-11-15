import React, { useState } from 'react';
import { AccountMovement, WorkspaceData } from '../../lib/domain/types';
import { computeCardCycle, computeCardDebtSummary } from '../../lib/domain/ledger';
import { formatCivilDateBR, parseMoneyToCents, splitInstallments, todayCivilSaoPaulo } from '../../lib/domain/money';
import { apiRequest, createOperationKey } from '../../lib/api/client';
import { Button, FinancialValue, StatusTag } from '../ui/Primitives';
import { PaginationBar, usePagination } from '../ui/Pagination';
import { Archive, ArchiveRestore, CreditCard, Pencil, Plus, Receipt, X } from 'lucide-react';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useToast } from '../ui/Toast';

interface Props {
  workspace: WorkspaceData;
  onRefresh: () => Promise<void>;
  onPayBill: (cardAccountId: string) => void;
}

/** Lançamentos vinculados a um cartão, com status de conciliação e paginação própria. */
const CardLedger: React.FC<{ cardId: string; movements: AccountMovement[]; privacy: boolean }> = ({
  cardId,
  movements,
  privacy,
}) => {
  const pg = usePagination(movements, 4, `cartao-lanc-${cardId}`);
  const unreconciled = movements.filter((m) => m.reconciliationStatus !== 'reconciled').length;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-medium text-[var(--color-text-secondary)]">Lançamentos vinculados ao cartão</span>
        <span className="text-[var(--color-text-secondary)]">
          {movements.length} lançamento(s) · {unreconciled} não conciliado(s)
        </span>
      </div>
      {movements.length === 0 ? (
        <p className="text-xs text-[var(--color-text-secondary)]">Nenhum lançamento vinculado a este cartão ainda.</p>
      ) : (
        <>
          <ul className="divide-y divide-[var(--color-border)] text-xs">
            {pg.pageItems.map((m) => {
              const label =
                m.reconciliationStatus === 'reconciled'
                  ? 'Conciliado'
                  : m.reconciliationStatus === 'divergent'
                    ? 'Divergência'
                    : 'Não conciliado';
              const tone =
                m.reconciliationStatus === 'reconciled' ? 'income' : m.reconciliationStatus === 'divergent' ? 'warning' : 'neutral';
              return (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-[var(--color-text)]">{m.description}</p>
                    <p className="text-[var(--color-text-secondary)]">{formatCivilDateBR(m.effectiveDate)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusTag label={label} tone={tone} />
                    <FinancialValue cents={m.signedCents} privacyMode={privacy} showSign className="font-medium" />
                  </div>
                </li>
              );
            })}
          </ul>
          <PaginationBar
            page={pg.page}
            totalPages={pg.totalPages}
            totalItems={pg.totalItems}
            pageSize={pg.pageSize}
            setPage={pg.setPage}
            label="lançamentos"
          />
        </>
      )}
    </div>
  );
};

export const CardsView: React.FC<Props> = ({ workspace, onRefresh, onPayBill }) => {
  const [showCreateCard, setShowCreateCard] = useState(false);
  const [cardName, setCardName] = useState('');
  const [last4, setLast4] = useState('');
  const [limitStr, setLimitStr] = useState('5.000,00');
  const [closingDay, setClosingDay] = useState('10');
  const [dueDay, setDueDay] = useState('18');
  const [saving, setSaving] = useState(false);

  // Edição de cartão (mantém o mesmo cartão: histórico de faturas e parcelas continua vinculado)
  const [editCardId, setEditCardId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editLast4, setEditLast4] = useState('');
  const [editLimitStr, setEditLimitStr] = useState('');
  const [editClosing, setEditClosing] = useState('');
  const [editDue, setEditDue] = useState('');
  const [editPayAccId, setEditPayAccId] = useState('');
  const [editLimitVerified, setEditLimitVerified] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Compra parcelada
  const [instCardId, setInstCardId] = useState<string | null>(null);
  const [instDesc, setInstDesc] = useState('');
  const [instTotalStr, setInstTotalStr] = useState('');
  const [instCount, setInstCount] = useState('3');
  const [instDate, setInstDate] = useState(todayCivilSaoPaulo());
  const [instCatId, setInstCatId] = useState('');
  const [instError, setInstError] = useState<string | null>(null);

  const privacy = workspace.profile.privacyMode;
  const accountMap = new Map(workspace.accounts.map((a) => [a.id, a]));
  const cards = workspace.cards.filter((c) => !c.isArchived);
  const archivedCards = workspace.cards.filter((c) => c.isArchived);
  const toast = useToast();
  const [archiveTarget, setArchiveTarget] = useState<(typeof cards)[number] | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);

  /** Arquiva/reativa o cartão e a conta de fatura ligada a ele. */
  const setCardArchived = async (card: (typeof cards)[number], isArchived: boolean) => {
    setArchiveBusy(true);
    const apply = async (value: boolean) => {
      await apiRequest(`/api/cards/${card.id}`, { method: 'PATCH', body: { isArchived: value } });
      await apiRequest(`/api/accounts/${card.accountId}`, { method: 'PATCH', body: { isArchived: value } });
      await onRefresh();
    };
    try {
      await apply(isArchived);
      setArchiveTarget(null);
      setEditCardId(null);
      toast({
        message: isArchived ? `Cartão "${card.name}" arquivado.` : `Cartão "${card.name}" reativado.`,
        ...(isArchived ? { actionLabel: 'Desfazer', onAction: () => apply(false) } : {}),
      });
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : 'Não foi possível arquivar o cartão.', tone: 'error' });
    } finally {
      setArchiveBusy(false);
    }
  };
  const payableAccounts = workspace.accounts.filter((a) => !a.isArchived && a.type !== 'credit_card');

  const openEditCard = (card: (typeof cards)[number]) => {
    setEditCardId(card.id);
    setEditName(card.name);
    setEditLast4(card.maskedLast4 || '');
    setEditLimitStr((card.creditLimitCents / 100).toFixed(2).replace('.', ','));
    setEditClosing(String(card.closingDay));
    setEditDue(String(card.dueDay));
    setEditPayAccId(card.payingAccountId || '');
    setEditLimitVerified(card.limitVerified);
    setEditError(null);
  };

  const handleEditCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editCardId) return;
    setEditError(null);
    const limitCents = parseMoneyToCents(editLimitStr, ',');
    if (limitCents === null || limitCents < 0) {
      setEditError('Informe um limite válido (ex: 5.000,00).');
      return;
    }
    setEditSaving(true);
    try {
      await apiRequest(`/api/cards/${editCardId}`, {
        method: 'PATCH',
        body: {
          name: editName,
          maskedLast4: editLast4,
          creditLimitCents: limitCents,
          limitVerified: editLimitVerified,
          closingDay: Number(editClosing),
          dueDay: Number(editDue),
          payingAccountId: editPayAccId || null,
        },
      });
      setEditCardId(null);
      await onRefresh();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Não foi possível salvar o cartão.');
    } finally {
      setEditSaving(false);
    }
  };

  const handleCreateCard = async (e: React.FormEvent) => {
    e.preventDefault();
    const limitCents = parseMoneyToCents(limitStr, ',') ?? 0;
    setSaving(true);
    try {
      await apiRequest('/api/cards', {
        method: 'POST',
        body: {
          name: cardName,
          maskedLast4: last4,
          creditLimitCents: limitCents,
          limitVerified: false,
          closingDay: Number(closingDay),
          dueDay: Number(dueDay),
        },
      });
      await onRefresh();
      setShowCreateCard(false);
      setCardName('');
      setLast4('');
    } finally {
      setSaving(false);
    }
  };

  const previewParts = (() => {
    const cents = parseMoneyToCents(instTotalStr, ',');
    const count = Number(instCount);
    if (!cents || cents <= 0 || !Number.isInteger(count) || count < 1 || count > 48) return null;
    return splitInstallments(cents, count);
  })();

  const handleCreateInstallment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!instCardId) return;
    setInstError(null);
    const totalCents = parseMoneyToCents(instTotalStr, ',');
    const count = Number(instCount);
    if (!totalCents || totalCents <= 0 || !Number.isInteger(count) || count < 1) {
      setInstError('Informe um valor total positivo e quantidade de parcelas válida.');
      return;
    }
    setSaving(true);
    try {
      await apiRequest(`/api/cards/${instCardId}/installments`, {
        method: 'POST',
        idempotencyKey: createOperationKey(),
        body: {
          description: instDesc,
          totalCents,
          installmentCount: count,
          purchaseDate: instDate,
          categoryId: instCatId || undefined,
        },
      });
      await onRefresh();
      setInstCardId(null);
      setInstDesc('');
      setInstTotalStr('');
    } catch (err) {
      setInstError(err instanceof Error ? err.message : 'Erro ao registrar compra parcelada.');
    } finally {
      setSaving(false);
    }
  };

  const cardPg = usePagination(cards, undefined, 'cartoes');
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Compras no cartão contam como gasto no mês da compra. Pagar a fatura só tira o dinheiro da conta, sem contar o gasto duas vezes.
          </p>
        </div>
        <Button variant="primary" onClick={() => setShowCreateCard(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Novo cartão
        </Button>
      </div>

      {cards.length === 0 ? (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center">
          <p className="text-sm text-[var(--color-text-secondary)]">
            Nenhum cartão cadastrado. Cadastre seu cartão para acompanhar faturas, limite estimado e compras parceladas.
          </p>
        </div>
      ) : (
        <>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {cardPg.pageItems.map((card) => {
            const acc = accountMap.get(card.accountId);
            if (!acc) return null;
            const summary = computeCardDebtSummary(
              card,
              acc,
              workspace.movements,
              workspace.obligations,
              workspace.settlements
            );
            const cardObs = workspace.obligations.filter(
              (o) => o.cardId === card.id && o.status !== 'canceled' && o.status !== 'settled'
            );

            return (
              <div
                key={card.id}
                className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 md:p-6 space-y-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-brand)] text-white">
                      <CreditCard className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-[var(--color-text)]">{card.name}</h3>
                      <p className="text-xs text-[var(--color-text-secondary)]">
                        {card.maskedLast4 ? `Final ${card.maskedLast4} · ` : ''}
                        Fechamento dia {card.closingDay} · Vencimento dia {card.dueDay}
                      </p>
                    </div>
                  </div>
                  {!card.limitVerified && <StatusTag label="Limite estimado" tone="neutral" />}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 border-y border-[var(--color-border)] py-4">
                  <div>
                    <span className="text-xs text-[var(--color-text-secondary)]">Dívida total em aberto</span>
                    <div className="mt-1 text-lg font-bold text-[var(--color-text)]">
                      <FinancialValue cents={summary.debtCents} privacyMode={privacy} />
                    </div>
                    {(() => {
                      const cyc = computeCardCycle(card, workspace.movements, todayCivilSaoPaulo());
                      return (
                        <p className="mt-1 text-[11px] text-[var(--color-text-secondary)]">
                          Compras no ciclo ({formatCivilDateBR(cyc.cycleStart)} a {formatCivilDateBR(cyc.cycleEnd)}):{' '}
                          <strong className="text-[var(--color-text)]">
                            <FinancialValue cents={cyc.purchasesCents} privacyMode={privacy} />
                          </strong>
                        </p>
                      );
                    })()}
                    {summary.creditInFavorCents > 0 && (
                      <p className="text-[11px] text-[var(--color-income)]">
                        Crédito a favor: <FinancialValue cents={summary.creditInFavorCents} privacyMode={privacy} />
                      </p>
                    )}
                  </div>
                  <div>
                    <span className="text-xs text-[var(--color-text-secondary)]">Disponível (estimativa)</span>
                    <div className="mt-1 text-lg font-semibold text-[var(--color-text)]">
                      <FinancialValue cents={summary.availableEstimatedCents} privacyMode={privacy} />
                    </div>
                  </div>
                  <div>
                    <span className="text-xs text-[var(--color-text-secondary)]">Parcelas futuras</span>
                    <div className="mt-1 text-lg font-semibold text-[var(--color-text-secondary)]">
                      <FinancialValue cents={summary.futureInstallmentsCents} privacyMode={privacy} />
                    </div>
                  </div>
                </div>

                <CardLedger
                  cardId={card.id}
                  privacy={privacy}
                  movements={workspace.movements
                    .filter((m) => m.accountId === card.accountId && !m.isDeleted)
                    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))}
                />

                {cardObs.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-medium text-[var(--color-text-secondary)]">
                      Próximos lançamentos/parcelas no cartão
                    </p>
                    <ul className="space-y-1.5 text-xs">
                      {cardObs.slice(0, 3).map((ob) => (
                        <li key={ob.id} className="flex justify-between text-[var(--color-text)]">
                          <span>
                            {formatCivilDateBR(ob.dueDate)} · {ob.description}
                          </span>
                          <FinancialValue cents={ob.originalCents} privacyMode={privacy} className="font-medium" />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  <Button variant="primary" onClick={() => onPayBill(card.accountId)}>
                    <Receipt className="h-4 w-4" aria-hidden="true" />
                    Registrar pagamento de fatura
                  </Button>
                  <Button variant="secondary" onClick={() => setInstCardId(card.id)}>
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Compra parcelada
                  </Button>
                  <Button variant="ghost" onClick={() => openEditCard(card)}>
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                    Editar cartão
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
        <PaginationBar page={cardPg.page} totalPages={cardPg.totalPages} totalItems={cardPg.totalItems} pageSize={cardPg.pageSize} setPage={cardPg.setPage} label="cartões" />
        </>
      )}
      {archivedCards.length > 0 && (
        <details className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <summary className="cursor-pointer text-sm font-medium text-[var(--color-text)]">
            Cartões arquivados ({archivedCards.length})
          </summary>
          <ul className="mt-3 divide-y divide-[var(--color-border)]">
            {archivedCards.map((card) => (
              <li key={card.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-sm text-[var(--color-text-secondary)]">
                  {card.name}
                  {card.maskedLast4 ? ` · final ${card.maskedLast4}` : ''}
                </span>
                <Button variant="secondary" onClick={() => setCardArchived(card, false)} disabled={archiveBusy} className="text-xs">
                  <ArchiveRestore className="h-4 w-4" aria-hidden="true" />
                  Reativar
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <ConfirmDialog
        open={!!archiveTarget}
        title={`Arquivar o cartão "${archiveTarget?.name ?? ''}"?`}
        message="Use para cartões cancelados. Ele some das listas e dos totais, mas as compras e faturas antigas continuam no histórico. Você pode reativar quando quiser."
        confirmLabel="Arquivar cartão"
        loading={archiveBusy}
        onConfirm={() => archiveTarget && setCardArchived(archiveTarget, true)}
        onCancel={() => setArchiveTarget(null)}
      />

      {/* Modal Novo Cartão */}
      {editCardId && (
        <div
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 p-0 md:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-card-title"
        >
          <div className="w-full max-w-md rounded-t-[20px] md:rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 md:p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
              <h3 id="edit-card-title" className="text-base font-semibold text-[var(--color-text)]">
                Editar cartão
              </h3>
              <button
                type="button"
                onClick={() => setEditCardId(null)}
                aria-label="Fechar"
                className="focus-ring flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-text-secondary)] cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleEditCard} className="mt-4 space-y-4">
              <div>
                <label htmlFor="edit-card-name" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                  Nome do cartão
                </label>
                <input
                  id="edit-card-name"
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="edit-card-last4" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                    4 últimos dígitos
                  </label>
                  <input
                    id="edit-card-last4"
                    type="text"
                    maxLength={4}
                    value={editLast4}
                    onChange={(e) => setEditLast4(e.target.value.replace(/\D/g, ''))}
                    className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="edit-card-limit" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                    Limite (R$)
                  </label>
                  <input
                    id="edit-card-limit"
                    type="text"
                    inputMode="decimal"
                    value={editLimitStr}
                    onChange={(e) => setEditLimitStr(e.target.value)}
                    className="focus-ring financial-value w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="edit-card-close" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                    Dia fechamento
                  </label>
                  <input
                    id="edit-card-close"
                    type="number"
                    min={1}
                    max={31}
                    value={editClosing}
                    onChange={(e) => setEditClosing(e.target.value)}
                    className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="edit-card-due" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                    Dia vencimento
                  </label>
                  <input
                    id="edit-card-due"
                    type="number"
                    min={1}
                    max={31}
                    value={editDue}
                    onChange={(e) => setEditDue(e.target.value)}
                    className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="edit-card-pay" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                  Conta usada para pagar a fatura
                </label>
                <select
                  id="edit-card-pay"
                  value={editPayAccId}
                  onChange={(e) => setEditPayAccId(e.target.value)}
                  className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm"
                >
                  <option value="">Não definida</option>
                  {payableAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-[var(--color-text)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={editLimitVerified}
                  onChange={(e) => setEditLimitVerified(e.target.checked)}
                  className="h-4 w-4"
                />
                Limite confirmado pelo banco
              </label>
              {editError && (
                <div role="alert" className="rounded-lg bg-[var(--color-expense-soft)] px-3 py-2 text-xs text-[var(--color-expense)]">
                  {editError}
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--color-border)]">
                <Button
                  variant="ghost"
                  onClick={() => {
                    const card = cards.find((c) => c.id === editCardId);
                    if (card) setArchiveTarget(card);
                  }}
                  className="text-[var(--color-text-secondary)]"
                >
                  <Archive className="h-4 w-4" aria-hidden="true" />
                  Arquivar cartão
                </Button>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setEditCardId(null)}>
                    Cancelar
                  </Button>
                  <Button type="submit" variant="primary" loading={editSaving}>
                    Salvar alterações
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {showCreateCard && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-card-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
              <h3 id="new-card-title" className="text-base font-semibold text-[var(--color-text)]">
                Cadastrar cartão de crédito
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateCard(false)}
                aria-label="Fechar"
                className="focus-ring flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-text-secondary)] cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreateCard} className="mt-4 space-y-4">
              <div>
                <label htmlFor="card-name" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                  Nome do cartão
                </label>
                <input
                  id="card-name"
                  type="text"
                  required
                  placeholder="Ex.: Cartão Platinum"
                  value={cardName}
                  onChange={(e) => setCardName(e.target.value)}
                  className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="card-last4" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                    4 últimos dígitos
                  </label>
                  <input
                    id="card-last4"
                    type="text"
                    maxLength={4}
                    placeholder="1234"
                    value={last4}
                    onChange={(e) => setLast4(e.target.value.replace(/\D/g, ''))}
                    className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="card-limit" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                    Limite informado (R$)
                  </label>
                  <input
                    id="card-limit"
                    type="text"
                    inputMode="decimal"
                    value={limitStr}
                    onChange={(e) => setLimitStr(e.target.value)}
                    className="focus-ring financial-value w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="card-close" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                    Dia fechamento
                  </label>
                  <input
                    id="card-close"
                    type="number"
                    min={1}
                    max={31}
                    value={closingDay}
                    onChange={(e) => setClosingDay(e.target.value)}
                    className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="card-due" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                    Dia vencimento
                  </label>
                  <input
                    id="card-due"
                    type="number"
                    min={1}
                    max={31}
                    value={dueDay}
                    onChange={(e) => setDueDay(e.target.value)}
                    className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
                <Button variant="ghost" onClick={() => setShowCreateCard(false)}>
                  Cancelar
                </Button>
                <Button type="submit" variant="primary" loading={saving}>
                  Salvar cartão
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Compra Parcelada */}
      {instCardId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="inst-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
              <h3 id="inst-title" className="text-base font-semibold text-[var(--color-text)]">
                Compra parcelada no cartão
              </h3>
              <button
                type="button"
                onClick={() => setInstCardId(null)}
                aria-label="Fechar"
                className="focus-ring flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-text-secondary)] cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreateInstallment} className="mt-4 space-y-4">
              <div>
                <label htmlFor="inst-desc" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                  Descrição da compra
                </label>
                <input
                  id="inst-desc"
                  type="text"
                  required
                  placeholder="Ex.: Notebook, Passagem aérea"
                  value={instDesc}
                  onChange={(e) => setInstDesc(e.target.value)}
                  className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="inst-total" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                    Valor total (R$)
                  </label>
                  <input
                    id="inst-total"
                    type="text"
                    inputMode="decimal"
                    required
                    placeholder="1.000,00"
                    value={instTotalStr}
                    onChange={(e) => setInstTotalStr(e.target.value)}
                    className="focus-ring financial-value w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm font-semibold"
                  />
                </div>
                <div>
                  <label htmlFor="inst-qty" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                    Parcelas
                  </label>
                  <input
                    id="inst-qty"
                    type="number"
                    min={1}
                    max={48}
                    required
                    value={instCount}
                    onChange={(e) => setInstCount(e.target.value)}
                    className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm"
                  />
                </div>
              </div>

              {previewParts && (
                <div className="rounded-lg bg-[var(--color-surface-muted)] p-3 text-xs text-[var(--color-text-secondary)]">
                  Distribuição exata em centavos:{' '}
                  <strong className="text-[var(--color-text)]">
                    {previewParts
                      .slice(0, 4)
                      .map((c) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`)
                      .join(' + ')}
                    {previewParts.length > 4 ? ` (+${previewParts.length - 4})` : ''}
                  </strong>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="inst-date" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                    Data da compra
                  </label>
                  <input
                    id="inst-date"
                    type="date"
                    value={instDate}
                    onChange={(e) => setInstDate(e.target.value)}
                    className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="inst-cat" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                    Categoria
                  </label>
                  <select
                    id="inst-cat"
                    value={instCatId}
                    onChange={(e) => setInstCatId(e.target.value)}
                    className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm"
                  >
                    <option value="">Selecionar</option>
                    {workspace.categories
                      .filter((c) => c.kind === 'expense')
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              {instError && <p className="text-xs text-[var(--color-expense)]">{instError}</p>}

              <div className="flex justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
                <Button variant="ghost" onClick={() => setInstCardId(null)}>
                  Cancelar
                </Button>
                <Button type="submit" variant="primary" loading={saving}>
                  Registrar parcelamento
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
