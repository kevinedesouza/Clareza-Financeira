import React, { useRef, useState } from 'react';
import { SupabaseDiagnostics, ThemeMode, WorkspaceData } from '../../lib/domain/types';
import { apiRequest } from '../../lib/api/client';
import { Button, PWAInstallButton, StatusTag } from '../ui/Primitives';
import { PaginationBar, usePagination } from '../ui/Pagination';
import { SupabaseSqlModal } from '../modals/SupabaseSqlModal';
import { AppLockSettings, CategoryManager, RuleManager } from '../settings/SettingsManagers';
import { Download, EyeOff, Moon, RefreshCw, Sun, Table2, Upload } from 'lucide-react';

interface Props {
  workspace: WorkspaceData;
  supabaseConfigured: boolean;
  supabaseStatus: SupabaseDiagnostics | null;
  onRefresh: () => Promise<void>;
  onRefreshSupabase: () => Promise<void>;
  onThemeChange: (theme: ThemeMode) => Promise<void>;
  onTogglePrivacy: () => Promise<void>;
}

export const SettingsView: React.FC<Props> = ({
  workspace,
  supabaseConfigured,
  supabaseStatus,
  onRefresh,
  onRefreshSupabase,
  onThemeChange,
  onTogglePrivacy,
}) => {
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [checkingSb, setCheckingSb] = useState(false);
  const [sqlModalOpen, setSqlModalOpen] = useState(false);

  const handleExportPackage = async () => {
    const pkg = await apiRequest<Record<string, unknown>>('/api/exports/package');
    const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clareza-backup-pessoal.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRestorePackage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = await apiRequest<{ restoredAccounts: number; restoredMovements: number }>('/api/data-imports/restore', {
        method: 'POST',
        body: parsed,
      });
      await onRefresh();
      setStatusMsg(`Restauração concluída: ${res.restoredAccounts} conta(s) e ${res.restoredMovements} movimento(s).`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Pacote de backup inválido.');
    }
  };

  const auditPg = usePagination(workspace.auditLogs, undefined, 'auditoria');
  return (
    <div className="space-y-6">
      {statusMsg && (
        <div role="status" className="rounded-lg bg-[var(--color-income-soft)] px-4 py-2.5 text-xs text-[var(--color-income)]">
          {statusMsg}
        </div>
      )}
      {errorMsg && (
        <div role="alert" className="rounded-lg bg-[var(--color-expense-soft)] px-4 py-2.5 text-xs text-[var(--color-expense)]">
          {errorMsg}
        </div>
      )}

      {/* Aparência, Privacidade e PWA */}
      <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 md:p-6 space-y-4">
        <h2 className="text-base font-semibold text-[var(--color-text)]">Preferências e exibição</h2>

        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--color-border)] pb-4">
          <div>
            <p className="text-sm font-medium text-[var(--color-text)]">Tema da interface</p>
            <p className="text-xs text-[var(--color-text-secondary)]">Claro, escuro com contraste verificado ou automático.</p>
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-[var(--color-surface-muted)] p-1">
            {(
              [
                { id: 'light', label: 'Claro', icon: Sun },
                { id: 'dark', label: 'Escuro', icon: Moon },
                { id: 'system', label: 'Sistema', icon: null },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => onThemeChange(opt.id)}
                className={`min-h-[36px] inline-flex items-center gap-1.5 rounded-md px-3 text-xs font-medium cursor-pointer ${
                  workspace.profile.theme === opt.id
                    ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm'
                    : 'text-[var(--color-text-secondary)]'
                }`}
              >
                {opt.icon && <opt.icon className="h-3.5 w-3.5" aria-hidden="true" />}
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--color-border)] pb-4">
          <div>
            <p className="text-sm font-medium text-[var(--color-text)]">Modo privacidade</p>
            <p className="text-xs text-[var(--color-text-secondary)]">
              Oculta valores monetários em cards, tabelas e gráficos (recurso visual, não criptografia).
            </p>
          </div>
          <Button variant="secondary" onClick={onTogglePrivacy}>
            <EyeOff className="h-4 w-4" aria-hidden="true" />
            {workspace.profile.privacyMode ? 'Mostrar valores' : 'Ocultar valores'}
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-[var(--color-text)]">Aplicativo instalável (PWA)</p>
            <p className="text-xs text-[var(--color-text-secondary)]">
              Instale para acesso direto no desktop, Android ou iPhone. Requer internet para dados financeiros.
            </p>
          </div>
          <PWAInstallButton />
        </div>

        <AppLockSettings />
      </section>

      {/* Categorias e Regras */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        <CategoryManager workspace={workspace} onRefresh={onRefresh} />
        <RuleManager workspace={workspace} onRefresh={onRefresh} />
      </div>

      {/* Exportação pessoal, Diagnóstico e Auditoria */}
      <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 md:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-[var(--color-text)]">Exportação pessoal e diagnóstico</h3>
            <p className="text-xs text-[var(--color-text-secondary)]">
              Ambiente: Supabase PostgreSQL · Fuso {workspace.profile.timezone}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={handleExportPackage}>
              <Download className="h-4 w-4" aria-hidden="true" />
              Exportar pacote JSON
            </Button>
            <input
              ref={restoreInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleRestorePackage}
              className="sr-only"
              aria-label="Restaurar pacote pessoal"
            />
            <Button variant="secondary" onClick={() => restoreInputRef.current?.click()}>
              <Upload className="h-4 w-4" aria-hidden="true" />
              Restaurar em espaço vazio
            </Button>
          </div>
        </div>

        {supabaseConfigured && supabaseStatus && (
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)]/60 p-4 text-xs space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-semibold text-[var(--color-text)]">
                  Conexão Supabase: {supabaseStatus.projectHost || 'Configurado'}
                </span>
                <p className="text-[var(--color-text-secondary)]">
                  Bucket privado: <span className="font-mono-ref">{supabaseStatus.storageBucketName}</span>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusTag
                  label={supabaseStatus.authReachable ? 'Auth OK' : 'Auth indisponível'}
                  tone={supabaseStatus.authReachable ? 'income' : 'warning'}
                />
                <StatusTag
                  label={supabaseStatus.schemaApplied ? 'Schema SQL OK' : 'Schema pendente'}
                  tone={supabaseStatus.schemaApplied ? 'income' : 'warning'}
                />
                <StatusTag
                  label={supabaseStatus.storageBucketReady ? 'Storage OK' : 'Storage pendente'}
                  tone={supabaseStatus.storageBucketReady ? 'income' : 'neutral'}
                />
              </div>
            </div>
            {supabaseStatus.schemaError && (
              <p className="text-[var(--color-warning)]">{supabaseStatus.schemaError}</p>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                variant="ghost"
                size="md"
                loading={checkingSb}
                onClick={async () => {
                  setCheckingSb(true);
                  try {
                    await onRefreshSupabase();
                  } finally {
                    setCheckingSb(false);
                  }
                }}
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                Testar conexão
              </Button>
              <Button
                variant="secondary"
                size="md"
                onClick={() => setSqlModalOpen(true)}
              >
                <Table2 className="h-3.5 w-3.5" aria-hidden="true" />
                Visualizar tabelas e SQL
              </Button>
            </div>
          </div>
        )}

        <div className="border-t border-[var(--color-border)] pt-4">
          <h4 className="text-xs font-semibold text-[var(--color-text-secondary)] mb-2">Registro de auditoria recente</h4>
          <div className="max-h-44 overflow-y-auto divide-y divide-[var(--color-border)] text-xs">
            {workspace.auditLogs.length === 0 ? (
              <p className="py-2 text-[var(--color-text-secondary)]">Nenhuma alteração registrada nesta sessão.</p>
            ) : (
              auditPg.pageItems.map((log) => (
                <div key={log.id} className="flex justify-between gap-2 py-2">
                  <span className="text-[var(--color-text)]">
                    {log.entityType} · <strong>{log.action}</strong>
                    {log.reason ? ` (${log.reason})` : ''}
                  </span>
                  <span className="text-[var(--color-text-secondary)] shrink-0">
                    {new Date(log.createdAt).toLocaleString('pt-BR')}
                  </span>
                </div>
              ))
            )}
          </div>
          <PaginationBar page={auditPg.page} totalPages={auditPg.totalPages} totalItems={auditPg.totalItems} pageSize={auditPg.pageSize} setPage={auditPg.setPage} label="registros" />
        </div>
      </section>

      <SupabaseSqlModal
        isOpen={sqlModalOpen}
        supabaseStatus={supabaseStatus}
        onClose={() => setSqlModalOpen(false)}
      />
    </div>
  );
};
