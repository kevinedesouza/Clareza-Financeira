import React from 'react';
import { InsightItem } from '../../lib/domain/types';
import { apiRequest } from '../../lib/api/client';
import { Button, StatusTag } from '../ui/Primitives';
import { PaginationBar, usePagination } from '../ui/Pagination';
import { Lightbulb, X } from 'lucide-react';

interface Props {
  insights: InsightItem[];
  onRefresh: () => Promise<void>;
  onNavigateTarget: (target: string) => void;
}

export const InsightsView: React.FC<Props> = ({ insights, onRefresh, onNavigateTarget }) => {
  const handleDismiss = async (id: string) => {
    await apiRequest(`/api/insights/${id}/dismiss`, { method: 'POST' });
    await onRefresh();
  };

  const insPg = usePagination(insights, undefined, 'insights');
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-[var(--color-text)]">Insights verificáveis</h2>
        <p className="text-xs text-[var(--color-text-secondary)]">
          Calculados de forma determinística no servidor a partir dos seus registros, com fórmula, período e evidências explícitas.
        </p>
      </div>

      {insights.length === 0 ? (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center">
          <Lightbulb className="mx-auto h-8 w-8 text-[var(--color-text-secondary)]" aria-hidden="true" />
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
            Importe mais períodos ou registre lançamentos para comparar seus gastos com segurança.
          </p>
        </div>
      ) : (
        <>
        <div className="space-y-4">
          {insights.map((ins) => (
            <article
              key={ins.id}
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 md:p-6 space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusTag
                    label={ins.severity === 'danger' ? 'Atenção imediata' : ins.severity === 'warning' ? 'Revisar' : 'Observação'}
                    tone={ins.severity === 'danger' ? 'expense' : ins.severity === 'warning' ? 'warning' : 'transfer'}
                  />
                  {ins.isEstimate && <StatusTag label="Estimativa" tone="neutral" />}
                  <span className="text-xs text-[var(--color-text-secondary)]">{ins.periodLabel}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleDismiss(ins.id)}
                  aria-label={`Dispensar insight: ${ins.title}`}
                  className="focus-ring inline-flex min-h-[36px] items-center gap-1 rounded-md px-2 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)] cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  Dispensar
                </button>
              </div>

              <h3 className="text-base font-semibold text-[var(--color-text)]">{ins.title}</h3>
              <p className="text-sm text-[var(--color-text)]">{ins.observation}</p>

              <div className="rounded-lg bg-[var(--color-surface-muted)] p-3 text-xs text-[var(--color-text-secondary)] space-y-1">
                <p>
                  <strong className="text-[var(--color-text)]">Cálculo:</strong> {ins.formula}
                </p>
                <p>
                  <strong className="text-[var(--color-text)]">Evidência:</strong> {ins.evidenceLabel}
                </p>
                <p>
                  <strong className="text-[var(--color-text)]">Limitação:</strong> {ins.confidenceNote}
                </p>
              </div>

              <div className="pt-1">
                <Button variant="secondary" onClick={() => onNavigateTarget(ins.actionTarget)}>
                  {ins.actionLabel}
                </Button>
              </div>
            </article>
          ))}
        </div>
        <PaginationBar page={insPg.page} totalPages={insPg.totalPages} totalItems={insPg.totalItems} pageSize={insPg.pageSize} setPage={insPg.setPage} label="insights" />
        </>
      )}
    </div>
  );
};
