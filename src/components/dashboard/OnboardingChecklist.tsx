import React, { useState } from 'react';
import { WorkspaceData } from '../../lib/domain/types';
import { readLockConfig } from '../../lib/security/appLock';
import { CheckCircle2, ChevronRight, Circle, X } from 'lucide-react';

const DISMISS_KEY = 'clareza-onboarding-dismissed';

interface Step {
  id: string;
  title: string;
  hint: string;
  done: boolean;
  target: string;
  filter?: { reviewPending?: boolean };
}

/** Guia de primeiros passos: some sozinho quando tudo estiver feito, ou quando a pessoa fechar. */
export const OnboardingChecklist: React.FC<{
  workspace: WorkspaceData;
  onNavigate: (tab: string, filter?: { reviewPending?: boolean }) => void;
}> = ({ workspace, onNavigate }) => {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });

  const liveMovements = workspace.movements.filter((m) => !m.isDeleted);
  const steps: Step[] = [
    {
      id: 'account',
      title: 'Cadastre sua conta bancária',
      hint: 'Com o saldo de hoje. Pode ser conta corrente, poupança ou carteira.',
      done: workspace.accounts.some((a) => !a.isArchived && a.type !== 'credit_card'),
      target: 'accounts',
    },
    {
      id: 'movements',
      title: 'Traga seus lançamentos',
      hint: 'Importe o extrato do banco (CSV/OFX) ou registre pelo botão "Adicionar".',
      done: liveMovements.length > 0,
      target: 'imports',
    },
    {
      id: 'review',
      title: 'Revise as categorias',
      hint: 'Confira os lançamentos marcados como pendentes para os relatórios ficarem certos.',
      done: liveMovements.length > 0 && !liveMovements.some((m) => m.reviewStatus !== 'reviewed'),
      target: 'transactions',
      filter: { reviewPending: true },
    },
    {
      id: 'budget',
      title: 'Defina um limite de gastos',
      hint: 'Escolha uma categoria (ex.: Alimentação) e quanto quer gastar no mês.',
      done: workspace.budgets.length > 0,
      target: 'planning',
    },
    {
      id: 'goal',
      title: 'Crie uma meta',
      hint: 'Ex.: reserva de emergência ou viagem. Acompanhe quanto falta.',
      done: workspace.goals.length > 0,
      target: 'planning',
    },
    {
      id: 'pin',
      title: 'Proteja o app com PIN (opcional)',
      hint: 'Pede um PIN quando o celular fica parado com o app aberto.',
      done: !!readLockConfig(),
      target: 'settings',
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  if (dismissed || doneCount === steps.length) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignora */
    }
  };

  return (
    <section aria-labelledby="onb-title" className="rounded-xl border border-[var(--color-primary)]/30 bg-[var(--color-primary-soft)] p-4 md:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="onb-title" className="text-base font-semibold text-[var(--color-text)]">
            Primeiros passos
          </h2>
          <p className="text-xs text-[var(--color-text-secondary)]">
            {doneCount} de {steps.length} concluídos
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Fechar guia de primeiros passos"
          title="Não mostrar mais"
          className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)] cursor-pointer"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface)]" aria-hidden="true">
        <div className="h-full bg-[var(--color-primary)]" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>
      <ol className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
        {steps.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onNavigate(s.target, s.filter)}
              className={`focus-ring flex w-full items-start gap-2.5 rounded-lg border p-3 text-left cursor-pointer ${
                s.done
                  ? 'border-transparent bg-[var(--color-surface)]/60'
                  : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-primary)]'
              }`}
            >
              {s.done ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-income)]" aria-label="Concluído" />
              ) : (
                <Circle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-text-secondary)]" aria-label="Pendente" />
              )}
              <span className="min-w-0 flex-1">
                <span className={`block text-sm font-medium ${s.done ? 'text-[var(--color-text-secondary)] line-through' : 'text-[var(--color-text)]'}`}>
                  {s.title}
                </span>
                {!s.done && <span className="mt-0.5 block text-xs text-[var(--color-text-secondary)]">{s.hint}</span>}
              </span>
              {!s.done && <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-primary)]" aria-hidden="true" />}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
};
