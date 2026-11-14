import React, { useMemo, useState } from 'react';
import { AccountMovement, WorkspaceData } from '../../lib/domain/types';
import { formatCivilDateBR } from '../../lib/domain/money';
import { buildSafeCsvExport } from '../../lib/importers/csvParser';
import { apiRequest } from '../../lib/api/client';
import { Button, FinancialValue, StatusTag } from '../ui/Primitives';
import { Download, Plus, Search, Trash2, X } from 'lucide-react';

interface Props {
  workspace: WorkspaceData;
  initialCategoryFilter?: string;
  initialPendingOnly?: boolean;
  onRefresh: () => Promise<void>;
  onNewTransaction: () => void;
}

export const TransactionsView: React.FC<Props> = ({
  workspace,
  initialCategoryFilter = '',
  initialPendingOnly = false,
  onRefresh,
  onNewTransaction,
}) => {
  const [search, setSearch] = useState('');
  const [accountFilter, setAccountFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState(initialCategoryFilter);
  const [pendingOnly, setPendingOnly] = useState(initialPendingOnly);
  const [selectedMov, setSelectedMov] = useState<AccountMovement | null>(null);

  // Estado do drawer de edição
  const [editDesc, setEditDesc] = useState('');
  const [editCatId, setEditCatId] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editReason, setEditReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);

  const accountMap = useMemo(() => new Map(workspace.accounts.map((a) => [a.id, a])), [workspace.accounts]);
  const eventMap = useMemo(() => new Map(workspace.events.map((e) => [e.id, e])), [workspace.events]);
  const categoryMap = useMemo(() => new Map(workspace.categories.map((c) => [c.id, c])), [workspace.categories]);
  const transferMap = useMemo(() => new Map(workspace.transferGroups.map((t) => [t.id, t])), [workspace.transferGroups]);

  const privacy = workspace.profile.privacyMode;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return workspace.movements
      .filter((m) => !m.isDeleted)
      .filter((m) => {
        if (accountFilter && m.accountId !== accountFilter) return false;
        if (pendingOnly && m.reviewStatus === 'reviewed') return false;
        const ev = m.eventId ? eventMap.get(m.eventId) : undefined;
        if (categoryFilter && ev?.categoryId !== categoryFilter) return false;
        if (q) {
          const accName = accountMap.get(m.accountId)?.name.toLowerCase() || '';
          const catName = ev?.categoryId ? categoryMap.get(ev.categoryId)?.name.toLowerCase() || '' : '';
          if (!m.description.toLowerCase().includes(q) && !accName.includes(q) && !catName.includes(q)) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
  }, [workspace.movements, accountFilter, pendingOnly, categoryFilter, search, eventMap, accountMap, categoryMap]);

  const openDetail = (mov: AccountMovement) => {
    const ev = mov.eventId ? eventMap.get(mov.eventId) : undefined;
    setSelectedMov(mov);
    setEditDesc(mov.description);
    setEditCatId(ev?.categoryId || '');
    setEditDate(mov.effectiveDate);
    setEditReason('');
    setDrawerError(null);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMov) return;
    setDrawerError(null);
    setSaving(true);
    try {
      await apiRequest(`/api/movements/${selectedMov.id}`, {
        method: 'PATCH',
        body: {
          expectedVersion: selectedMov.version,
          description: editDesc,
          categoryId: editCatId || null,
          effectiveDate: editDate,
          reason: editReason || undefined,
        },
      });
      await onRefresh();
      setSelectedMov(null);
    } catch (err) {
      setDrawerError(err instanceof Error ? err.message : 'Erro ao atualizar lançamento.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (mov: AccountMovement) => {
    setSaving(true);
    setDrawerError(null);
    try {
      await apiRequest(`/api/movements/${mov.id}`, {
        method: 'DELETE',
        body: { reason: 'Excluído pelo usuário na tela de Lançamentos' },
      });
      await onRefresh();
      setSelectedMov(null);
    } catch (err) {
      setDrawerError(err instanceof Error ? err.message : 'Falha ao excluir.');
    } finally {
      setSaving(false);
    }
  };

  const handleExportCsv = () => {
    const headers = ['Data', 'Descrição', 'Conta', 'Categoria', 'Natureza', 'Valor (centavos)', 'Origem', 'Conciliação'];
    const rows = filtered.map((m) => {
      const ev = m.eventId ? eventMap.get(m.eventId) : undefined;
      const tg = m.transferGroupId ? transferMap.get(m.transferGroupId) : undefined;
      const nature = tg ? 'Transferência' : ev?.nature === 'income' ? 'Receita' : 'Despesa';
      return [
        m.effectiveDate,
        m.description,
        accountMap.get(m.accountId)?.name || '',
        ev?.categoryId ? categoryMap.get(ev.categoryId)?.name || '' : 'Sem categoria',
        nature,
        m.signedCents,
        m.origin.toUpperCase(),
        m.reconciliationStatus,
      ];
    });
    const csv = buildSafeCsvExport(headers, rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clareza-lancamentos.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderNatureAndChips = (m: AccountMovement) => {
    const ev = m.eventId ? eventMap.get(m.eventId) : undefined;
    const tg = m.transferGroupId ? transferMap.get(m.transferGroupId) : undefined;
    const natureLabel = tg ? 'Transferência' : ev?.nature === 'income' || m.signedCents > 0 ? 'Receita' : 'Despesa';
    const natureTone = tg ? 'transfer' : ev?.nature === 'income' || m.signedCents > 0 ? 'income' : 'neutral';

    const qualityLabel =
      m.reconciliationStatus === 'reconciled'
        ? 'Conciliado'
        : m.reconciliationStatus === 'divergent'
          ? 'Divergência'
          : m.reviewStatus !== 'reviewed'
            ? 'Pendente'
            : 'Não conciliado';
    const qualityTone =
      m.reconciliationStatus === 'reconciled'
        ? 'income'
        : m.reconciliationStatus === 'divergent' || m.reviewStatus !== 'reviewed'
          ? 'warning'
          : 'neutral';

    return { natureLabel, natureTone, qualityLabel, qualityTone } as const;
  };

  return (
    <div className="space-y-4">
      {/* Barra de filtros e ações */}
      <div className="flex flex-col gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-secondary)]" />
            <input
              type="search"
              aria-label="Buscar lançamentos"
              placeholder="Buscar descrição, conta ou categoria..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="focus-ring w-full min-h-[44px] md:min-h-[40px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] pl-9 pr-3 text-sm text-[var(--color-text)]"
            />
          </div>

          <select
            aria-label="Filtrar por conta"
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value)}
            className="focus-ring min-h-[44px] md:min-h-[40px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
          >
            <option value="">Todas as contas</option>
            {workspace.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>

          <select
            aria-label="Filtrar por categoria"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="focus-ring min-h-[44px] md:min-h-[40px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
          >
            <option value="">Todas as categorias</option>
            {workspace.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setPendingOnly((p) => !p)}
            aria-pressed={pendingOnly}
            className={`focus-ring min-h-[44px] md:min-h-[40px] rounded-lg border px-3 text-xs font-medium cursor-pointer ${
              pendingOnly
                ? 'border-[var(--color-warning)] bg-[var(--color-warning-soft)] text-[var(--color-warning)]'
                : 'border-[var(--color-control-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)]'
            }`}
          >
            Pendências
          </button>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button variant="secondary" onClick={handleExportCsv}>
            <Download className="h-4 w-4" aria-hidden="true" />
            Exportar CSV
          </Button>
          <Button variant="primary" onClick={onNewTransaction}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Novo
          </Button>
        </div>
      </div>

      {/* Lista Mobile (Cards >= 72px) */}
      <div className="space-y-2 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center text-sm text-[var(--color-text-secondary)]">
            Nenhum lançamento encontrado para os filtros aplicados.
          </div>
        ) : (
          filtered.map((m) => {
            const ev = m.eventId ? eventMap.get(m.eventId) : undefined;
            const acc = accountMap.get(m.accountId);
            const cat = ev?.categoryId ? categoryMap.get(ev.categoryId) : undefined;
            const chips = renderNatureAndChips(m);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => openDetail(m)}
                className="focus-ring flex min-h-[76px] w-full flex-col justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-left cursor-pointer"
              >
                <div className="flex w-full items-start justify-between gap-3">
                  <span className="font-medium text-sm text-[var(--color-text)] leading-snug">{m.description}</span>
                  <span
                    className={`shrink-0 text-sm font-semibold ${
                      m.signedCents > 0 ? 'text-[var(--color-income)]' : 'text-[var(--color-text)]'
                    }`}
                  >
                    <FinancialValue cents={m.signedCents} privacyMode={privacy} showSign={m.signedCents > 0} />
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-text-secondary)]">
                  <span>
                    {formatCivilDateBR(m.effectiveDate)} · {acc?.name || 'Conta'} · {cat?.name || 'Sem categoria'}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <StatusTag label={chips.natureLabel} tone={chips.natureTone} />
                    <StatusTag label={chips.qualityLabel} tone={chips.qualityTone} />
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Tabela Desktop */}
      <div className="hidden md:block overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] text-xs text-[var(--color-text-secondary)]">
              <tr>
                <th className="px-4 py-3 font-medium">Data</th>
                <th className="px-4 py-3 font-medium">Descrição</th>
                <th className="px-4 py-3 font-medium">Conta</th>
                <th className="px-4 py-3 font-medium">Categoria</th>
                <th className="px-4 py-3 font-medium">Natureza</th>
                <th className="px-4 py-3 font-medium">Qualidade</th>
                <th className="px-4 py-3 font-medium">Origem</th>
                <th className="px-4 py-3 font-medium text-right">Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-[var(--color-text-secondary)]">
                    Nenhum lançamento encontrado para os filtros aplicados.
                  </td>
                </tr>
              ) : (
                filtered.map((m) => {
                  const ev = m.eventId ? eventMap.get(m.eventId) : undefined;
                  const acc = accountMap.get(m.accountId);
                  const cat = ev?.categoryId ? categoryMap.get(ev.categoryId) : undefined;
                  const chips = renderNatureAndChips(m);
                  return (
                    <tr
                      key={m.id}
                      onClick={() => openDetail(m)}
                      className="h-[54px] cursor-pointer transition-colors hover:bg-[var(--color-surface-muted)]/60"
                    >
                      <td className="px-4 py-3 text-xs text-[var(--color-text-secondary)] whitespace-nowrap">
                        {formatCivilDateBR(m.effectiveDate)}
                      </td>
                      <td className="px-4 py-3 font-medium text-[var(--color-text)]">{m.description}</td>
                      <td className="px-4 py-3 text-xs text-[var(--color-text-secondary)]">{acc?.name || '—'}</td>
                      <td className="px-4 py-3 text-xs text-[var(--color-text-secondary)]">
                        {cat?.name || <span className="text-[var(--color-warning)]">Sem categoria</span>}
                      </td>
                      <td className="px-4 py-3">
                        <StatusTag label={chips.natureLabel} tone={chips.natureTone} />
                      </td>
                      <td className="px-4 py-3">
                        <StatusTag label={chips.qualityLabel} tone={chips.qualityTone} />
                      </td>
                      <td className="px-4 py-3 text-xs font-mono-ref text-[var(--color-text-secondary)] uppercase">
                        {m.origin === 'system_transfer' ? 'SISTEMA' : m.origin}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-semibold whitespace-nowrap ${
                          m.signedCents > 0 ? 'text-[var(--color-income)]' : 'text-[var(--color-text)]'
                        }`}
                      >
                        <FinancialValue cents={m.signedCents} privacyMode={privacy} showSign={m.signedCents > 0} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Drawer lateral de detalhe e edição */}
      {selectedMov && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/40"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tx-detail-title"
        >
          <div className="w-full max-w-md bg-[var(--color-surface)] p-6 shadow-2xl overflow-y-auto border-l border-[var(--color-border)]">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
              <h3 id="tx-detail-title" className="text-base font-semibold text-[var(--color-text)]">
                Detalhe do lançamento
              </h3>
              <button
                type="button"
                onClick={() => setSelectedMov(null)}
                aria-label="Fechar detalhes"
                className="focus-ring flex h-10 w-10 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)] cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="mt-4 space-y-4">
              <div className="rounded-lg bg-[var(--color-surface-muted)] p-3 flex items-center justify-between">
                <span className="text-xs text-[var(--color-text-secondary)]">Valor registrado</span>
                <span className="text-lg font-bold text-[var(--color-text)]">
                  <FinancialValue cents={selectedMov.signedCents} privacyMode={privacy} showSign />
                </span>
              </div>

              <div>
                <label htmlFor="edit-desc" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                  Descrição
                </label>
                <input
                  id="edit-desc"
                  type="text"
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
                />
              </div>

              <div>
                <label htmlFor="edit-date" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                  Data efetiva
                </label>
                <input
                  id="edit-date"
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
                />
              </div>

              <div>
                <label htmlFor="edit-cat" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                  Categoria
                </label>
                <select
                  id="edit-cat"
                  value={editCatId}
                  onChange={(e) => setEditCatId(e.target.value)}
                  className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
                >
                  <option value="">Sem categoria</option>
                  {workspace.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              {selectedMov.reconciliationStatus === 'reconciled' && editDate !== selectedMov.effectiveDate && (
                <div className="rounded-lg bg-[var(--color-warning-soft)] p-3 space-y-2">
                  <p className="text-xs font-medium text-[var(--color-warning)]">
                    Este registro está conciliado. Alterar a data invalida a conferência da conta e exige motivo:
                  </p>
                  <input
                    type="text"
                    required
                    placeholder="Motivo da alteração"
                    value={editReason}
                    onChange={(e) => setEditReason(e.target.value)}
                    className="focus-ring w-full min-h-[40px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm"
                  />
                </div>
              )}

              {drawerError && (
                <div role="alert" className="rounded-lg bg-[var(--color-expense-soft)] px-3 py-2 text-xs text-[var(--color-expense)]">
                  {drawerError}
                </div>
              )}

              <div className="flex items-center justify-between pt-4 border-t border-[var(--color-border)]">
                <Button
                  variant="destructive"
                  onClick={() => handleDelete(selectedMov)}
                  disabled={saving}
                  className="text-xs"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Excluir
                </Button>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setSelectedMov(null)}>
                    Cancelar
                  </Button>
                  <Button type="submit" variant="primary" loading={saving}>
                    Salvar alterações
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
