import React, { useState } from 'react';
import { Account, Category, Project } from '../../lib/domain/types';
import { parseMoneyToCents, todayCivilSaoPaulo } from '../../lib/domain/money';
import { apiRequest, createOperationKey } from '../../lib/api/client';
import { Button } from '../ui/Primitives';
import { ChevronDown, ChevronUp, FileText, Sparkles, X } from 'lucide-react';

const RECEIPT_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';
const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;

interface ReceiptAnalysisResponse {
  analysis: {
    amountCents: number | null;
    date: string | null;
    description: string | null;
    categoryId: string | null;
    confidence: number;
    warnings: string[];
  };
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}

interface Props {
  isOpen: boolean;
  initialNature?: 'expense' | 'income' | 'refund';
  accounts: Account[];
  categories: Category[];
  projects: Project[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}

export const QuickTransactionModal: React.FC<Props> = ({
  isOpen,
  initialNature = 'expense',
  accounts,
  categories,
  projects,
  onClose,
  onSaved,
}) => {
  const activeAccounts = accounts.filter((a) => !a.isArchived);
  const [nature, setNature] = useState<'expense' | 'income' | 'refund'>(initialNature);
  const [amountStr, setAmountStr] = useState('');
  const [description, setDescription] = useState('');
  const [accountId, setAccountId] = useState(activeAccounts[0]?.id || '');
  const [effectiveDate, setEffectiveDate] = useState(todayCivilSaoPaulo());
  const [categoryId, setCategoryId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [competenceDate, setCompetenceDate] = useState('');
  const [notes, setNotes] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ amount?: string; description?: string; account?: string }>({});
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [opKey, setOpKey] = useState(createOperationKey());

  const [receiptName, setReceiptName] = useState<string | null>(null);
  const [receiptAnalyzing, setReceiptAnalyzing] = useState(false);
  const [receiptWarnings, setReceiptWarnings] = useState<string[]>([]);
  const [receiptError, setReceiptError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleReceiptFile = async (file: File | undefined) => {
    if (!file) return;
    setReceiptError(null);
    setReceiptWarnings([]);
    if (file.size > RECEIPT_MAX_BYTES) {
      setReceiptError('A nota deve ter até 5 MB.');
      return;
    }
    if (!RECEIPT_ACCEPT.split(',').includes(file.type)) {
      setReceiptError('Formato não suportado. Envie JPG, PNG, WEBP ou PDF.');
      return;
    }
    setReceiptName(file.name);
    setReceiptAnalyzing(true);
    try {
      const contentBase64 = await readFileAsBase64(file);
      const res = await apiRequest<ReceiptAnalysisResponse>('/api/receipts/analyze', {
        method: 'POST',
        body: { contentBase64, mimeType: file.type, fileName: file.name },
      });
      const a = res.analysis;
      if (a.amountCents !== null) setAmountStr((a.amountCents / 100).toFixed(2).replace('.', ','));
      if (a.date) setEffectiveDate(a.date);
      if (a.description) setDescription(a.description);
      if (a.categoryId) setCategoryId(a.categoryId);
      setNature('expense');
      setReceiptWarnings(a.warnings);
    } catch (err) {
      setReceiptError(err instanceof Error ? err.message : 'Não foi possível analisar a nota.');
    } finally {
      setReceiptAnalyzing(false);
    }
  };

  const filteredCategories = categories.filter(
    (c) => !c.isArchived && (nature === 'income' ? c.kind === 'income' : c.kind === 'expense')
  );

  const handleSubmit = async (keepOpen: boolean) => {
    setErrorMsg(null);
    setSuccessMsg(null);

    const cents = parseMoneyToCents(amountStr, ',');
    const errs: typeof fieldErrors = {};
    if (!cents || cents <= 0) errs.amount = 'Informe um valor positivo em reais (ex: 120,50).';
    if (!description.trim()) errs.description = 'Informe uma descrição clara.';
    const targetAccountId = accountId || activeAccounts[0]?.id;
    if (!targetAccountId) errs.account = 'Cadastre uma conta antes de registrar lançamentos.';

    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});
    setSubmitting(true);

    try {
      await apiRequest('/api/events', {
        method: 'POST',
        idempotencyKey: opKey,
        body: {
          nature,
          description: description.trim(),
          magnitudeCents: Math.abs(cents!),
          accountId: targetAccountId,
          effectiveDate,
          competenceDate: competenceDate || effectiveDate,
          categoryId: categoryId || undefined,
          projectId: projectId || undefined,
          notes: notes.trim() || undefined,
        },
      });

      await onSaved();
      setOpKey(createOperationKey());

      if (keepOpen) {
        setAmountStr('');
        setDescription('');
        setNotes('');
        setSuccessMsg('Lançamento salvo. Pronto para o próximo registro.');
      } else {
        onClose();
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Não foi possível salvar o lançamento.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 p-0 md:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-tx-title"
    >
      <div className="w-full max-w-lg rounded-t-[20px] md:rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 md:p-6 shadow-xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between gap-4 border-b border-[var(--color-border)] pb-3">
          <h2 id="quick-tx-title" className="text-lg font-semibold text-[var(--color-text)]">
            Novo lançamento
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

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit(false);
          }}
          className="mt-4 space-y-4"
        >
          {/* 1. Tipo */}
          <div>
            <span className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5">Tipo</span>
            <div className="grid grid-cols-3 gap-1.5 rounded-lg bg-[var(--color-surface-muted)] p-1">
              {(
                [
                  { id: 'expense', label: 'Despesa' },
                  { id: 'income', label: 'Receita' },
                  { id: 'refund', label: 'Estorno' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    setNature(opt.id);
                    setCategoryId('');
                  }}
                  className={`min-h-[40px] rounded-md text-sm font-medium transition-colors cursor-pointer ${
                    nature === opt.id
                      ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm'
                      : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 1b. Nota fiscal (opcional): a IA lê e preenche os campos abaixo */}
          <div className="rounded-lg border border-dashed border-[var(--color-control-border)] bg-[var(--color-surface-muted)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-[var(--color-text)]">Nota fiscal (opcional)</p>
                <p className="text-xs text-[var(--color-text-secondary)]">
                  Envie uma foto ou PDF e a IA preenche valor, data, descrição e categoria. Revise antes de salvar.
                </p>
              </div>
              <label
                className={`focus-ring inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm font-medium text-[var(--color-text)] ${
                  receiptAnalyzing ? 'opacity-60 pointer-events-none' : ''
                }`}
              >
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                {receiptAnalyzing ? 'Analisando…' : 'Enviar nota'}
                <input
                  type="file"
                  accept={RECEIPT_ACCEPT}
                  className="sr-only"
                  disabled={receiptAnalyzing}
                  onChange={(e) => {
                    handleReceiptFile(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
            {receiptName && !receiptAnalyzing && (
              <p className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--color-text-secondary)]">
                <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                {receiptName}
              </p>
            )}
            {receiptError && (
              <p role="alert" className="mt-2 text-xs text-[var(--color-expense)]">
                {receiptError}
              </p>
            )}
            {receiptWarnings.length > 0 && (
              <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-[var(--color-text-secondary)]">
                {receiptWarnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </div>

          {/* 2. Valor */}
          <div>
            <label htmlFor="tx-amount" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
              Valor (R$)
            </label>
            <input
              id="tx-amount"
              type="text"
              inputMode="decimal"
              placeholder="0,00"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              className="focus-ring financial-value w-full min-h-[48px] md:min-h-[42px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-lg font-semibold text-[var(--color-text)]"
            />
            {fieldErrors.amount && <p className="mt-1 text-xs text-[var(--color-expense)]">{fieldErrors.amount}</p>}
          </div>

          {/* 3. Descrição */}
          <div>
            <label htmlFor="tx-desc" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
              Descrição
            </label>
            <input
              id="tx-desc"
              type="text"
              placeholder="Ex.: Mercado Central, Salário, Farmácia"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="focus-ring w-full min-h-[44px] md:min-h-[40px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
            />
            {fieldErrors.description && (
              <p className="mt-1 text-xs text-[var(--color-expense)]">{fieldErrors.description}</p>
            )}
          </div>

          {/* 4. Conta e 5. Data */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label htmlFor="tx-acc" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                Conta ou cartão
              </label>
              <select
                id="tx-acc"
                value={accountId || activeAccounts[0]?.id || ''}
                onChange={(e) => setAccountId(e.target.value)}
                className="focus-ring w-full min-h-[44px] md:min-h-[40px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
              >
                {activeAccounts.length === 0 ? (
                  <option value="">Nenhuma conta cadastrada</option>
                ) : (
                  activeAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name}
                    </option>
                  ))
                )}
              </select>
              {fieldErrors.account && <p className="mt-1 text-xs text-[var(--color-expense)]">{fieldErrors.account}</p>}
            </div>

            <div>
              <label htmlFor="tx-date" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                Data efetiva
              </label>
              <input
                id="tx-date"
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                className="focus-ring w-full min-h-[44px] md:min-h-[40px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
              />
            </div>
          </div>

          {/* 6. Categoria */}
          <div>
            <label htmlFor="tx-cat" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
              Categoria
            </label>
            <select
              id="tx-cat"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="focus-ring w-full min-h-[44px] md:min-h-[40px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
            >
              <option value="">Selecionar categoria (ou classificar depois)</option>
              {filteredCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* 7. Opções avançadas recolhidas */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              aria-expanded={showAdvanced}
              className="focus-ring inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-primary)] cursor-pointer"
            >
              {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              Mais opções (mês em que o gasto conta, projeto e observações)
            </button>

            {showAdvanced && (
              <div className="mt-3 space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="tx-comp" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                      Mês em que o gasto conta
                    </label>
                    <input
                      id="tx-comp"
                      type="date"
                      value={competenceDate}
                      onChange={(e) => setCompetenceDate(e.target.value)}
                      className="focus-ring w-full min-h-[40px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
                    />
                  </div>
                  <div>
                    <label htmlFor="tx-proj" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                      Projeto (opcional)
                    </label>
                    <select
                      id="tx-proj"
                      value={projectId}
                      onChange={(e) => setProjectId(e.target.value)}
                      className="focus-ring w-full min-h-[40px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
                    >
                      <option value="">Nenhum</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label htmlFor="tx-notes" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                    Observações
                  </label>
                  <textarea
                    id="tx-notes"
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="focus-ring w-full rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] p-2.5 text-sm text-[var(--color-text)]"
                  />
                </div>
              </div>
            )}
          </div>

          {errorMsg && (
            <div role="alert" className="rounded-lg bg-[var(--color-expense-soft)] px-3 py-2 text-xs text-[var(--color-expense)]">
              {errorMsg}
            </div>
          )}
          {successMsg && (
            <div role="status" className="rounded-lg bg-[var(--color-income-soft)] px-3 py-2 text-xs text-[var(--color-income)]">
              {successMsg}
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
            <Button variant="secondary" onClick={() => handleSubmit(true)} loading={submitting} disabled={submitting}>
              Salvar e adicionar outro
            </Button>
            <Button type="submit" variant="primary" loading={submitting} disabled={submitting}>
              {submitting ? 'Salvando…' : 'Salvar lançamento'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
