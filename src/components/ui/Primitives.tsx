import React, { useState } from 'react';
import { Download, Loader2, WifiOff } from 'lucide-react';
import { formatBRL } from '../../lib/domain/money';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

export const FinancialValue: React.FC<{
  cents: number | null;
  privacyMode?: boolean;
  showSign?: boolean;
  className?: string;
  unknownLabel?: string;
}> = ({ cents, privacyMode = false, showSign = false, className = '', unknownLabel = 'Não validado' }) => {
  if (cents === null) {
    return (
      <span className={`financial-value text-[var(--color-warning)] font-medium ${className}`}>
        {unknownLabel}
      </span>
    );
  }
  if (privacyMode) {
    return (
      <span className={`financial-value whitespace-nowrap ${className}`} aria-label="Valor oculto">
        R$ •••••
      </span>
    );
  }
  return <span className={`financial-value whitespace-nowrap ${className}`}>{formatBRL(cents, { showSign })}</span>;
};

type SemanticTone = 'neutral' | 'income' | 'expense' | 'warning' | 'transfer' | 'goal';

const TONE_MAP: Record<SemanticTone, string> = {
  neutral: 'bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)] border-[var(--color-border)]',
  income: 'bg-[var(--color-income-soft)] text-[var(--color-income)] border-transparent',
  expense: 'bg-[var(--color-expense-soft)] text-[var(--color-expense)] border-transparent',
  warning: 'bg-[var(--color-warning-soft)] text-[var(--color-warning)] border-transparent',
  transfer: 'bg-[var(--color-primary-soft)] text-[var(--color-transfer)] border-transparent',
  goal: 'bg-[var(--color-goal-soft)] text-[var(--color-goal)] border-transparent',
};

export const StatusTag: React.FC<{
  label: string;
  tone?: SemanticTone;
  className?: string;
}> = ({ label, tone = 'neutral', className = '' }) => (
  <span
    className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap shrink-0 ${TONE_MAP[tone]} ${className}`}
  >
    {label}
  </span>
);

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
  size?: 'md' | 'lg';
  loading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  children,
  className = '',
  type = 'button',
  ...rest
}) => {
  const base =
    'focus-ring inline-flex items-center justify-center gap-2 rounded-[8px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:cursor-not-allowed';

  const sizeClass =
    size === 'lg'
      ? 'min-h-[48px] px-5 text-sm'
      : 'min-h-[44px] md:min-h-[40px] px-4 text-sm';

  const variantClass = {
    primary:
      'bg-[var(--color-primary)] text-[var(--color-on-primary)] hover:bg-[var(--color-primary-hover)] active:bg-[var(--color-primary-pressed)] disabled:bg-slate-300 disabled:text-slate-600 dark:disabled:bg-slate-700 dark:disabled:text-slate-400',
    secondary:
      'bg-[var(--color-surface)] text-[var(--color-text)] border border-[var(--color-control-border)] hover:bg-[var(--color-surface-muted)] disabled:bg-[var(--color-surface-muted)] disabled:text-[var(--color-text-secondary)]',
    ghost:
      'bg-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)] disabled:text-slate-400',
    destructive:
      'bg-[var(--color-expense)] text-white hover:opacity-90 disabled:bg-slate-300 disabled:text-slate-600',
  }[variant];

  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`${base} ${sizeClass} ${variantClass} ${className}`}
      {...rest}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
};

export const PWAInstallButton: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <Button variant="secondary" onClick={install} className={compact ? 'text-xs px-3' : ''}>
        <Download className="h-4 w-4" aria-hidden="true" />
        Instalar aplicativo
      </Button>
    );
  }

  if (isIOS) {
    return (
      <>
        <Button variant="secondary" onClick={() => setShowIOSGuide(true)} className={compact ? 'text-xs px-3' : ''}>
          <Download className="h-4 w-4" aria-hidden="true" />
          Instalar no iPhone
        </Button>
        {showIOSGuide && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ios-pwa-title"
          >
            <div className="w-full max-w-sm rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xl">
              <h3 id="ios-pwa-title" className="text-base font-semibold text-[var(--color-text)]">
                Instalar no iPhone ou iPad
              </h3>
              <ol className="mt-3 space-y-2 text-sm text-[var(--color-text-secondary)]">
                <li>1. Toque no botão <strong>Compartilhar</strong> na barra do Safari.</li>
                <li>2. Role até <strong>Adicionar à Tela de Início</strong>.</li>
                <li>3. Confirme tocando em <strong>Adicionar</strong>.</li>
              </ol>
              <div className="mt-5 flex justify-end">
                <Button variant="primary" onClick={() => setShowIOSGuide(false)}>
                  Entendi
                </Button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};

export const OfflineBanner: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 border-b border-[var(--color-warning)]/30 bg-[var(--color-warning-soft)] px-4 py-2 text-xs font-medium text-[var(--color-warning)]"
    >
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>Sem conexão. Conecte-se para consultar dados atualizados e salvar alterações.</span>
    </div>
  );
};
