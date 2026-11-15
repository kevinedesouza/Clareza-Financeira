import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../lib/api/client';
import { Button, PWAInstallButton } from '../ui/Primitives';
import { ArrowLeft, Eye, EyeOff, ShieldCheck, Sun, Moon } from 'lucide-react';

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

/** Lê os dados do link de recuperação de senha enviado por e-mail (/redefinir-senha#access_token=...). */
export function readRecoveryLink(): { accessToken: string; refreshToken: string } | { error: string } | null {
  if (typeof window === 'undefined' || window.location.pathname !== '/redefinir-senha') return null;
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  if (params.get('error') || params.get('error_code')) {
    return { error: 'O link de recuperação expirou ou já foi usado. Peça um novo abaixo.' };
  }
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) return { error: 'Link de recuperação incompleto. Peça um novo abaixo.' };
  return { accessToken, refreshToken };
}

function clearRecoveryUrl() {
  try {
    window.history.replaceState(null, '', '/');
  } catch {
    /* ignora */
  }
}

const inputCls =
  'focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]';

const PasswordField: React.FC<{
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  hint?: string;
}> = ({ id, label, value, onChange, autoComplete, hint }) => {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          required
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputCls} pr-11`}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Esconder senha' : 'Mostrar senha'}
          aria-pressed={visible}
          className="focus-ring absolute right-1 top-1/2 -translate-y-1/2 inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)] cursor-pointer"
        >
          {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
      {hint && <p className="mt-1 text-[11px] text-[var(--color-text-secondary)]">{hint}</p>}
    </div>
  );
};

type Mode = 'login' | 'forgot' | 'reset';

interface Props {
  onAuthenticated: () => Promise<void>;
}

export const AuthScreen: React.FC<Props> = ({ onAuthenticated }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [authTheme, setAuthTheme] = useState<AuthTheme>(readAuthTheme);
  const [recovery] = useState(readRecoveryLink);
  const [mode, setMode] = useState<Mode>(() => (recovery && 'accessToken' in recovery ? 'reset' : recovery ? 'forgot' : 'login'));
  const [newPassword, setNewPassword] = useState('');
  const [newPassword2, setNewPassword2] = useState('');

  useEffect(() => {
    if (recovery && 'error' in recovery) {
      setErrorMsg(recovery.error);
      clearRecoveryUrl();
    }
  }, [recovery]);

  const switchMode = (m: Mode) => {
    setMode(m);
    setErrorMsg(null);
    setInfoMsg(null);
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    setLoading(true);
    try {
      const r = await apiRequest<{ message: string }>('/api/auth/forgot-password', { method: 'POST', body: { email } });
      setInfoMsg(r.message);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Não foi possível enviar o e-mail.');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recovery || !('accessToken' in recovery)) return;
    setErrorMsg(null);
    if (newPassword.length < 8) {
      setErrorMsg('A nova senha precisa ter pelo menos 8 caracteres.');
      return;
    }
    if (newPassword !== newPassword2) {
      setErrorMsg('As duas senhas não são iguais.');
      return;
    }
    setLoading(true);
    try {
      await apiRequest('/api/auth/reset-password', {
        method: 'POST',
        body: { accessToken: recovery.accessToken, refreshToken: recovery.refreshToken, password: newPassword },
      });
      clearRecoveryUrl();
      await onAuthenticated();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Não foi possível salvar a nova senha.');
    } finally {
      setLoading(false);
    }
  };

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

      <main className="mx-auto my-6 md:my-8 grid w-full max-w-5xl grid-cols-1 gap-8 lg:grid-cols-12 lg:items-center">
        <div className="order-2 lg:order-none lg:col-span-6 space-y-5">
          <h1 className="text-balance text-3xl md:text-4xl font-bold tracking-tight text-[var(--color-text)]">
            Clareza para decidir com números rastreáveis.
          </h1>
          <p className="text-base leading-relaxed text-[var(--color-text-secondary)]">
            Contas, cartões, extratos do banco, contas a pagar, orçamentos e metas em um só lugar. Veja quanto você tem hoje, quanto já gastou no mês e quanto deve sobrar.
          </p>

          <div className="flex items-start gap-3 border-t border-[var(--color-border)] pt-5 text-sm text-[var(--color-text-secondary)]">
            <ShieldCheck className="h-5 w-5 text-[var(--color-income)] shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              Seus dados são isolados por conta. Alterações financeiras são confirmadas pelo servidor antes de aparecer aqui.
            </span>
          </div>
        </div>

        <div className="order-1 lg:order-none lg:col-span-6">
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 md:p-8 shadow-sm">
            {mode !== 'login' && (
              <button
                type="button"
                onClick={() => {
                  clearRecoveryUrl();
                  switchMode('login');
                }}
                className="focus-ring mb-4 inline-flex items-center gap-1.5 rounded-md text-xs font-medium text-[var(--color-primary)] hover:underline cursor-pointer"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                Voltar para o login
              </button>
            )}
            <h2 className="mb-2 text-lg font-semibold text-[var(--color-text)]">
              {mode === 'login' ? 'Entrar na sua conta' : mode === 'forgot' ? 'Recuperar acesso' : 'Criar nova senha'}
            </h2>
            <p className="mb-6 text-xs text-[var(--color-text-secondary)]">
              {mode === 'login'
                ? 'Use o e-mail e a senha cadastrados.'
                : mode === 'forgot'
                  ? 'Informe seu e-mail. Enviaremos um link para você criar uma nova senha.'
                  : 'Escolha uma senha nova com pelo menos 8 caracteres.'}
            </p>

            {errorMsg && (
              <div role="alert" className="mb-4 rounded-lg bg-[var(--color-expense-soft)] px-3 py-2 text-xs text-[var(--color-expense)]">
                {errorMsg}
              </div>
            )}
            {infoMsg && (
              <div role="status" className="mb-4 rounded-lg bg-[var(--color-income-soft)] px-3 py-2 text-xs text-[var(--color-income)]">
                {infoMsg}
              </div>
            )}

            {mode === 'login' && (
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
                    inputMode="email"
                    placeholder="voce@exemplo.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <PasswordField id="auth-pass" label="Senha" value={password} onChange={setPassword} autoComplete="current-password" />
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => switchMode('forgot')}
                    className="focus-ring rounded-md text-xs font-medium text-[var(--color-primary)] hover:underline cursor-pointer"
                  >
                    Esqueci minha senha
                  </button>
                </div>
                <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">
                  Acessar minha conta
                </Button>
              </form>
            )}

            {mode === 'forgot' && (
              <form onSubmit={handleForgot} className="space-y-4">
                <div>
                  <label htmlFor="forgot-email" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                    E-mail da conta
                  </label>
                  <input
                    id="forgot-email"
                    type="email"
                    required
                    autoComplete="email"
                    inputMode="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">
                  Enviar link de recuperação
                </Button>
              </form>
            )}

            {mode === 'reset' && (
              <form onSubmit={handleReset} className="space-y-4">
                <PasswordField id="reset-pass" label="Nova senha" value={newPassword} onChange={setNewPassword} autoComplete="new-password" hint="Mínimo de 8 caracteres." />
                <PasswordField id="reset-pass2" label="Repita a nova senha" value={newPassword2} onChange={setNewPassword2} autoComplete="new-password" />
                <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">
                  Salvar nova senha e entrar
                </Button>
              </form>
            )}
          </div>
        </div>
      </main>

      <footer className="mx-auto w-full max-w-5xl text-xs text-[var(--color-text-secondary)]">
        Clareza Financeira · Fuso America/Sao_Paulo · Moeda BRL
      </footer>
    </div>
  );
};
