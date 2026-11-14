import React, { useState } from 'react';
import { Account, TransferNature } from '../../lib/domain/types';
import { parseMoneyToCents, todayCivilSaoPaulo } from '../../lib/domain/money';
import { apiRequest, createOperationKey } from '../../lib/api/client';
import { Button } from '../ui/Primitives';
import { X } from 'lucide-react';

interface Props {
  isOpen: boolean;
  accounts: Account[];
  defaultToAccountId?: string;
  defaultNature?: TransferNature;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

export const TransferModal: React.FC<Props> = ({
  isOpen,
  accounts,
  defaultToAccountId,
  defaultNature = 'internal_transfer',
  onClose,
  onSaved,
}) => {
  const activeAccounts = accounts.filter((a) => !a.isArchived);
  const [fromAccountId, setFromAccountId] = useState(activeAccounts[0]?.id || '');
  const [toAccountId, setToAccountId] = useState(defaultToAccountId || activeAccounts[1]?.id || '');
  const [nature, setNature] = useState<TransferNature>(defaultNature);
  const [amountStr, setAmountStr] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(todayCivilSaoPaulo());
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [opKey] = useState(createOperationKey());

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const cents = parseMoneyToCents(amountStr, ',');
    if (!cents || cents <= 0) {
      setErrorMsg('Informe um valor positivo válido em reais.');
      return;
    }
    if (!fromAccountId || !toAccountId || fromAccountId === toAccountId) {
      setErrorMsg('Selecione contas de origem e destino diferentes.');
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest('/api/transfers', {
        method: 'POST',
        idempotencyKey: opKey,
        body: {
          fromAccountId,
          toAccountId,
          amountCents: Math.abs(cents),
          effectiveDate,
          nature,
          description: description.trim() || undefined,
        },
      });
      await onSaved();
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Não foi possível registrar a transferência.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 p-0 md:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="transfer-modal-title"
    >
      <div className="w-full max-w-md rounded-t-[20px] md:rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 md:p-6 shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
          <h2 id="transfer-modal-title" className="text-lg font-semibold text-[var(--color-text)]">
            Transferência ou pagamento de fatura
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar janela"
            className="focus-ring flex h-10 w-10 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)] cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label htmlFor="tr-nature" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
              Natureza da operação
            </label>
            <select
              id="tr-nature"
              value={nature}
              onChange={(e) => setNature(e.target.value as TransferNature)}
              className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
            >
              <option value="internal_transfer">Transferência entre contas próprias</option>
              <option value="card_payment">Registrar pagamento de fatura de cartão</option>
              <option value="investment_aport">Aporte para investimento</option>
              <option value="investment_redemption">Resgate de principal de investimento</option>
            </select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label htmlFor="tr-from" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                Conta de origem
              </label>
              <select
                id="tr-from"
                value={fromAccountId}
                onChange={(e) => setFromAccountId(e.target.value)}
                className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
              >
                {activeAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="tr-to" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                Conta de destino
              </label>
              <select
                id="tr-to"
                value={toAccountId}
                onChange={(e) => setToAccountId(e.target.value)}
                className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
              >
                {activeAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label htmlFor="tr-amount" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                Valor (R$)
              </label>
              <input
                id="tr-amount"
                type="text"
                inputMode="decimal"
                placeholder="0,00"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                className="focus-ring financial-value w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm font-semibold text-[var(--color-text)]"
              />
            </div>
            <div>
              <label htmlFor="tr-date" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                Data
              </label>
              <input
                id="tr-date"
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
              />
            </div>
          </div>

          <div>
            <label htmlFor="tr-desc" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
              Descrição (opcional)
            </label>
            <input
              id="tr-desc"
              type="text"
              placeholder="Ex.: Transferência mensal para reserva"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
            />
          </div>

          <p className="text-xs text-[var(--color-text-secondary)]">
            Transferências internas criam duas pernas vinculadas e não alteram receitas ou despesas consolidadas.
          </p>

          {errorMsg && (
            <div role="alert" className="rounded-lg bg-[var(--color-expense-soft)] px-3 py-2 text-xs text-[var(--color-expense)]">
              {errorMsg}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" loading={submitting}>
              Confirmar transferência
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
