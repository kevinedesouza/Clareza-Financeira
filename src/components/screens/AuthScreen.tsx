import React, { useState } from 'react';
import { SupabaseDiagnostics } from '../../lib/domain/types';
import { apiRequest } from '../../lib/api/client';
import { Button, PWAInstallButton } from '../ui/Primitives';
import { SupabaseSqlModal } from '../modals/SupabaseSqlModal';
import { ShieldCheck, ArrowRight, Database, RefreshCw, Table2, CheckCircle2, AlertTriangle } from 'lucide-react';

interface Props {
  supabaseConfigured: boolean;
  supabaseStatus: SupabaseDiagnostics | null;
  onRefreshSupabase: () => Promise<void>;
  onAuthenticated: () => Promise<void>;
}

export const AuthScreen: React.FC<Props> = ({
  supabaseConfigured,
  supabaseStatus,
  onRefreshSupabase,
  onAuthenticated,
}) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [checkingConn, setCheckingConn] = useState(false);
  const [sqlModalOpen, setSqlModalOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    setLoading(true);
    try {
      if (mode === 'register') {
        const res = await apiRequest<{
          authenticated?: boolean;
          needsEmailConfirmation?: boolean;
          message?: string;
        }>('/api/auth/register', {
          method: 'POST',
          body: { email, password, displayName },
        });
        if (res.needsEmailConfirmation) {
          setInfoMsg(
            res.message || 'Conta criada no Supabase. Confirme o link enviado ao seu e-mail antes de entrar.'
          );
          setMode('login');
          return;
        }
      } else {
        await apiRequest('/api/auth/login', {
          method: 'POST',
          body: { email, password },
        });
      }
      await onAuthenticated();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Falha na autenticação.');
    } finally {
      setLoading(false);
    }
  };

  const handleEnterDemo = async () => {
    setErrorMsg(null);
    setInfoMsg(null);
    setDemoLoading(true);
    try {
      await apiRequest('/api/auth/demo', { method: 'POST', body: {} });
      await onAuthenticated();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Não foi possível iniciar o ambiente demonstrativo.');
    } finally {
      setDemoLoading(false);
    }
  };

  const handleCheckConnection = async () => {
    setCheckingConn(true);
    try {
      await onRefreshSupabase();
    } finally {
      setCheckingConn(false);
    }
  };

  const sbReady = Boolean(supabaseStatus?.authReachable && supabaseStatus?.schemaApplied);
  const sbReachableNeedsSchema = Boolean(supabaseStatus?.authReachable && !supabaseStatus?.schemaApplied);
  const sbUnreachable = Boolean(supabaseConfigured && supabaseStatus && !supabaseStatus.authReachable);

  return (
    <div className="min-h-screen bg-[var(--color-bg)] flex flex-col justify-between p-4 md:p-8">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <img src="/icon.svg" alt="Clareza Financeira" className="h-9 w-9 rounded-lg" />
          <span className="text-lg font-bold tracking-tight text-[var(--color-text)] whitespace-nowrap">
            Clareza Financeira
          </span>
        </div>
        <PWAInstallButton compact />
      </header>

      <main className="mx-auto my-8 grid w-full max-w-5xl grid-cols-1 gap-8 lg:grid-cols-12 lg:items-center">
        <div className="lg:col-span-6 space-y-5">
          <p className="text-xs font-semibold tracking-wide text-[var(--color-primary)]">
            Gestão financeira pessoal · BRL · America/Sao_Paulo
          </p>
          <h1 className="text-balance text-3xl md:text-4xl font-bold tracking-tight text-[var(--color-text)]">
            Clareza para decidir com números rastreáveis.
          </h1>
          <p className="text-base leading-relaxed text-[var(--color-text-secondary)]">
            Organize contas bancárias, cartões, importações CSV e OFX, agenda de vencimentos, orçamentos e metas com separação explícita entre caixa realizado, competência e projeção.
          </p>

          <div className="space-y-3 border-t border-[var(--color-border)] pt-5 text-sm text-[var(--color-text-secondary)]">
            <div className="flex items-start gap-3">
              <ShieldCheck className="h-5 w-5 text-[var(--color-income)] shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                Base real começa vazia e isolada por proprietário. Alterações financeiras exigem conexão e confirmação do servidor.
              </span>
            </div>

            <div className="flex items-start gap-3">
              {sbReady ? (
                <CheckCircle2 className="h-5 w-5 text-[var(--color-income)] shrink-0 mt-0.5" aria-hidden="true" />
              ) : sbUnreachable || sbReachableNeedsSchema ? (
                <AlertTriangle className="h-5 w-5 text-[var(--color-warning)] shrink-0 mt-0.5" aria-hidden="true" />
              ) : (
                <Database className="h-5 w-5 text-[var(--color-primary)] shrink-0 mt-0.5" aria-hidden="true" />
              )}
              <div className="space-y-2 flex-1">
                <span>
                  {sbReady ? (
                    <>
                      Conectado ao Supabase (<strong className="text-[var(--color-text)]">{supabaseStatus?.projectHost}</strong>): Auth, PostgreSQL com RLS e bucket{' '}
                      <span className="font-mono-ref">{supabaseStatus?.storageBucketName}</span> operacionais.
                    </>
                  ) : sbReachableNeedsSchema ? (
                    <>
                      Chaves e Auth conectados em <strong className="text-[var(--color-text)]">{supabaseStatus?.projectHost}</strong>, mas o schema SQL inicial ainda não foi aplicado neste banco.
                    </>
                  ) : sbUnreachable ? (
                    <>
                      Chaves detectadas para <strong className="text-[var(--color-text)]">{supabaseStatus?.projectHost}</strong>, porém o endpoint não respondeu com HTTPS válido:{' '}
                      <span className="text-[var(--color-warning)]">{supabaseStatus?.schemaError}</span>
                    </>
                  ) : supabaseConfigured ? (
                    'Conectado ao projeto Supabase configurado.'
                  ) : (
                    'Modo de desenvolvimento local ativo: persistência em servidor local até que as chaves do Supabase sejam configuradas no ambiente.'
                  )}
                </span>

                {supabaseConfigured && (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="ghost" size="md" onClick={handleCheckConnection} loading={checkingConn}>
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                      Testar conexão
                    </Button>
                    <Button variant="secondary" size="md" onClick={() => setSqlModalOpen(true)}>
                      <Table2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Visualizar tabelas e SQL
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="pt-2">
            <Button variant="secondary" size="lg" onClick={handleEnterDemo} loading={demoLoading}>
              Explorar Ambiente Demonstrativo
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
            <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
              O ambiente demonstrativo usa dados sintéticos isolados e não altera sua base real.
            </p>
          </div>
        </div>

        <div className="lg:col-span-6">
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 md:p-8 shadow-sm">
            <div className="mb-6 flex items-center gap-1 rounded-lg bg-[var(--color-surface-muted)] p-1">
              <button
                type="button"
                onClick={() => setMode('login')}
                className={`flex-1 min-h-[40px] rounded-md text-sm font-medium transition-colors cursor-pointer ${
                  mode === 'login'
                    ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
                }`}
              >
                Entrar
              </button>
              <button
                type="button"
                onClick={() => setMode('register')}
                className={`flex-1 min-h-[40px] rounded-md text-sm font-medium transition-colors cursor-pointer ${
                  mode === 'register'
                    ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
                }`}
              >
                Criar conta pessoal
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'register' && (
                <div>
                  <label htmlFor="auth-name" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                    Nome de exibição
                  </label>
                  <input
                    id="auth-name"
                    type="text"
                    required
                    placeholder="Seu nome"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
                  />
                </div>
              )}

              <div>
                <label htmlFor="auth-email" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                  E-mail
                </label>
                <input
                  id="auth-email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="voce@exemplo.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
                />
              </div>

              <div>
                <label htmlFor="auth-pass" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                  Senha (mínimo 6 caracteres)
                </label>
                <input
                  id="auth-pass"
                  type="password"
                  required
                  minLength={6}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
                />
              </div>

              {infoMsg && (
                <div role="status" className="rounded-lg bg-[var(--color-income-soft)] px-3 py-2 text-xs text-[var(--color-income)]">
                  {infoMsg}
                </div>
              )}

              {errorMsg && (
                <div role="alert" className="rounded-lg bg-[var(--color-expense-soft)] px-3 py-2 text-xs text-[var(--color-expense)]">
                  {errorMsg}
                </div>
              )}

              <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">
                {mode === 'login' ? 'Acessar minha conta' : 'Configurar perfil e começar'}
              </Button>
            </form>
          </div>
        </div>
      </main>

      <footer className="mx-auto w-full max-w-5xl text-xs text-[var(--color-text-secondary)]">
        Clareza Financeira · Fuso America/Sao_Paulo · Moeda BRL
      </footer>

      <SupabaseSqlModal
        isOpen={sqlModalOpen}
        supabaseStatus={supabaseStatus}
        onClose={() => setSqlModalOpen(false)}
      />
    </div>
  );
};
