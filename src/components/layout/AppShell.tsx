import React, { useEffect, useState } from 'react';
import { UserProfile } from '../../lib/domain/types';
import {
  ArrowLeftRight,
  BarChart3,
  Calendar,
  CreditCard,
  Eye,
  EyeOff,
  FileSpreadsheet,
  Home,
  Lightbulb,
  List,
  LogOut,
  Menu,
  PieChart,
  Plus,
  Settings,
  Target,
  Upload,
  Wallet,
  X,
} from 'lucide-react';
import { Button, OfflineBanner } from '../ui/Primitives';

export type NavTab =
  | 'dashboard'
  | 'transactions'
  | 'accounts'
  | 'cards'
  | 'imports'
  | 'agenda'
  | 'planning'
  | 'insights'
  | 'reports'
  | 'settings';

interface Props {
  activeTab: NavTab;
  profile: UserProfile;
  lastUpdatedAt: string;
  onSelectTab: (tab: NavTab) => void;
  onNewTransaction: (nature?: 'expense' | 'income') => void;
  onOpenTransfer: () => void;
  onTogglePrivacy: () => void;
  onLogout: () => void;
  children: React.ReactNode;
}

const NAV_GROUPS = [
  {
    group: 'Visão financeira',
    items: [
      { id: 'dashboard' as NavTab, label: 'Visão geral', icon: Home },
      { id: 'transactions' as NavTab, label: 'Lançamentos', icon: List },
      { id: 'accounts' as NavTab, label: 'Contas', icon: Wallet },
      { id: 'cards' as NavTab, label: 'Cartões', icon: CreditCard },
      { id: 'imports' as NavTab, label: 'Importações', icon: FileSpreadsheet },
    ],
  },
  {
    group: 'Planejamento',
    items: [
      { id: 'agenda' as NavTab, label: 'Agenda financeira', icon: Calendar },
      { id: 'planning' as NavTab, label: 'Orçamentos e metas', icon: Target },
      { id: 'insights' as NavTab, label: 'Insights', icon: Lightbulb },
      { id: 'reports' as NavTab, label: 'Relatórios', icon: BarChart3 },
    ],
  },
  {
    group: 'Administração pessoal',
    items: [{ id: 'settings' as NavTab, label: 'Configurações', icon: Settings }],
  },
];

const TAB_TITLES: Record<NavTab, string> = {
  dashboard: 'Visão geral',
  transactions: 'Lançamentos',
  accounts: 'Contas e conciliação',
  cards: 'Cartões e faturas',
  imports: 'Importar extrato',
  agenda: 'Agenda financeira',
  planning: 'Orçamentos e metas',
  insights: 'Insights',
  reports: 'Relatórios',
  settings: 'Configurações',
};

export const AppShell: React.FC<Props> = ({
  activeTab,
  profile,
  lastUpdatedAt,
  onSelectTab,
  onNewTransaction,
  onOpenTransfer,
  onTogglePrivacy,
  onLogout,
  children,
}) => {
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [showMoreSheet, setShowMoreSheet] = useState(false);

  const inMoreMenu = !['dashboard', 'transactions', 'agenda'].includes(activeTab);

  // Esc fecha as folhas inferiores
  useEffect(() => {
    if (!showAddSheet && !showMoreSheet) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowAddSheet(false);
        setShowMoreSheet(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showAddSheet, showMoreSheet]);

  const timeFormatted = (() => {
    try {
      return new Date(lastUpdatedAt).toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Sao_Paulo',
      });
    } catch {
      return '--:--';
    }
  })();

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] flex flex-col">
      {/* Menu lateral (notebook e desktop, >= 1024px) */}
      <aside
        aria-label="Navegação principal"
        className="hidden lg:flex lg:w-60 xl:w-64 lg:flex-col lg:fixed lg:inset-y-0 lg:z-30 bg-[var(--color-brand)] text-white border-r border-white/10"
      >
        <div className="flex h-16 items-center gap-3 px-5 border-b border-white/10">
          <img src="/icon.svg" alt="" className="h-8 w-8 rounded-lg" />
          <span className="text-base font-bold tracking-tight whitespace-nowrap">Clareza Financeira</span>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
          {NAV_GROUPS.map((grp) => (
            <div key={grp.group}>
              <p className="px-3 mb-2 text-[11px] font-medium text-blue-200/70">{grp.group}</p>
              <ul className="space-y-1">
                {grp.items.map((item) => {
                  const Icon = item.icon;
                  const active = activeTab === item.id;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => onSelectTab(item.id)}
                        aria-current={active ? 'page' : undefined}
                        className={`focus-ring flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
                          active
                            ? 'bg-white/15 text-white'
                            : 'text-blue-100/80 hover:bg-white/10 hover:text-white'
                        }`}
                      >
                        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span>{item.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/10 p-4 space-y-3">
          <div className="text-xs">
            <p className="font-medium text-white truncate">{profile.displayName}</p>
            <p className="text-blue-200/70 truncate">{profile.email}</p>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="focus-ring flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-blue-100 hover:bg-white/10 cursor-pointer"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Sair da conta
          </button>
        </div>
      </aside>

      {/* Área Principal */}
      <div className="flex-1 flex flex-col lg:pl-60 xl:pl-64 min-w-0">
        <OfflineBanner />

        {/* Header Top Bar */}
        <header className="sticky top-0 z-30 flex h-14 md:h-16 items-center justify-between gap-4 border-b border-[var(--color-border)] bg-[var(--color-surface)]/95 backdrop-blur-sm px-4 md:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <img src="/icon.svg" alt="" className="h-7 w-7 rounded-md lg:hidden shrink-0" />
            <div className="min-w-0">
              <h1 className="text-base md:text-lg font-bold text-[var(--color-text)] truncate">
                {TAB_TITLES[activeTab]}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="hidden md:inline text-xs text-[var(--color-text-secondary)] mr-2 whitespace-nowrap">
              Atualizado às {timeFormatted}
            </span>

            <button
              type="button"
              onClick={onTogglePrivacy}
              aria-label={profile.privacyMode ? 'Mostrar valores financeiros' : 'Ocultar valores financeiros'}
              title={profile.privacyMode ? 'Mostrar valores' : 'Ocultar valores'}
              className="focus-ring flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)] cursor-pointer"
            >
              {profile.privacyMode ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>

            <div className="hidden lg:flex items-center gap-2">
              <Button variant="secondary" onClick={() => onSelectTab('imports')}>
                <Upload className="h-4 w-4" aria-hidden="true" />
                Importar extrato
              </Button>
              <Button variant="primary" onClick={() => onNewTransaction('expense')}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Novo lançamento
              </Button>
            </div>
          </div>
        </header>

        {/* Conteúdo da página */}
        <main className="mx-auto w-full max-w-[1440px] flex-1 p-4 md:p-6 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-8">
          {children}
        </main>
      </div>

      {/* Navegação inferior (celular e tablet, < 1024px) */}
      <nav
        aria-label="Navegação inferior"
        className="fixed bottom-0 left-0 right-0 z-40 lg:hidden border-t border-[var(--color-border)] bg-[var(--color-surface)]/95 backdrop-blur-md pb-safe"
      >
        <div className="grid h-16 grid-cols-5 items-center">
          <button
            type="button"
            onClick={() => onSelectTab('dashboard')}
            className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium cursor-pointer ${
              activeTab === 'dashboard' ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-secondary)]'
            }`}
          >
            <Home className="h-5 w-5" aria-hidden="true" />
            <span>Início</span>
          </button>

          <button
            type="button"
            onClick={() => onSelectTab('transactions')}
            className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium cursor-pointer ${
              activeTab === 'transactions' ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-secondary)]'
            }`}
          >
            <List className="h-5 w-5" aria-hidden="true" />
            <span>Lançamentos</span>
          </button>

          <button
            type="button"
            onClick={() => setShowAddSheet(true)}
            aria-label="Adicionar lançamento ou transferência"
            className="flex min-h-[44px] flex-col items-center justify-center gap-0.5 text-[11px] font-semibold text-[var(--color-primary)] cursor-pointer"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-primary)] text-[var(--color-on-primary)]">
              <Plus className="h-5 w-5" aria-hidden="true" />
            </span>
            <span>Adicionar</span>
          </button>

          <button
            type="button"
            onClick={() => onSelectTab('agenda')}
            className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium cursor-pointer ${
              activeTab === 'agenda' ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-secondary)]'
            }`}
          >
            <Calendar className="h-5 w-5" aria-hidden="true" />
            <span>Agenda</span>
          </button>

          <button
            type="button"
            onClick={() => setShowMoreSheet(true)}
            aria-current={inMoreMenu ? 'page' : undefined}
            className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium cursor-pointer ${
              inMoreMenu ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-secondary)]'
            }`}
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
            <span>Mais</span>
          </button>
        </div>
      </nav>

      {/* Bottom Sheet: Adicionar (Receita, Despesa, Transferência) */}
      {showAddSheet && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Escolher tipo de registro"
          onClick={(e) => e.target === e.currentTarget && setShowAddSheet(false)}
        >
          <div className="w-full rounded-t-[20px] border-t border-[var(--color-border)] bg-[var(--color-surface)] p-5 pb-[max(2rem,env(safe-area-inset-bottom))] space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-[var(--color-text)]">Novo registro</h3>
              <button
                type="button"
                onClick={() => setShowAddSheet(false)}
                aria-label="Fechar"
                className="flex h-10 w-10 items-center justify-center rounded-lg text-[var(--color-text-secondary)]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2">
              <Button
                variant="secondary"
                size="lg"
                className="justify-start"
                onClick={() => {
                  setShowAddSheet(false);
                  onNewTransaction('expense');
                }}
              >
                Registrar Despesa
              </Button>
              <Button
                variant="secondary"
                size="lg"
                className="justify-start"
                onClick={() => {
                  setShowAddSheet(false);
                  onNewTransaction('income');
                }}
              >
                Registrar Receita
              </Button>
              <Button
                variant="secondary"
                size="lg"
                className="justify-start"
                onClick={() => {
                  setShowAddSheet(false);
                  onOpenTransfer();
                }}
              >
                <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
                Transferência ou pagamento de fatura
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Sheet: Mais (Todos os módulos P0/P1) */}
      {showMoreSheet && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Menu completo"
          onClick={(e) => e.target === e.currentTarget && setShowMoreSheet(false)}
        >
          <div className="w-full max-h-[85vh] overflow-y-auto rounded-t-[20px] border-t border-[var(--color-border)] bg-[var(--color-surface)] p-5 pb-[max(2rem,env(safe-area-inset-bottom))] space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-[var(--color-text)]">Módulos do Clareza</h3>
              <button
                type="button"
                onClick={() => setShowMoreSheet(false)}
                aria-label="Fechar"
                className="flex h-10 w-10 items-center justify-center rounded-lg text-[var(--color-text-secondary)]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { id: 'accounts', label: 'Contas', icon: Wallet },
                  { id: 'cards', label: 'Cartões', icon: CreditCard },
                  { id: 'imports', label: 'Importações', icon: FileSpreadsheet },
                  { id: 'planning', label: 'Orçamentos e Metas', icon: PieChart },
                  { id: 'insights', label: 'Insights', icon: Lightbulb },
                  { id: 'reports', label: 'Relatórios', icon: BarChart3 },
                  { id: 'settings', label: 'Configurações', icon: Settings },
                ] as const
              ).map((m) => {
                const Icon = m.icon;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setShowMoreSheet(false);
                      onSelectTab(m.id);
                    }}
                    aria-current={activeTab === m.id ? 'page' : undefined}
                    className={`flex min-h-[52px] items-center gap-2.5 rounded-xl border px-3 text-left text-sm font-medium text-[var(--color-text)] ${
                      activeTab === m.id
                        ? 'border-[var(--color-primary)] bg-[var(--color-primary-soft)]'
                        : 'border-[var(--color-border)] bg-[var(--color-surface-muted)]/50'
                    }`}
                  >
                    <Icon className="h-4 w-4 text-[var(--color-primary)] shrink-0" aria-hidden="true" />
                    <span className="min-w-0 leading-tight">{m.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="border-t border-[var(--color-border)] pt-3">
              <Button variant="ghost" onClick={onLogout} className="w-full justify-start text-[var(--color-expense)]">
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Sair da conta ({profile.displayName})
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
