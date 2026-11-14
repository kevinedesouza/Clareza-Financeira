import React, { useState } from 'react';
import { CashEvolutionPoint } from '../../lib/domain/ledger';
import { formatBRL, formatCivilDateBR } from '../../lib/domain/money';
import { Table2, TrendingUp } from 'lucide-react';

interface Props {
  series: CashEvolutionPoint[];
  todayDate: string;
  privacyMode: boolean;
}

export const CashEvolutionChart: React.FC<Props> = ({ series, todayDate, privacyMode }) => {
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart');
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  if (series.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-[var(--color-border)] text-sm text-[var(--color-text-secondary)]">
        Sem movimentações suficientes para traçar a evolução de caixa no período.
      </div>
    );
  }

  // Amostragem limpa mantendo ponto de transição (todayDate) e último ponto
  const points =
    series.length > 24
      ? series.filter((p, i) => i % Math.ceil(series.length / 20) === 0 || i === series.length - 1 || (p.realizedCents !== null && p.projectedCents !== null))
      : series;
  const allVals = points.flatMap((p) => [p.realizedCents, p.projectedCents]).filter((v): v is number => v !== null);
  const rawMin = Math.min(...allVals);
  const rawMax = Math.max(...allVals);
  const padVal = Math.max(5000, Math.round((rawMax - rawMin) * 0.15));
  const minVal = rawMin - padVal;
  const maxVal = rawMax + padVal;
  const span = Math.max(1000, maxVal - minVal);

  const width = 680;
  const height = 220;
  const padL = 16;
  const padR = 16;
  const padT = 18;
  const padB = 28;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const xFor = (i: number) => padL + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const yFor = (val: number) => padT + innerH - ((val - minVal) / span) * innerH;

  const realizedPts = points
    .map((p, i) => (p.realizedCents !== null ? `${xFor(i).toFixed(1)},${yFor(p.realizedCents).toFixed(1)}` : null))
    .filter((v): v is string => v !== null);

  const projectedPts = points
    .map((p, i) => (p.projectedCents !== null ? `${xFor(i).toFixed(1)},${yFor(p.projectedCents).toFixed(1)}` : null))
    .filter((v): v is string => v !== null);

  const zeroY = yFor(0);
  const dividerIdx = points.findIndex((p) => p.date >= todayDate);
  const activePoint = selectedIdx !== null ? points[selectedIdx] : points[points.length - 1];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--color-text-secondary)]">
          <span className="inline-flex items-center gap-2">
            <span className="inline-block h-0.5 w-5 bg-[var(--color-primary)]" aria-hidden="true" />
            Realizado (caixa)
          </span>
          <span className="inline-flex items-center gap-2">
            <span
              className="inline-block h-0.5 w-5 border-t-2 border-dashed border-[var(--color-text-secondary)]"
              aria-hidden="true"
            />
            Projetado (estimativa)
          </span>
        </div>

        <button
          type="button"
          onClick={() => setViewMode((m) => (m === 'chart' ? 'table' : 'chart'))}
          className="focus-ring inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)] cursor-pointer"
        >
          {viewMode === 'chart' ? (
            <>
              <Table2 className="h-3.5 w-3.5" aria-hidden="true" />
              Tabela alternativa
            </>
          ) : (
            <>
              <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
              Ver gráfico
            </>
          )}
        </button>
      </div>

      {viewMode === 'table' ? (
        <div className="max-h-60 overflow-auto rounded-lg border border-[var(--color-border)]">
          <table className="w-full text-left text-xs">
            <thead className="bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)]">
              <tr>
                <th className="px-3 py-2 font-medium">Data</th>
                <th className="px-3 py-2 font-medium text-right">Realizado</th>
                <th className="px-3 py-2 font-medium text-right">Projetado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {points.map((pt) => (
                <tr key={pt.date}>
                  <td className="px-3 py-2 text-[var(--color-text)]">{formatCivilDateBR(pt.date)}</td>
                  <td className="px-3 py-2 text-right financial-value">
                    {pt.realizedCents !== null ? formatBRL(pt.realizedCents, { masked: privacyMode }) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right financial-value text-[var(--color-text-secondary)]">
                    {pt.projectedCents !== null ? formatBRL(pt.projectedCents, { masked: privacyMode }) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div>
          <div className="mb-2 flex items-center justify-between rounded-md bg-[var(--color-surface-muted)] px-3 py-1.5 text-xs">
            <span className="text-[var(--color-text-secondary)]">
              Ponto em foco: <strong className="text-[var(--color-text)]">{formatCivilDateBR(activePoint.date)}</strong>
            </span>
            <span className="financial-value font-semibold text-[var(--color-text)]">
              {activePoint.realizedCents !== null
                ? `Realizado: ${formatBRL(activePoint.realizedCents, { masked: privacyMode })}`
                : `Projetado: ${formatBRL(activePoint.projectedCents ?? 0, { masked: privacyMode })}`}
            </span>
          </div>

          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="h-52 w-full overflow-visible"
            role="img"
            aria-label="Gráfico de evolução do saldo de caixa realizado e projetado"
          >
            {/* Linha de referência zero */}
            {minVal <= 0 && maxVal >= 0 && (
              <line
                x1={padL}
                y1={zeroY}
                x2={width - padR}
                y2={zeroY}
                stroke="var(--color-border)"
                strokeWidth="1"
              />
            )}

            {/* Linha divisória da data de corte */}
            {dividerIdx >= 0 && (
              <g>
                <line
                  x1={xFor(dividerIdx)}
                  y1={padT}
                  x2={xFor(dividerIdx)}
                  y2={height - padB}
                  stroke="var(--color-control-border)"
                  strokeDasharray="3 3"
                  strokeWidth="1"
                />
                <text
                  x={xFor(dividerIdx)}
                  y={height - 8}
                  textAnchor="middle"
                  fontSize="10"
                  fill="var(--color-text-secondary)"
                >
                  Hoje
                </text>
              </g>
            )}

            {/* Linha projetada tracejada */}
            {projectedPts.length >= 2 && (
              <polyline
                fill="none"
                stroke="var(--color-text-secondary)"
                strokeWidth="2"
                strokeDasharray="5 5"
                points={projectedPts.join(' ')}
              />
            )}

            {/* Linha realizada contínua */}
            {realizedPts.length >= 2 && (
              <polyline
                fill="none"
                stroke="var(--color-primary)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={realizedPts.join(' ')}
              />
            )}

            {/* Pontos interativos acessíveis por toque e teclado */}
            {points.map((pt, idx) => {
              const val = pt.realizedCents ?? pt.projectedCents;
              if (val === null) return null;
              const cx = xFor(idx);
              const cy = yFor(val);
              const isSelected = selectedIdx === idx;
              return (
                <circle
                  key={pt.date}
                  cx={cx}
                  cy={cy}
                  r={isSelected ? 5.5 : 3.5}
                  fill={pt.realizedCents !== null ? 'var(--color-primary)' : 'var(--color-text-secondary)'}
                  stroke="var(--color-surface)"
                  strokeWidth="1.5"
                  tabIndex={0}
                  role="button"
                  aria-label={`${formatCivilDateBR(pt.date)}: ${formatBRL(val, { masked: privacyMode })}`}
                  className="cursor-pointer outline-none"
                  onFocus={() => setSelectedIdx(idx)}
                  onMouseEnter={() => setSelectedIdx(idx)}
                  onClick={() => setSelectedIdx(idx)}
                />
              );
            })}
          </svg>
        </div>
      )}
    </div>
  );
};
