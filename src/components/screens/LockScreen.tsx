import React, { useEffect, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import { Button } from '../ui/Primitives';
import { MAX_PIN_ATTEMPTS, markActive, verifyPin } from '../../lib/security/appLock';

interface Props {
  displayName: string;
  onUnlock: () => void;
  /** Esqueceu o PIN ou errou demais: sai da conta (precisa entrar com a senha de novo). */
  onLogout: () => void;
}

export const LockScreen: React.FC<Props> = ({ displayName, onUnlock, onLogout }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [checking, setChecking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin || checking) return;
    setChecking(true);
    const ok = await verifyPin(pin);
    setChecking(false);
    if (ok) {
      markActive();
      onUnlock();
      return;
    }
    const next = attempts + 1;
    setAttempts(next);
    setPin('');
    if (next >= MAX_PIN_ATTEMPTS) {
      onLogout();
      return;
    }
    setError(`PIN incorreto. ${MAX_PIN_ATTEMPTS - next} tentativa(s) antes de sair da conta.`);
    inputRef.current?.focus();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--color-bg)] p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center shadow-xl"
        aria-labelledby="lock-title"
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-primary-soft)] text-[var(--color-primary)]">
          <Lock className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 id="lock-title" className="mt-4 text-lg font-semibold text-[var(--color-text)]">
          App bloqueado
        </h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Olá, {displayName}. Digite seu PIN para continuar.</p>
        <label htmlFor="lock-pin" className="sr-only">
          PIN
        </label>
        <input
          ref={inputRef}
          id="lock-pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          pattern="\d*"
          maxLength={6}
          value={pin}
          onChange={(e) => {
            setPin(e.target.value.replace(/\D/g, '').slice(0, 6));
            setError(null);
          }}
          className="focus-ring mt-5 w-full min-h-[52px] rounded-lg border border-[var(--color-control-border)] bg-[var(--color-surface)] px-3 text-center text-2xl tracking-[0.5em] text-[var(--color-text)]"
        />
        {error && (
          <p role="alert" className="mt-3 text-xs text-[var(--color-expense)]">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" loading={checking} disabled={pin.length < 4} className="mt-5 w-full">
          Desbloquear
        </Button>
        <button
          type="button"
          onClick={onLogout}
          className="focus-ring mt-4 rounded-md text-xs font-medium text-[var(--color-primary)] hover:underline cursor-pointer"
        >
          Esqueci o PIN (entrar com a senha)
        </button>
      </form>
    </div>
  );
};
