import React, { useState } from 'react';
import { CategorySpendItem } from '../../lib/domain/ledger';
import { formatBRL } from '../../lib/domain/money';
import { BarChart3, Table2 } from 'lucide-react';

interface Props {
  items: CategorySpendItem[];
  privacyMode: boolean;
  onSelectCategory?: (categoryId: string) => void;
}

const BAR_PALETTE = ['#2955D9', '#0F766E', '#6D28D9', '#0369A1', '#475569', '#B45309'];

export const CategorySpendingChart: React.FC<Props> = ({ items, privacyMode, onSelectCategory }) => {
  const [viewMode, setViewMode] = useState<'bars' | 'table'>('bars');
  const visible = items.slice(0, 6);
  const maxCents = Math.max(1, ...visible.map((i) => Math.abs(i.totalCents)));

  if (visible.length === 0) {
    return (
      <div className="flex h-52 items-center justify-center rounded-lg border border-dashed border-[var(--color-border)] text-sm text-[var(--color-text-secondary)]">
        Nenhum gasto por competência registrado neste período.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-[var(--color-text-secondary)]">
          Base: Por competência · líquidos de estorno
        </span>
        <button
          type="button"
          onClick={() => setViewMode((m) => (m === 'bars' ? 'table' : 'bars'))}
          className="focus-ring inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)] cursor-pointer"
        >
          {viewMode === 'bars' ? (
            <>
              <Table2 className="h-3.5 w-3.5" aria-hidden="true" />
              Tabela
            </>
          ) : (
            <>
              <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />
              Barras
            </>
          )}
        </button>
      </div>

      {viewMode === 'table' ? (
        <div className="max-h-60 overflow-auto rounded-lg border border-[var(--color-border)]">
          <table className="w-full text-left text-xs">
            <thead className="bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)]">
              <tr>
                <th className="px-3 py-2 font-medium">Categoria</th>
                <th className="px-3 py-2 font-medium text-right">Gasto</th>
                <th className="px-3 py-2 font-medium text-right">Comparação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {visible.map((item) => (
                <tr key={item.categoryId}>
                  <td className="px-3 py-2 text-[var(--color-text)]">{item.categoryName}</td>
                  <td className="px-3 py-2 text-right financial-value font-medium">
                    {formatBRL(item.totalCents, { masked: privacyMode })}
                  </td>
                  <td className="px-3 py-2 text-right financial-value text-[var(--color-text-secondary)]">
                    {item.deltaPct !== null
                      ? `${item.deltaPct > 0 ? '+' : ''}${item.deltaPct.toFixed(1)}%`
                      : 'Sem base'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((item, idx) => {
            const pctWidth = Math.max(4, Math.min(100, (Math.abs(item.totalCents) / maxCents) * 100));
            const color = BAR_PALETTE[idx % BAR_PALETTE.length];
            return (
              <button
                key={item.categoryId}
                type="button"
                onClick={() => onSelectCategory?.(item.categoryId)}
                className="focus-ring block w-full rounded-lg p-1.5 text-left transition-colors hover:bg-[var(--color-surface-muted)] cursor-pointer"
              >
                <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-[var(--color-text)] truncate">{item.categoryName}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="financial-value font-semibold text-[var(--color-text)]">
                      {formatBRL(item.totalCents, { masked: privacyMode })}
                    </span>
                    {item.deltaPct !== null && (
                      <span className="financial-value text-[11px] text-[var(--color-text-secondary)]">
                        {item.deltaPct > 0 ? `+${item.deltaPct.toFixed(0)}%` : `${item.deltaPct.toFixed(0)}%`}
                      </span>
                    )}
                  </div>
                </div>
                <div className="h-2 w-full rounded-sm bg-[var(--color-surface-muted)] overflow-hidden">
                  <div
                    className="h-full rounded-sm transition-all"
                    style={{ width: `${pctWidth}%`, backgroundColor: color }}
                  />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
