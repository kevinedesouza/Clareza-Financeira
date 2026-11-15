import React, { useEffect, useId, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import { Button } from './Primitives';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  /** Pede a senha da conta antes de confirmar (exclusões). A senha é passada para onConfirm. */
  requirePassword?: boolean;
  /** Mensagem de erro exibida dentro do diálogo (ex.: senha incorreta). */
  error?: string | null;
  onConfirm: (password?: string) => void;
  onCancel: () => void;
  /** Conteúdo extra entre a mensagem e o campo de senha (ex.: escolha de destino). */
  children?: React.ReactNode;
}

/** Diálogo de confirmação do próprio sistema (substitui window.confirm do navegador). */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  destructive = false,
  loading = false,
  requirePassword = false,
  error = null,
  onConfirm,
  onCancel,
  children,
}) => {
  const titleId = useId();
  const [password, setPassword] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setPassword('');
      return;
    }
    if (requirePassword) setTimeout(() => inputRef.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, loading, onCancel, requirePassword]);

  // Senha errada: limpa o campo para nova tentativa
  useEffect(() => {
    if (error && requirePassword) {
      setPassword('');
      inputRef.current?.focus();
    }
  }, [error, requirePassword]);

  if (!open) return null;

  const canConfirm = !requirePassword || password.length > 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canConfirm || loading) return;
    onConfirm(requirePassword ? password : undefined);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/50 p-0 md:p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={`${titleId}-desc`}
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onCancel();
      }}
    >
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-t-[20px] md:rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 md:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-xl"
      >
        <h2 id={titleId} className="text-lg font-semibold text-[var(--color-text)]">
          {title}
        </h2>
        <p id={`${titleId}-desc`} className="mt-2 text-sm text-[var(--color-text-secondary)]">
          {message}
        </p>

        {children}

        {requirePassword && (
          <div className="mt-4">
            <label htmlFor={`${titleId}-pwd`} className="mb-1 flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-secondary)]">
              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
              Digite sua senha para confirmar
            </label>
            <input
              ref={inputRef}
              id={`${titleId}-pwd`}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              className="focus-ring w-full min-h-[44px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
            />
          </div>
        )}

        {error && (
          <div role="alert" className="mt-3 rounded-lg bg-[var(--color-expense-soft)] px-3 py-2 text-xs text-[var(--color-expense)]">
            {error}
          </div>
        )}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button type="submit" variant={destructive ? 'destructive' : 'primary'} loading={loading} disabled={!canConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </div>
  );
};
