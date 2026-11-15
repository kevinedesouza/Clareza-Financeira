import React, { useEffect, useRef, useState } from 'react';
import { currentCycleStart } from '../../lib/importers/cardStatement';
import { todayCivilSaoPaulo } from '../../lib/domain/money';
import { ImportBatch, ImportDecision, WorkspaceData } from '../../lib/domain/types';
import { formatCivilDateBR } from '../../lib/domain/money';
import { apiRequest, createOperationKey } from '../../lib/api/client';
import { Button, FinancialValue, StatusTag } from '../ui/Primitives';
import { PaginationBar, usePagination } from '../ui/Pagination';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useToast } from '../ui/Toast';
import { CheckCircle2, FileSpreadsheet, RotateCcw, Trash2, Upload } from 'lucide-react';

interface Props {
  workspace: WorkspaceData;
  onRefresh: () => Promise<void>;
  onNavigateTransactions: () => void;
  onNavigateAccounts: () => void;
}

const STEPS = ['Arquivo', 'Conta e formato', 'Revisão', 'Confirmação', 'Resultado'] as const;

export const ImportsView: React.FC<Props> = ({
  workspace,
  onRefresh,
  onNavigateTransactions,
  onNavigateAccounts,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<number>(0);
  const [accountId, setAccountId] = useState(workspace.accounts[0]?.id || '');
  const [fileName, setFileName] = useState('');
  const [format, setFormat] = useState<'csv' | 'ofx'>('csv');
  const [contentBase64, setContentBase64] = useState('');
  const [fileSize, setFileSize] = useState(0);
  const [delimiter, setDelimiter] = useState<'auto' | ';' | ',' | '\t'>('auto');
  const [dateFormat, setDateFormat] = useState<'DD/MM/YYYY' | 'YYYY-MM-DD' | 'auto'>('DD/MM/YYYY');
  const [positiveIsExpense, setPositiveIsExpense] = useState(false);
  // Início do controle: lançamentos anteriores a esta data não são importados.
  const [importFromDate, setImportFromDate] = useState('');
  const selectedCard = workspace.cards.find((c) => c.accountId === accountId && !c.isArchived);
  useEffect(() => {
    if (selectedCard) {
      setImportFromDate(currentCycleStart(selectedCard.closingDay, todayCivilSaoPaulo()));
      setPositiveIsExpense(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, selectedCard?.id]);

  const [activeBatch, setActiveBatch] = useState<ImportBatch | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [commitResult, setCommitResult] = useState<{ importedCount: number; linkedCount: number; ignoredCount: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const historyPg = usePagination(workspace.importBatches, undefined, 'imp-lotes');
  const [pendingDelete, setPendingDelete] = useState<{ id: string; fileName: string } | null>(null);
  const toast = useToast();
  const [pendingUndo, setPendingUndo] = useState<{ id: string; fileName: string; count: number } | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const rowsPg = usePagination(activeBatch?.rows ?? [], undefined, `imp-linhas-${activeBatch?.id ?? ''}`);

  const privacy = workspace.profile.privacyMode;
  const accountMap = new Map(workspace.accounts.map((a) => [a.id, a]));

  const loadFileBytes = (name: string, bytes: Uint8Array) => {
    setErrorMsg(null);
    if (bytes.byteLength > 20 * 1024 * 1024) {
      setErrorMsg('Arquivo excede o limite máximo de 20 MB.');
      return;
    }
    const lower = name.toLowerCase();
    const detectedFormat: 'csv' | 'ofx' = lower.endsWith('.ofx') || lower.endsWith('.qfx') ? 'ofx' : 'csv';
    let bin = '';
    bytes.forEach((b) => {
      bin += String.fromCharCode(b);
    });
    setFileName(name);
    setFormat(detectedFormat);
    setFileSize(bytes.byteLength);
    setContentBase64(btoa(bin));
    setStep(1);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = new Uint8Array(await file.arrayBuffer());
    loadFileBytes(file.name, buf);
  };

  const handlePrepare = async () => {
    setErrorMsg(null);
    const targetAcc = accountId || workspace.accounts[0]?.id;
    if (!targetAcc) {
      setErrorMsg('Cadastre ao menos uma conta antes de importar um extrato.');
      return;
    }
    setLoading(true);
    try {
      const res = await apiRequest<{
        batch?: ImportBatch;
        existingBatch?: ImportBatch;
        duplicateBatch?: boolean;
        warnings?: string[];
      }>('/api/imports/prepare', {
        method: 'POST',
        body: {
          accountId: targetAcc,
          fileName,
          format,
          contentBase64,
          csvOptions:
            format === 'csv'
              ? { delimiter, dateFormat, positiveIsExpense, importFromDate: importFromDate || undefined }
              : undefined,
        },
      });
      await onRefresh();
      if (res.duplicateBatch && res.existingBatch) {
        setActiveBatch(res.existingBatch);
        setWarnings(res.warnings || ['Este arquivo já foi importado nesta conta.']);
        setCommitResult({
          importedCount: 0,
          linkedCount: 0,
          ignoredCount: res.existingBatch.totalRows,
        });
        setStep(4);
      } else if (res.batch) {
        setActiveBatch(res.batch);
        setWarnings(res.warnings || []);
        setStep(2);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Falha ao processar arquivo.');
    } finally {
      setLoading(false);
    }
  };

  const handleDecisionChange = async (rowId: string, decision: ImportDecision, categoryId?: string) => {
    if (!activeBatch) return;
    const updatedRows = activeBatch.rows.map((r) =>
      r.id === rowId ? { ...r, decision, suggestedCategoryId: categoryId !== undefined ? categoryId : r.suggestedCategoryId } : r
    );
    setActiveBatch({ ...activeBatch, rows: updatedRows });
    await apiRequest(`/api/imports/${activeBatch.id}/decisions`, {
      method: 'POST',
      body: { decisions: [{ rowId, decision, categoryId }] },
    });
  };

  const handleCommit = async () => {
    if (!activeBatch) return;
    setErrorMsg(null);
    setLoading(true);
    try {
      const res = await apiRequest<{
        batch: ImportBatch;
        importedCount: number;
        linkedCount: number;
        ignoredCount: number;
      }>(`/api/imports/${activeBatch.id}/commit`, {
        method: 'POST',
        idempotencyKey: createOperationKey(),
      });
      await onRefresh();
      setActiveBatch(res.batch);
      setCommitResult({
        importedCount: res.importedCount,
        linkedCount: res.linkedCount,
        ignoredCount: res.ignoredCount,
      });
      setStep(4);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Não foi possível confirmar o lote.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteBatch = async (password?: string) => {
    if (!pendingDelete) return;
    const batchId = pendingDelete.id;
    setLoading(true);
    setDialogError(null);
    try {
      await apiRequest(`/api/imports/${batchId}`, { method: 'DELETE', body: { password } });
      if (activeBatch?.id === batchId) setActiveBatch(null);
      setPendingDelete(null);
      await onRefresh();
      toast({ message: 'Lote removido do histórico.' });
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : 'Erro ao excluir lote.');
    } finally {
      setLoading(false);
    }
  };

  const handleUndoBatch = async (password?: string) => {
    if (!pendingUndo) return;
    setLoading(true);
    setDialogError(null);
    try {
      await apiRequest(`/api/imports/${pendingUndo.id}/undo`, { method: 'POST', body: { password } });
      setPendingUndo(null);
      await onRefresh();
      toast({ message: 'Importação desfeita. Os lançamentos do lote foram removidos.' });
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : 'Erro ao desfazer lote.');
    } finally {
      setLoading(false);
    }
  };

  const validToImport = activeBatch
    ? activeBatch.rows.filter((r) => r.decision === 'import_new' || r.decision === 'is_distinct' || r.decision === 'pending')
    : [];
  const linkedRows = activeBatch ? activeBatch.rows.filter((r) => r.decision === 'link_manual') : [];
  const ignoredRows = activeBatch
    ? activeBatch.rows.filter((r) => r.decision === 'already_exists' || r.decision === 'excluded_invalid' || r.decision === 'review_later')
    : [];

  return (
    <div className="space-y-6">
      {/* Stepper visual */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 md:p-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text)]">Importar extrato CSV ou OFX</h2>
            <p className="text-xs text-[var(--color-text-secondary)]">
              Os lançamentos só afetarão seus saldos após a revisão e confirmação explícita.
            </p>
          </div>
          {step > 0 && (
            <Button
              variant="ghost"
              onClick={() => {
                setStep(0);
                setActiveBatch(null);
                setCommitResult(null);
                setErrorMsg(null);
              }}
            >
              Nova importação
            </Button>
          )}
        </div>

        <p className="mb-2 text-xs font-medium text-[var(--color-text-secondary)] sm:hidden" aria-live="polite">
          Passo {step + 1} de {STEPS.length}: <span className="text-[var(--color-text)]">{STEPS[step]}</span>
        </p>
        <ol className="mb-6 grid grid-cols-5 gap-1.5 sm:gap-2 text-center text-xs" aria-label="Etapas da importação">
          {STEPS.map((label, idx) => (
            <li
              key={label}
              aria-current={idx === step ? 'step' : undefined}
              className={`rounded-lg py-2 px-1 font-medium border leading-tight ${
                idx === step
                  ? 'border-[var(--color-primary)] bg-[var(--color-primary-soft)] text-[var(--color-primary)]'
                  : idx < step
                    ? 'border-transparent bg-[var(--color-income-soft)] text-[var(--color-income)]'
                    : 'border-[var(--color-border)] text-[var(--color-text-secondary)]'
              }`}
            >
              <span aria-hidden="true" className="sm:hidden">{idx + 1}</span>
              <span className="sr-only sm:not-sr-only">{idx + 1}. {label}</span>
            </li>
          ))}
        </ol>

        {errorMsg && (
          <div role="alert" className="mb-4 rounded-lg bg-[var(--color-expense-soft)] p-3 text-xs text-[var(--color-expense)]">
            {errorMsg}
          </div>
        )}

        {/* Passo 0: Escolha do arquivo */}
        {step === 0 && (
          <div className="space-y-4">
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={async (e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file) {
                  const buf = new Uint8Array(await file.arrayBuffer());
                  loadFileBytes(file.name, buf);
                }
              }}
              className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-[var(--color-control-border)] bg-[var(--color-surface-muted)]/40 p-8 text-center"
            >
              <Upload className="h-8 w-8 text-[var(--color-primary)]" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium text-[var(--color-text)]">
                Selecione um arquivo CSV ou OFX do seu dispositivo
              </p>
              <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                Limite inicial de 20 MB e 50.000 linhas · UTF-8 ou Windows-1252 · OFX 1.x SGML e 2.x XML
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.ofx,.qfx,.txt,text/csv"
                onChange={handleFileChange}
                className="sr-only"
                aria-label="Escolher arquivo de extrato"
              />
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button variant="primary" onClick={() => fileInputRef.current?.click()}>
                  <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
                  Escolher arquivo
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Passo 1: Conta e formato */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="rounded-lg bg-[var(--color-surface-muted)] p-3 text-xs flex flex-wrap items-center justify-between gap-2">
              <span>
                Arquivo: <strong className="text-[var(--color-text)]">{fileName}</strong> ({(fileSize / 1024).toFixed(1)} KB)
              </span>
              <StatusTag label={format.toUpperCase()} tone="transfer" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label htmlFor="imp-acc" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                  Conta de destino
                </label>
                <select
                  id="imp-acc"
                  value={accountId || workspace.accounts[0]?.id || ''}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm"
                >
                  {workspace.accounts.length === 0 ? (
                    <option value="">Nenhuma conta cadastrada</option>
                  ) : (
                    workspace.accounts.filter((a) => !a.isArchived).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))
                  )}
                </select>
              </div>

              {format === 'csv' && (
                <>
                  <div>
                    <label htmlFor="imp-delim" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                      Separador CSV
                    </label>
                    <select
                      id="imp-delim"
                      value={delimiter}
                      onChange={(e) => setDelimiter(e.target.value as 'auto' | ';' | ',' | '\t')}
                      className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm"
                    >
                      <option value="auto">Detectar automaticamente</option>
                      <option value=";">Ponto e vírgula (;)</option>
                      <option value=",">Vírgula (,)</option>
                      <option value="\t">Tabulação</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="imp-datefmt" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                      Formato de data
                    </label>
                    <select
                      id="imp-datefmt"
                      value={dateFormat}
                      onChange={(e) => setDateFormat(e.target.value as 'DD/MM/YYYY' | 'YYYY-MM-DD' | 'auto')}
                      className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm"
                    >
                      <option value="DD/MM/YYYY">DD/MM/AAAA</option>
                      <option value="YYYY-MM-DD">AAAA-MM-DD</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="imp-from" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                      Importar lançamentos a partir de
                    </label>
                    <input
                      id="imp-from"
                      type="date"
                      value={importFromDate}
                      onChange={(e) => setImportFromDate(e.target.value)}
                      className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm"
                    />
                    <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                      {selectedCard
                        ? `Cartão com fechamento dia ${selectedCard.closingDay}: o padrão é o início da fatura aberta. Linhas anteriores não são importadas.`
                        : 'Deixe em branco para importar tudo. Use para começar o controle a partir de uma data.'}
                    </p>
                  </div>
                  <label className="flex items-start gap-2 text-sm text-[var(--color-text)] sm:col-span-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={positiveIsExpense}
                      onChange={(e) => setPositiveIsExpense(e.target.checked)}
                      className="mt-1 h-4 w-4"
                    />
                    <span>
                      Valores positivos são despesas (fatura de cartão).
                      <span className="block text-xs text-[var(--color-text-secondary)]">
                        Marque se a fatura lista compras como valores positivos. Pagamentos e estornos passam a ser receitas.
                      </span>
                    </span>
                  </label>
                </>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setStep(0)}>
                Voltar
              </Button>
              <Button variant="primary" onClick={handlePrepare} loading={loading}>
                Analisar e gerar preview
              </Button>
            </div>
          </div>
        )}

        {/* Passo 2: Revisão e Duplicatas */}
        {step === 2 && activeBatch && (
          <div className="space-y-4">
            {warnings.length > 0 && (
              <div className="rounded-lg bg-[var(--color-warning-soft)] p-3 text-xs text-[var(--color-warning)] space-y-1">
                {warnings.map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="rounded-lg border border-[var(--color-border)] p-3">
                <span className="text-[var(--color-text-secondary)]">Importar novos</span>
                <p className="mt-1 text-lg font-bold text-[var(--color-text)]">{validToImport.length}</p>
              </div>
              <div className="rounded-lg border border-[var(--color-border)] p-3">
                <span className="text-[var(--color-text-secondary)]">Vincular manual</span>
                <p className="mt-1 text-lg font-bold text-[var(--color-primary)]">{linkedRows.length}</p>
              </div>
              <div className="rounded-lg border border-[var(--color-border)] p-3">
                <span className="text-[var(--color-text-secondary)]">Ignorados / Já existentes</span>
                <p className="mt-1 text-lg font-bold text-[var(--color-text-secondary)]">{ignoredRows.length}</p>
              </div>
              <div className="rounded-lg border border-[var(--color-border)] p-3">
                <span className="text-[var(--color-text-secondary)]">Com erro</span>
                <p className="mt-1 text-lg font-bold text-[var(--color-expense)]">{activeBatch.rejectedRows}</p>
              </div>
            </div>

            <div className="space-y-2 max-h-96 overflow-y-auto">
              {rowsPg.pageItems.map((row) => (
                <div
                  key={row.id}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-semibold text-[var(--color-text)]">
                        #{row.rowIndex} · {row.normalizedDescription || 'Sem descrição'}
                      </span>
                      <span className="ml-2 text-[var(--color-text-secondary)]">
                        {row.normalizedDate ? formatCivilDateBR(row.normalizedDate) : 'Data inválida'}
                      </span>
                    </div>
                    <span className="font-semibold text-sm">
                      {row.normalizedCents !== undefined ? (
                        <FinancialValue cents={row.normalizedCents} privacyMode={privacy} showSign />
                      ) : (
                        'Inválido'
                      )}
                    </span>
                  </div>

                  {row.candidateReason && (
                    <div className="rounded-md bg-[var(--color-warning-soft)] px-2.5 py-1.5 text-[var(--color-warning)]">
                      {row.candidateReason}
                    </div>
                  )}

                  {row.validationErrors.length > 0 && (
                    <div className="rounded-md bg-[var(--color-expense-soft)] px-2.5 py-1.5 text-[var(--color-expense)]">
                      {row.validationErrors.join(' · ')}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        aria-label={`Categoria da linha ${row.rowIndex}`}
                        value={row.suggestedCategoryId || ''}
                        onChange={(e) => handleDecisionChange(row.id, row.decision, e.target.value)}
                        className="focus-ring min-h-[36px] rounded-md border border-[var(--color-control-border)] bg-[var(--color-surface)] px-2"
                      >
                        <option value="">Sem categoria</option>
                        {workspace.categories.filter((c) => !c.isArchived || c.id === row.suggestedCategoryId).map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      {row.suggestionSource === 'ai' && row.suggestedCategoryId && (
                        <span
                          title="Sugestão da IA: confirme ou troque a categoria"
                          className="rounded-md bg-[var(--color-primary-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-primary)]"
                        >
                          IA{row.suggestionConfidence !== undefined ? ` · ${Math.round(row.suggestionConfidence * 100)}%` : ''}
                        </span>
                      )}
                      {row.suggestionSource === 'rule' && row.suggestedCategoryId && (
                        <span className="rounded-md bg-[var(--color-surface-muted)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-secondary)]">
                          Regra
                        </span>
                      )}
                    </div>

                    <select
                      aria-label={`Decisão da linha ${row.rowIndex}`}
                      value={row.decision}
                      onChange={(e) => handleDecisionChange(row.id, e.target.value as ImportDecision)}
                      className="focus-ring min-h-[36px] rounded-md border border-[var(--color-control-border)] bg-[var(--color-surface)] px-2 font-medium"
                    >
                      <option value="import_new">Importar como novo</option>
                      <option value="is_distinct">É outro lançamento (importar)</option>
                      {row.candidateMovementId && <option value="link_manual">Vincular ao manual existente</option>}
                      <option value="already_exists">Já existe (ignorar)</option>
                      <option value="review_later">Revisar depois (não entrar no saldo)</option>
                      <option value="excluded_invalid">Excluir linha</option>
                    </select>
                  </div>
                </div>
              ))}
            </div>
            <PaginationBar page={rowsPg.page} totalPages={rowsPg.totalPages} totalItems={rowsPg.totalItems} pageSize={rowsPg.pageSize} setPage={rowsPg.setPage} label="linhas" />

            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
              <Button variant="ghost" onClick={() => setStep(1)}>
                Voltar
              </Button>
              <Button variant="primary" onClick={() => setStep(3)}>
                Avançar para confirmação
              </Button>
            </div>
          </div>
        )}

        {/* Passo 3: Confirmação */}
        {step === 3 && activeBatch && (
          <div className="space-y-4">
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-5 space-y-2">
              <h3 className="text-base font-semibold text-[var(--color-text)]">Resumo antes de gravar</h3>
              <p className="text-sm text-[var(--color-text-secondary)]">
                Conta: <strong className="text-[var(--color-text)]">{accountMap.get(activeBatch.accountId)?.name}</strong> ·{' '}
                <strong>{validToImport.length}</strong> novo(s), <strong>{linkedRows.length}</strong> vinculado(s),{' '}
                <strong>{ignoredRows.length}</strong> ignorado(s)/excluído(s).
              </p>
              <p className="text-xs font-medium text-[var(--color-primary)]">
                Os lançamentos só afetarão seus saldos após a confirmação. A operação é atômica e idempotente.
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setStep(2)}>
                Revisar novamente
              </Button>
              <Button variant="primary" onClick={handleCommit} loading={loading}>
                Confirmar importação
              </Button>
            </div>
          </div>
        )}

        {/* Passo 4: Resultado */}
        {step === 4 && commitResult && (
          <div className="space-y-4">
            <div className="rounded-xl bg-[var(--color-income-soft)] p-5 flex items-start gap-3">
              <CheckCircle2 className="h-6 w-6 text-[var(--color-income)] shrink-0" aria-hidden="true" />
              <div>
                <h3 className="text-base font-semibold text-[var(--color-income)]">Lote processado com sucesso</h3>
                <p className="mt-1 text-sm text-[var(--color-text)]">
                  {commitResult.importedCount} lançamento(s) criado(s) · {commitResult.linkedCount} vinculado(s) ·{' '}
                  {commitResult.ignoredCount} ignorado(s).
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={onNavigateTransactions}>
                Ver lançamentos
              </Button>
              <Button variant="secondary" onClick={onNavigateAccounts}>
                Conferir saldo
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Histórico de Lotes */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 md:p-6">
        <h3 className="text-base font-semibold text-[var(--color-text)] mb-3">Histórico de lotes importados</h3>
        {workspace.importBatches.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">Nenhum lote de importação registrado ainda.</p>
        ) : (
          <div className="divide-y divide-[var(--color-border)]">
            {historyPg.pageItems.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs">
                <div>
                  <p className="font-semibold text-[var(--color-text)] text-sm">{b.fileName}</p>
                  <p className="text-[var(--color-text-secondary)]">
                    {accountMap.get(b.accountId)?.name || 'Conta'} · {b.format.toUpperCase()} · {b.totalRows} linha(s) ·{' '}
                    {b.validRows} importada(s)
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusTag
                    label={
                      b.status === 'committed'
                        ? 'Confirmado'
                        : b.status === 'reverted'
                          ? 'Revertido'
                          : 'Aguardando revisão'
                    }
                    tone={b.status === 'committed' ? 'income' : b.status === 'reverted' ? 'neutral' : 'warning'}
                  />
                  {b.status === 'committed' && (
                    <Button variant="ghost" onClick={() => {
                        setDialogError(null);
                        setPendingUndo({ id: b.id, fileName: b.fileName, count: b.rows.filter((r) => r.decision === 'import_new' || r.decision === 'is_distinct').length });
                      }} className="text-xs">
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                      Desfazer lote
                    </Button>
                  )}
                  {b.status !== 'committed' && (
                    <Button variant="ghost" onClick={() => { setDialogError(null); setPendingDelete({ id: b.id, fileName: b.fileName }); }} className="text-xs text-[var(--color-expense)]">
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Excluir
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        <PaginationBar page={historyPg.page} totalPages={historyPg.totalPages} totalItems={historyPg.totalItems} pageSize={historyPg.pageSize} setPage={historyPg.setPage} label="lotes" />
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Excluir lote do histórico?"
        message={pendingDelete ? `O lote "${pendingDelete.fileName}" será removido do histórico. Esta ação não pode ser desfeita.` : ''}
        confirmLabel="Excluir lote"
        destructive
        requirePassword
        error={dialogError}
        loading={loading}
        onConfirm={handleDeleteBatch}
        onCancel={() => setPendingDelete(null)}
      />
      <ConfirmDialog
        open={pendingUndo !== null}
        title="Desfazer esta importação?"
        message={
          pendingUndo
            ? `Todos os lançamentos criados pelo arquivo "${pendingUndo.fileName}" serão removidos das listas e dos saldos. Use quando importou o arquivo errado.`
            : ''
        }
        confirmLabel="Desfazer importação"
        destructive
        requirePassword
        error={dialogError}
        loading={loading}
        onConfirm={handleUndoBatch}
        onCancel={() => setPendingUndo(null)}
      />
    </div>
  );
};

