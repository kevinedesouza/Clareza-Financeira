import React, { useState } from 'react';
import { Category, WorkspaceData } from '../../lib/domain/types';
import { apiRequest } from '../../lib/api/client';
import { Button, StatusTag } from '../ui/Primitives';
import { PaginationBar, usePagination } from '../ui/Pagination';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useToast } from '../ui/Toast';
import {
  LOCK_TIMEOUT_OPTIONS,
  disableLock,
  enableLock,
  isValidPin,
  lockAvailable,
  readLockConfig,
  updateLockTimeout,
  verifyPin,
} from '../../lib/security/appLock';
import { Archive, ArchiveRestore, Check, Lock, Pencil, Trash2, X } from 'lucide-react';

const inputCls =
  'focus-ring w-full min-h-[44px] md:min-h-[40px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]';
const iconBtn =
  'focus-ring inline-flex h-10 w-10 md:h-8 md:w-8 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)] cursor-pointer';

const errMsg = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

// ---------------------------------------------------------------------------
// Categorias
// ---------------------------------------------------------------------------

export const CategoryManager: React.FC<{ workspace: WorkspaceData; onRefresh: () => Promise<void> }> = ({ workspace, onRefresh }) => {
  const toast = useToast();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [adding, setAdding] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Category | null>(null);
  const [moveTo, setMoveTo] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const userCats = workspace.categories.filter((c) => c.kind === 'expense' || c.kind === 'income');
  const visible = userCats
    .filter((c) => showArchived || !c.isArchived)
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, 'pt-BR'));
  const archivedCount = userCats.filter((c) => c.isArchived).length;
  const usage = (catId: string) => workspace.events.filter((e) => !e.isDeleted && e.categoryId === catId).length;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setAdding(true);
    try {
      await apiRequest('/api/categories', { method: 'POST', body: { name, kind } });
      await onRefresh();
      setName('');
      toast({ message: 'Categoria criada.' });
    } catch (err) {
      toast({ message: errMsg(err, 'Não foi possível criar a categoria.'), tone: 'error' });
    } finally {
      setAdding(false);
    }
  };

  const patch = async (c: Category, body: Record<string, unknown>, ok: string, undo?: Record<string, unknown>) => {
    setBusyId(c.id);
    try {
      await apiRequest(`/api/categories/${c.id}`, { method: 'PATCH', body });
      await onRefresh();
      setEditId(null);
      toast({
        message: ok,
        ...(undo
          ? {
              actionLabel: 'Desfazer',
              onAction: async () => {
                await apiRequest(`/api/categories/${c.id}`, { method: 'PATCH', body: undo });
                await onRefresh();
              },
            }
          : {}),
      });
    } catch (err) {
      toast({ message: errMsg(err, 'Não foi possível salvar.'), tone: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async (password?: string) => {
    if (!toDelete) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await apiRequest(`/api/categories/${toDelete.id}`, { method: 'DELETE', body: { password, moveToCategoryId: moveTo || undefined } });
      await onRefresh();
      toast({ message: `Categoria "${toDelete.name}" excluída.` });
      setToDelete(null);
    } catch (err) {
      setDeleteError(errMsg(err, 'Falha ao excluir.'));
    } finally {
      setDeleteBusy(false);
    }
  };

  const pg = usePagination(visible, 12, 'categorias');
  const deleteUsage = toDelete ? usage(toDelete.id) : 0;
  const moveOptions = toDelete ? userCats.filter((c) => c.id !== toDelete.id && c.kind === toDelete.kind && !c.isArchived) : [];

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-5 md:p-6 space-y-4">
      <div>
        <h3 className="text-base font-semibold text-[var(--color-text)]">Categorias</h3>
        <p className="text-xs text-[var(--color-text-secondary)]">
          Renomeie, arquive (some das listas, mas o histórico fica) ou exclua.
        </p>
      </div>
      <form onSubmit={add} className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2">
        <label htmlFor="cat-new" className="sr-only">
          Nome da nova categoria
        </label>
        <input id="cat-new" type="text" placeholder="Nova categoria" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        <label htmlFor="cat-kind" className="sr-only">
          Tipo
        </label>
        <select id="cat-kind" value={kind} onChange={(e) => setKind(e.target.value as 'expense' | 'income')} className={`${inputCls} sm:w-auto`}>
          <option value="expense">Despesa</option>
          <option value="income">Receita</option>
        </select>
        <Button type="submit" variant="primary" loading={adding} disabled={!name.trim()}>
          Adicionar
        </Button>
      </form>

      {archivedCount > 0 && (
        <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)] cursor-pointer">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="h-4 w-4" />
          Mostrar arquivadas ({archivedCount})
        </label>
      )}

      <ul className="divide-y divide-[var(--color-border)]">
        {pg.pageItems.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2 py-2">
            {editId === c.id ? (
              <form
                className="flex flex-1 items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (editName.trim() && editName.trim() !== c.name) patch(c, { name: editName }, 'Categoria renomeada.');
                  else setEditId(null);
                }}
              >
                <label htmlFor={`cat-edit-${c.id}`} className="sr-only">
                  Novo nome
                </label>
                <input id={`cat-edit-${c.id}`} autoFocus value={editName} onChange={(e) => setEditName(e.target.value)} className={inputCls} />
                <button type="submit" aria-label="Salvar nome" className={iconBtn} disabled={busyId === c.id}>
                  <Check className="h-4 w-4" aria-hidden="true" />
                </button>
                <button type="button" aria-label="Cancelar edição" onClick={() => setEditId(null)} className={iconBtn}>
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </form>
            ) : (
              <>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className={`text-sm ${c.isArchived ? 'text-[var(--color-text-secondary)] line-through' : 'text-[var(--color-text)]'}`}>{c.name}</span>
                  <StatusTag label={c.kind === 'income' ? 'Receita' : 'Despesa'} tone={c.kind === 'income' ? 'income' : 'neutral'} />
                  {c.isArchived && <StatusTag label="Arquivada" tone="neutral" />}
                </div>
                <div className="flex shrink-0 items-center">
                  <button
                    type="button"
                    onClick={() => {
                      setEditId(c.id);
                      setEditName(c.name);
                    }}
                    aria-label={`Renomear ${c.name}`}
                    title="Renomear"
                    className={iconBtn}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    disabled={busyId === c.id}
                    onClick={() =>
                      c.isArchived
                        ? patch(c, { isArchived: false }, 'Categoria reativada.')
                        : patch(c, { isArchived: true }, `"${c.name}" arquivada.`, { isArchived: false })
                    }
                    aria-label={c.isArchived ? `Reativar ${c.name}` : `Arquivar ${c.name}`}
                    title={c.isArchived ? 'Reativar' : 'Arquivar'}
                    className={iconBtn}
                  >
                    {c.isArchived ? <ArchiveRestore className="h-4 w-4" aria-hidden="true" /> : <Archive className="h-4 w-4" aria-hidden="true" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteError(null);
                      setMoveTo('');
                      setToDelete(c);
                    }}
                    aria-label={`Excluir ${c.name}`}
                    title="Excluir"
                    className={`${iconBtn} hover:text-[var(--color-expense)]`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      <PaginationBar page={pg.page} totalPages={pg.totalPages} totalItems={pg.totalItems} pageSize={pg.pageSize} setPage={pg.setPage} label="categorias" />

      <ConfirmDialog
        open={!!toDelete}
        title={`Excluir a categoria "${toDelete?.name ?? ''}"?`}
        message={
          deleteUsage > 0
            ? `${deleteUsage} lançamento(s) usam esta categoria. Escolha abaixo para onde movê-los; se não escolher, eles ficam "Sem categoria" e voltam para revisão. Limites e regras desta categoria serão apagados.`
            : 'Nenhum lançamento usa esta categoria. Limites e regras dela serão apagados.'
        }
        confirmLabel="Excluir categoria"
        destructive
        requirePassword
        error={deleteError}
        loading={deleteBusy}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      >
        {deleteUsage > 0 && (
          <div className="mt-4">
            <label htmlFor="cat-move" className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">
              Mover lançamentos para
            </label>
            <select id="cat-move" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className={inputCls}>
              <option value="">Deixar sem categoria</option>
              {moveOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </ConfirmDialog>
    </section>
  );
};

// ---------------------------------------------------------------------------
// Regras de categorização
// ---------------------------------------------------------------------------

export const RuleManager: React.FC<{ workspace: WorkspaceData; onRefresh: () => Promise<void> }> = ({ workspace, onRefresh }) => {
  const toast = useToast();
  const activeCats = workspace.categories.filter((c) => !c.isArchived && (c.kind === 'expense' || c.kind === 'income'));
  const [match, setMatch] = useState('');
  const [catId, setCatId] = useState(activeCats[0]?.id || '');
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const catName = (id: string) => workspace.categories.find((c) => c.id === id)?.name || 'Categoria removida';

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!match.trim() || !catId) return;
    setAdding(true);
    try {
      await apiRequest('/api/category-rules', { method: 'POST', body: { matchText: match, targetCategoryId: catId } });
      await onRefresh();
      setMatch('');
      toast({ message: 'Regra salva. Vale para as próximas importações.' });
    } catch (err) {
      toast({ message: errMsg(err, 'Não foi possível salvar a regra.'), tone: 'error' });
    } finally {
      setAdding(false);
    }
  };

  const toggle = async (id: string, isActive: boolean) => {
    setBusyId(id);
    try {
      await apiRequest(`/api/category-rules/${id}`, { method: 'PATCH', body: { isActive } });
      await onRefresh();
      toast({ message: isActive ? 'Regra ativada.' : 'Regra desativada.' });
    } catch (err) {
      toast({ message: errMsg(err, 'Não foi possível alterar a regra.'), tone: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string, matchText: string, targetCategoryId: string) => {
    setBusyId(id);
    try {
      await apiRequest(`/api/category-rules/${id}`, { method: 'DELETE' });
      await onRefresh();
      toast({
        message: 'Regra excluída.',
        actionLabel: 'Desfazer',
        onAction: async () => {
          await apiRequest('/api/category-rules', { method: 'POST', body: { matchText, targetCategoryId } });
          await onRefresh();
        },
      });
    } catch (err) {
      toast({ message: errMsg(err, 'Não foi possível excluir a regra.'), tone: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  const pg = usePagination(workspace.categoryRules, undefined, 'regras');

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-5 md:p-6 space-y-4">
      <div>
        <h3 className="text-base font-semibold text-[var(--color-text)]">Regras de categorização</h3>
        <p className="text-xs text-[var(--color-text-secondary)]">
          Na importação de extrato, descrições com estas palavras já recebem a categoria. Separe palavras com | (ex.: uber|99).
        </p>
      </div>
      <form onSubmit={add} className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2">
        <label htmlFor="rule-match" className="sr-only">
          Palavras da descrição
        </label>
        <input id="rule-match" type="text" placeholder="Palavras (ex.: uber|99)" value={match} onChange={(e) => setMatch(e.target.value)} className={inputCls} />
        <label htmlFor="rule-cat" className="sr-only">
          Categoria
        </label>
        <select id="rule-cat" value={catId} onChange={(e) => setCatId(e.target.value)} className={`${inputCls} sm:w-auto`}>
          {activeCats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <Button type="submit" variant="primary" loading={adding} disabled={!match.trim()}>
          Salvar regra
        </Button>
      </form>
      {workspace.categoryRules.length === 0 ? (
        <p className="text-xs text-[var(--color-text-secondary)]">Nenhuma regra ainda.</p>
      ) : (
        <>
          <ul className="divide-y divide-[var(--color-border)] text-xs">
            {pg.pageItems.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                <div className={`min-w-0 ${r.isActive ? '' : 'opacity-60'}`}>
                  <span className="font-mono-ref text-[var(--color-text)] break-all">{r.matchText}</span>
                  <span className="text-[var(--color-text-secondary)]"> → {catName(r.targetCategoryId)}</span>
                  {!r.isActive && <StatusTag label="Desativada" className="ml-2" />}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <label className="inline-flex min-h-[40px] items-center gap-1.5 px-1 text-[11px] text-[var(--color-text-secondary)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={r.isActive}
                      disabled={busyId === r.id}
                      onChange={(e) => toggle(r.id, e.target.checked)}
                      className="h-4 w-4"
                    />
                    Ativa
                  </label>
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => remove(r.id, r.matchText, r.targetCategoryId)}
                    aria-label={`Excluir regra ${r.matchText}`}
                    title="Excluir"
                    className={`${iconBtn} hover:text-[var(--color-expense)]`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <PaginationBar page={pg.page} totalPages={pg.totalPages} totalItems={pg.totalItems} pageSize={pg.pageSize} setPage={pg.setPage} label="regras" />
        </>
      )}
    </section>
  );
};

// ---------------------------------------------------------------------------
// Bloqueio por PIN
// ---------------------------------------------------------------------------

export const AppLockSettings: React.FC = () => {
  const toast = useToast();
  const [cfg, setCfg] = useState(readLockConfig);
  const [mode, setMode] = useState<'idle' | 'enable' | 'disable'>('idle');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [timeout, setTimeoutMin] = useState<number>(cfg?.timeoutMinutes ?? 5);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!lockAvailable()) return null;

  const pinInput = (id: string, label: string, value: string, set: (v: string) => void) => (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">
        {label}
      </label>
      <input
        id={id}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={6}
        value={value}
        onChange={(e) => set(e.target.value.replace(/\D/g, '').slice(0, 6))}
        className={`${inputCls} tracking-[0.4em]`}
      />
    </div>
  );

  const reset = () => {
    setMode('idle');
    setPin('');
    setPin2('');
    setError(null);
  };

  const submitEnable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidPin(pin)) return setError('O PIN deve ter de 4 a 6 números.');
    if (pin !== pin2) return setError('Os dois PINs não são iguais.');
    setBusy(true);
    await enableLock(pin, timeout);
    setBusy(false);
    setCfg(readLockConfig());
    reset();
    toast({ message: 'Bloqueio por PIN ativado neste aparelho.' });
  };

  const submitDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await verifyPin(pin);
    setBusy(false);
    if (!ok) {
      setPin('');
      return setError('PIN incorreto.');
    }
    disableLock();
    setCfg(null);
    reset();
    toast({ message: 'Bloqueio por PIN desativado.' });
  };

  return (
    <div className="flex flex-col gap-3 border-t border-[var(--color-border)] pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-text)]">
            <Lock className="h-4 w-4" aria-hidden="true" />
            Bloqueio por PIN neste aparelho
          </p>
          <p className="text-xs text-[var(--color-text-secondary)]">
            {cfg
              ? `Ativado. O app pede o PIN depois de ${cfg.timeoutMinutes} min sem uso (inclusive se você fechar e abrir de novo depois disso).`
              : 'Pede um PIN de 4 a 6 números quando o app fica parado. Útil no celular.'}
          </p>
        </div>
        {mode === 'idle' &&
          (cfg ? (
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="lock-timeout" className="sr-only">
                Tempo sem uso
              </label>
              <select
                id="lock-timeout"
                value={cfg.timeoutMinutes}
                onChange={(e) => {
                  updateLockTimeout(Number(e.target.value));
                  setCfg(readLockConfig());
                }}
                className={`${inputCls} w-auto`}
              >
                {LOCK_TIMEOUT_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    Após {m} min
                  </option>
                ))}
              </select>
              <Button variant="secondary" onClick={() => setMode('disable')}>
                Desativar
              </Button>
            </div>
          ) : (
            <Button variant="secondary" onClick={() => setMode('enable')}>
              Ativar PIN
            </Button>
          ))}
      </div>

      {mode === 'enable' && (
        <form onSubmit={submitEnable} className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-lg bg-[var(--color-surface-muted)] p-3 items-end">
          {pinInput('pin-new', 'Novo PIN', pin, setPin)}
          {pinInput('pin-new2', 'Repita o PIN', pin2, setPin2)}
          <div>
            <label htmlFor="pin-timeout" className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">
              Bloquear após
            </label>
            <select id="pin-timeout" value={timeout} onChange={(e) => setTimeoutMin(Number(e.target.value))} className={inputCls}>
              {LOCK_TIMEOUT_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m} min sem uso
                </option>
              ))}
            </select>
          </div>
          {error && (
            <p role="alert" className="sm:col-span-3 text-xs text-[var(--color-expense)]">
              {error}
            </p>
          )}
          <div className="sm:col-span-3 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={reset}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" loading={busy}>
              Ativar bloqueio
            </Button>
          </div>
        </form>
      )}

      {mode === 'disable' && (
        <form onSubmit={submitDisable} className="flex flex-wrap items-end gap-3 rounded-lg bg-[var(--color-surface-muted)] p-3">
          <div className="flex-1 min-w-[160px]">{pinInput('pin-current', 'PIN atual', pin, setPin)}</div>
          <Button variant="ghost" onClick={reset}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={pin.length < 4}>
            Desativar
          </Button>
          {error && (
            <p role="alert" className="w-full text-xs text-[var(--color-expense)]">
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  );
};
