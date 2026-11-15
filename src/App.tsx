import { useCallback, useEffect, useState } from 'react';
import { InsightItem, SupabaseDiagnostics, ThemeMode, TransferNature, WorkspaceData } from './lib/domain/types';
import { daysInMonth, todayCivilSaoPaulo } from './lib/domain/money';
import { apiRequest, ApiError } from './lib/api/client';
import { AppShell, NavTab } from './components/layout/AppShell';
import { AuthScreen } from './components/screens/AuthScreen';
import { DashboardView } from './components/screens/DashboardView';
import { TransactionsView } from './components/screens/TransactionsView';
import { AccountsView } from './components/screens/AccountsView';
import { CardsView } from './components/screens/CardsView';
import { ImportsView } from './components/screens/ImportsView';
import { AgendaView } from './components/screens/AgendaView';
import { PlanningView } from './components/screens/PlanningView';
import { InsightsView } from './components/screens/InsightsView';
import { ReportsView } from './components/screens/ReportsView';
import { SettingsView } from './components/screens/SettingsView';
import { QuickTransactionModal } from './components/forms/QuickTransactionModal';
import { TransferModal } from './components/forms/TransferModal';

function applyThemeToDocument(theme: ThemeMode) {
  const root = document.documentElement;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const useDark = theme === 'dark' || (theme === 'system' && prefersDark);
  if (useDark) {
    root.classList.add('dark');
    root.setAttribute('data-theme', 'dark');
  } else {
    root.classList.remove('dark');
    root.setAttribute('data-theme', 'light');
  }
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [supabaseConfigured, setSupabaseConfigured] = useState(false);
  const [supabaseStatus, setSupabaseStatus] = useState<SupabaseDiagnostics | null>(null);

  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [insights, setInsights] = useState<InsightItem[]>([]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string>(new Date().toISOString());
  const [globalError, setGlobalError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<NavTab>(() => {
    try {
      const saved = sessionStorage.getItem('clareza-tab') as NavTab | null;
      return saved || 'dashboard';
    } catch {
      return 'dashboard';
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem('clareza-tab', activeTab);
    } catch {
      /* sem armazenamento: volta ao início ao recarregar */
    }
  }, [activeTab]);
  const [txFilterCat, setTxFilterCat] = useState<string>('');
  const [txFilterPending, setTxFilterPending] = useState<boolean>(false);

  // Período padrão: mês civil atual (America/Sao_Paulo)
  const [periodMonth, setPeriodMonth] = useState<string>(() => todayCivilSaoPaulo().slice(0, 7));
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);

  // Modais globais
  const [quickTxOpen, setQuickTxOpen] = useState(false);
  const [quickTxNature, setQuickTxNature] = useState<'expense' | 'income'>('expense');
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferToAccId, setTransferToAccId] = useState<string | undefined>(undefined);
  const [transferNature, setTransferNature] = useState<TransferNature>('internal_transfer');

  const periodStart = `${periodMonth}-01`;
  const [pYear, pMonth] = periodMonth.split('-').map(Number);
  const periodEnd = `${periodMonth}-${String(daysInMonth(pYear, pMonth)).padStart(2, '0')}`;
  const todayDate = todayCivilSaoPaulo();

  const loadWorkspace = useCallback(async () => {
    try {
      setGlobalError(null);
      const data = await apiRequest<{
        workspace: WorkspaceData;
        insights: InsightItem[];
        fetchedAt: string;
      }>(`/api/workspace?periodStart=${periodStart}&periodEnd=${periodEnd}`);

      setWorkspace(data.workspace);
      setInsights(data.insights);
      setLastUpdatedAt(data.fetchedAt);
      applyThemeToDocument(data.workspace.profile.theme);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setAuthenticated(false);
        setWorkspace(null);
      } else {
        setGlobalError(err instanceof Error ? err.message : 'Erro ao atualizar dados.');
      }
    }
  }, [periodStart, periodEnd]);

  const bootstrapSession = useCallback(async () => {
    try {
      const sess = await apiRequest<{
        authenticated: boolean;
        supabaseConfigured: boolean;
        supabase?: SupabaseDiagnostics | null;
      }>('/api/auth/session');

      setSupabaseConfigured(sess.supabaseConfigured);
      setSupabaseStatus(sess.supabase ?? null);

      if (sess.authenticated) {
        setAuthenticated(true);
        await loadWorkspace();
      } else {
        setAuthenticated(false);
      }
    } catch {
      setAuthenticated(false);
    } finally {
      setBooting(false);
    }
  }, [loadWorkspace]);

  useEffect(() => {
    bootstrapSession();
  }, [bootstrapSession]);

  const refreshSupabaseStatus = useCallback(async () => {
    try {
      const health = await apiRequest<{
        supabaseConfigured: boolean;
        supabase?: SupabaseDiagnostics | null;
      }>('/api/health');
      setSupabaseConfigured(health.supabaseConfigured);
      setSupabaseStatus(health.supabase ?? null);
    } catch {
      // ignora erro transitório ao sondar saúde
    }
  }, []);

  // Revalidação ao recuperar foco ou reconectar internet (PRD §10)
  useEffect(() => {
    if (!authenticated) return;
    const onFocusOrOnline = () => {
      if (navigator.onLine) {
        loadWorkspace();
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') onFocusOrOnline();
    };
    window.addEventListener('focus', onFocusOrOnline);
    window.addEventListener('online', onFocusOrOnline);
    document.addEventListener('visibilitychange', onVisible);
    // Atualização periódica enquanto a aba estiver visível: mudanças feitas em outra aba,
    // outro aparelho ou pelo próprio app aparecem sem precisar recarregar a página.
    const timer = window.setInterval(onVisible, 20_000);
    return () => {
      window.removeEventListener('focus', onFocusOrOnline);
      window.removeEventListener('online', onFocusOrOnline);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [authenticated, loadWorkspace]);

  const handleLogout = async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignora erro de rede ao sair
    }
    setAuthenticated(false);
    setWorkspace(null);
    setInsights([]);
    setActiveTab('dashboard');
  };

  const handleThemeChange = async (theme: ThemeMode) => {
    applyThemeToDocument(theme);
    await apiRequest('/api/profile', { method: 'PATCH', body: { theme } });
    await loadWorkspace();
  };

  const handleTogglePrivacy = async () => {
    if (!workspace) return;
    await apiRequest('/api/profile', {
      method: 'PATCH',
      body: { privacyMode: !workspace.profile.privacyMode },
    });
    await loadWorkspace();
  };

  const handleNavigate = (tab: string, filter?: { categoryId?: string; reviewPending?: boolean }) => {
    setTxFilterCat(filter?.categoryId || '');
    setTxFilterPending(Boolean(filter?.reviewPending));
    setActiveTab(tab as NavTab);
  };

  const handleInsightTarget = (target: string) => {
    if (target.startsWith('transactions')) {
      const urlParams = new URLSearchParams(target.split('?')[1] || '');
      setTxFilterCat(urlParams.get('category') || '');
      setTxFilterPending(urlParams.get('review') === 'pending');
      setActiveTab('transactions');
    } else {
      setActiveTab(target as NavTab);
    }
  };

  if (booting) {
    return (
      <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center p-6">
        <div className="text-center space-y-2">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent" />
          <p className="text-sm text-[var(--color-text-secondary)]">Atualizando dados…</p>
        </div>
      </div>
    );
  }

  if (!authenticated || !workspace) {
    return (
      <AuthScreen
        onAuthenticated={async () => {
          setAuthenticated(true);
          await loadWorkspace();
        }}
      />
    );
  }

  return (
    <AppShell
      activeTab={activeTab}
      profile={workspace.profile}
      lastUpdatedAt={lastUpdatedAt}
      onSelectTab={(t) => {
        setTxFilterCat('');
        setTxFilterPending(false);
        setActiveTab(t);
      }}
      onNewTransaction={(nature = 'expense') => {
        setQuickTxNature(nature);
        setQuickTxOpen(true);
      }}
      onOpenTransfer={() => {
        setTransferNature('internal_transfer');
        setTransferToAccId(undefined);
        setTransferOpen(true);
      }}
      onTogglePrivacy={handleTogglePrivacy}
      onLogout={handleLogout}
    >
      {/* Barra contextual de período e contas nas telas analíticas */}
      {(activeTab === 'dashboard' || activeTab === 'reports' || activeTab === 'planning') && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="ctx-month" className="text-xs font-medium text-[var(--color-text-secondary)]">
              Período:
            </label>
            <input
              id="ctx-month"
              type="month"
              value={periodMonth}
              onChange={(e) => setPeriodMonth(e.target.value)}
              className="focus-ring min-h-[38px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-2.5 text-xs font-medium text-[var(--color-text)]"
            />
            {activeTab === 'dashboard' && workspace.accounts.length > 0 && (
              <select
                aria-label="Filtrar contas no painel"
                value={selectedAccountIds[0] || ''}
                onChange={(e) => setSelectedAccountIds(e.target.value ? [e.target.value] : [])}
                className="focus-ring min-h-[38px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)]"
              >
                <option value="">Todas as contas de liquidez</option>
                {workspace.accounts
                  .filter((a) => !a.isArchived && a.type !== 'credit_card')
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            )}
          </div>
          <span className="text-xs text-[var(--color-text-secondary)]">
            Moeda: BRL · Fuso: America/Sao_Paulo
          </span>
        </div>
      )}

      {globalError && (
        <div role="alert" className="mb-4 rounded-xl bg-[var(--color-expense-soft)] px-4 py-3 text-xs text-[var(--color-expense)]">
          {globalError}
        </div>
      )}

      {activeTab === 'dashboard' && (
        <DashboardView
          workspace={workspace}
          insights={insights}
          periodStart={periodStart}
          periodEnd={periodEnd}
          todayDate={todayDate}
          selectedAccountIds={selectedAccountIds}
          onNavigate={handleNavigate}
          onNewTransaction={() => {
            setQuickTxNature('expense');
            setQuickTxOpen(true);
          }}
          onOpenImport={() => setActiveTab('imports')}
        />
      )}

      {activeTab === 'transactions' && (
        <TransactionsView
          workspace={workspace}
          initialCategoryFilter={txFilterCat}
          initialPendingOnly={txFilterPending}
          onRefresh={loadWorkspace}
          onNewTransaction={() => {
            setQuickTxNature('expense');
            setQuickTxOpen(true);
          }}
        />
      )}

      {activeTab === 'accounts' && (
        <AccountsView
          workspace={workspace}
          onRefresh={loadWorkspace}
          onOpenTransfer={() => {
            setTransferNature('internal_transfer');
            setTransferToAccId(undefined);
            setTransferOpen(true);
          }}
        />
      )}

      {activeTab === 'cards' && (
        <CardsView
          workspace={workspace}
          onRefresh={loadWorkspace}
          onPayBill={(cardAccId) => {
            setTransferNature('card_payment');
            setTransferToAccId(cardAccId);
            setTransferOpen(true);
          }}
        />
      )}

      {activeTab === 'imports' && (
        <ImportsView
          workspace={workspace}
          onRefresh={loadWorkspace}
          onNavigateTransactions={() => setActiveTab('transactions')}
          onNavigateAccounts={() => setActiveTab('accounts')}
        />
      )}

      {activeTab === 'agenda' && (
        <AgendaView workspace={workspace} todayDate={todayDate} onRefresh={loadWorkspace} />
      )}

      {activeTab === 'planning' && (
        <PlanningView
          workspace={workspace}
          monthKey={periodMonth}
          todayDate={todayDate}
          onRefresh={loadWorkspace}
        />
      )}

      {activeTab === 'insights' && (
        <InsightsView
          insights={insights}
          onRefresh={loadWorkspace}
          onNavigateTarget={handleInsightTarget}
        />
      )}

      {activeTab === 'reports' && (
        <ReportsView
          workspace={workspace}
          periodStart={periodStart}
          periodEnd={periodEnd}
          todayDate={todayDate}
        />
      )}

      {activeTab === 'settings' && (
        <SettingsView
          workspace={workspace}
          supabaseConfigured={supabaseConfigured}
          supabaseStatus={supabaseStatus}
          onRefresh={loadWorkspace}
          onRefreshSupabase={refreshSupabaseStatus}
          onThemeChange={handleThemeChange}
          onTogglePrivacy={handleTogglePrivacy}
        />
      )}

      <QuickTransactionModal
        isOpen={quickTxOpen}
        initialNature={quickTxNature}
        accounts={workspace.accounts}
        categories={workspace.categories}
        projects={workspace.projects}
        onClose={() => setQuickTxOpen(false)}
        onSaved={loadWorkspace}
      />

      <TransferModal
        isOpen={transferOpen}
        accounts={workspace.accounts}
        defaultToAccountId={transferToAccId}
        defaultNature={transferNature}
        onClose={() => setTransferOpen(false)}
        onSaved={loadWorkspace}
      />
    </AppShell>
  );
}
