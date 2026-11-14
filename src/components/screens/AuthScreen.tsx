import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../lib/api/client';
import { Button, PWAInstallButton } from '../ui/Primitives';
import { ShieldCheck, Sun, Moon } from 'lucide-react';

// Tema da tela de acesso: claro por padrão, com escolha do usuário lembrada neste navegador.
// (Após o login, vale o tema salvo no perfil.)
const AUTH_THEME_KEY = 'clareza-auth-theme';
type AuthTheme = 'light' | 'dark';

function readAuthTheme(): AuthTheme {
  try {
    return localStorage.getItem(AUTH_THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function applyAuthTheme(theme: AuthTheme) {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.setAttribute('data-theme', theme);
}

interface Props {
  onAuthenticated: () => Promise<void>;
}

export const AuthScreen: React.FC<Props> = ({ onAuthenticated }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [authTheme, setAuthTheme] = useState<AuthTheme>(readAuthTheme);

  useEffect(() => {
    applyAuthTheme(authTheme);
    try {
      localStorage.setItem(AUTH_THEME_KEY, authTheme);
    } catch {
      /* armazenamento indisponível: o tema vale só nesta sessão */
    }
  }, [authTheme]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);
    try {
      await apiRequest('/api/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      await onAuthenticated();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Falha na autenticação.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--color-bg)] flex flex-col justify-between p-4 md:p-8">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <img src="/icon.svg" alt="Clareza Financeira" className="h-9 w-9 rounded-lg" />
          <span className="text-lg font-bold tracking-tight text-[var(--color-text)] whitespace-nowrap">
            Clareza Financeira
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAuthTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            aria-label={authTheme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}
            title={authTheme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}
            className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] text-[var(--color-text)] cursor-pointer"
          >
            {authTheme === 'dark' ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
          </button>
          <PWAInstallButton compact />
        </div>
      </header>

      <main className="mx-auto my-8 grid w-full max-w-5xl grid-cols-1 gap-8 lg:grid-cols-12 lg:items-center">
        <div className="lg:col-span-6 space-y-5">
          <h1 className="text-balance text-3xl md:text-4xl font-bold tracking-tight text-[var(--color-text)]">
            Clareza para decidir com números rastreáveis.
          </h1>
          <p className="text-base leading-relaxed text-[var(--color-text-secondary)]">
            Organize contas bancárias, cartões, importações CSV e OFX, agenda de vencimentos, orçamentos e metas com separação explícita entre caixa realizado, competência e projeção.
          </p>

          <div className="flex items-start gap-3 border-t border-[var(--color-border)] pt-5 text-sm text-[var(--color-text-secondary)]">
            <ShieldCheck className="h-5 w-5 text-[var(--color-income)] shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              Seus dados são isolados por conta. Alterações financeiras são confirmadas pelo servidor antes de aparecer aqui.
            </span>
          </div>
        </div>

        <div className="lg:col-span-6">
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 md:p-8 shadow-sm">
            <h2 className="mb-6 text-lg font-semibold text-[var(--color-text)]">Entrar na sua conta</h2>

            <form onSubmit={handleSubmit} className="space-y-4">
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
                  Senha
                </label>
                <input
                  id="auth-pass"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
                />
              </div>

              {errorMsg && (
                <div role="alert" className="rounded-lg bg-[var(--color-expense-soft)] px-3 py-2 text-xs text-[var(--color-expense)]">
                  {errorMsg}
                </div>
              )}

              <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">
                Acessar minha conta
              </Button>
            </form>
          </div>
        </div>
      </main>

      <footer className="mx-auto w-full max-w-5xl text-xs text-[var(--color-text-secondary)]">
        Clareza Financeira · Fuso America/Sao_Paulo · Moeda BRL
      </footer>
    </div>
  );
};
