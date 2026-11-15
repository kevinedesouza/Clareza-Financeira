import React from 'react';
import { MonthlyTrendPoint } from '../../lib/domain/analytics';
import { FinancialValue } from '../ui/Primitives';

const MONTH_NAMES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const monthLabel = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]}/${String(y).slice(2)}`;
};

/** Receitas e despesas por competência nos últimos meses, com tabela alternativa. */
export const MonthlyTrendChart: React.FC<{ points: MonthlyTrendPoint[]; privacyMode: boolean }> = ({ points, privacyMode }) => {
  const W = 720;
  const H = 240;
  const PAD_B = 28;
  const max = Math.max(1, ...points.flatMap((p) => [p.incomeCents, p.expenseCents]));
  const slot = W / Math.max(1, points.length);
  const barW = Math.min(18, slot * 0.32);
  const plotH = H - PAD_B - 8;
  const y = (v: number) => H - PAD_B - (v / max) * plotH;

  return (
    <div className="space-y-3">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Receitas e despesas por mês" className="w-full h-auto">
        <line x1="0" x2={W} y1={H - PAD_B} y2={H - PAD_B} stroke="var(--color-border)" />
        {points.map((p, i) => {
          const cx = slot * i + slot / 2;
          const incH = (p.incomeCents / max) * plotH;
          const expH = (p.expenseCents / max) * plotH;
          return (
            <g key={p.monthKey}>
              <rect x={cx - barW - 2} y={y(p.incomeCents)} width={barW} height={Math.max(0, incH)} rx="3" style={{ fill: 'var(--color-income)' }}>
                <title>{`${monthLabel(p.monthKey)} receitas: ${(p.incomeCents / 100).toFixed(2)}`}</title>
              </rect>
              <rect x={cx + 2} y={y(p.expenseCents)} width={barW} height={Math.max(0, expH)} rx="3" style={{ fill: 'var(--color-expense)' }}>
                <title>{`${monthLabel(p.monthKey)} despesas: ${(p.expenseCents / 100).toFixed(2)}`}</title>
              </rect>
              <text x={cx} y={H - 8} textAnchor="middle" fontSize="12" style={{ fill: 'var(--color-text-secondary)' }}>
                {monthLabel(p.monthKey)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap gap-4 text-xs text-[var(--color-text-secondary)]">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--color-income)' }} aria-hidden="true" /> Receitas
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--color-expense)' }} aria-hidden="true" /> Despesas
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">Valores mensais</caption>
          <thead className="text-[var(--color-text-secondary)] border-b border-[var(--color-border)]">
            <tr>
              <th className="py-2 pr-3 font-medium">Mês</th>
              <th className="py-2 pr-3 font-medium text-right">Receitas</th>
              <th className="py-2 pr-3 font-medium text-right">Despesas</th>
              <th className="py-2 pr-3 font-medium text-right">Resultado</th>
              <th className="py-2 font-medium text-right">Saldo no fim do mês</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {points.map((p) => (
              <tr key={p.monthKey}>
                <td className="py-2 pr-3">{monthLabel(p.monthKey)}</td>
                <td className="py-2 pr-3 text-right"><FinancialValue cents={p.incomeCents} privacyMode={privacyMode} /></td>
                <td className="py-2 pr-3 text-right"><FinancialValue cents={p.expenseCents} privacyMode={privacyMode} /></td>
                <td className="py-2 pr-3 text-right"><FinancialValue cents={p.resultCents} privacyMode={privacyMode} showSign /></td>
                <td className="py-2 text-right">
                  {p.liquidityEndCents === null ? (
                    <span className="text-[var(--color-warning)]">Não validado</span>
                  ) : (
                    <FinancialValue cents={p.liquidityEndCents} privacyMode={privacyMode} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
