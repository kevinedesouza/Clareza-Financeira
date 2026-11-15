import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';

export interface ToastOptions {
  message: string;
  tone?: 'success' | 'error' | 'info';
  /** Ex.: "Desfazer". O aviso fica 8 segundos quando tem ação. */
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
  durationMs?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
}

const ToastContext = createContext<(opts: ToastOptions) => void>(() => undefined);

/** Mostra um aviso curto no rodapé da tela (acima da barra de navegação no celular). */
export function useToast() {
  return useContext(ToastContext);
}

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((prev) => prev.filter((t) => t.id !== id)), []);

  const show = useCallback((opts: ToastOptions) => {
    const id = nextId.current++;
    // Um aviso por vez: o novo substitui o anterior
    setItems([{ ...opts, id }]);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-[calc(4rem+env(safe-area-inset-top))] lg:top-auto lg:bottom-6 z-[70] flex flex-col items-center gap-2 px-4"
      >
        {items.map((t) => (
          <ToastView key={t.id} item={t} onClose={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
};

const ToastView: React.FC<{ item: ToastItem; onClose: () => void }> = ({ item, onClose }) => {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const ms = item.durationMs ?? (item.onAction ? 8000 : 4000);
    const t = window.setTimeout(onClose, ms);
    return () => window.clearTimeout(t);
  }, [item, onClose]);

  const tone = item.tone ?? 'success';
  const Icon = tone === 'error' ? AlertCircle : CheckCircle2;

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl bg-[#162033] px-4 py-3 text-sm text-white shadow-xl dark:bg-[#E7EDF7] dark:text-[#0B1220]"
    >
      <Icon className={`h-4 w-4 shrink-0 ${tone === 'error' ? 'text-red-300 dark:text-red-700' : 'text-emerald-300 dark:text-emerald-700'}`} aria-hidden="true" />
      <span className="flex-1 min-w-0">{item.message}</span>
      {item.actionLabel && item.onAction && (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await item.onAction?.();
            } finally {
              onClose();
            }
          }}
          className="focus-ring shrink-0 rounded-md px-2 py-1 text-sm font-semibold text-blue-300 hover:bg-white/10 dark:text-blue-700 dark:hover:bg-black/5 cursor-pointer disabled:opacity-50"
        >
          {busy ? 'Aguarde…' : item.actionLabel}
        </button>
      )}
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar aviso"
        className="focus-ring shrink-0 rounded-md p-1 text-white/70 hover:bg-white/10 dark:text-black/60 cursor-pointer"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
};
