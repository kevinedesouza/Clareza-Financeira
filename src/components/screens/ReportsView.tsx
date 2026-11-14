import React, { useState } from 'react';
import { WorkspaceData } from '../../lib/domain/types';
import { computeAccountBalance, computeDashboardMetrics } from '../../lib/domain/ledger';
import { formatCivilDateBR } from '../../lib/domain/money';
import { buildSafeCsvExport } from '../../lib/importers/csvParser';
import { Button, FinancialValue, StatusTag } from '../ui/Primitives';
import { Download, Printer } from 'lucide-react';

interface Props {
  workspace: WorkspaceData;
  periodStart: string;
  periodEnd: string;
  todayDate: string;
}

export const ReportsView: React.FC<Props> = ({ workspace, periodStart, periodEnd, todayDate }) => {
  const [basis, setBasis] = useState<'cash' | 'competence' | 'accounts' | 'projects'>('cash');
  const privacy = workspace.profile.privacyMode;

  const metrics = computeDashboardMetrics(workspace, {
    periodStart,
    periodEnd,
    todayDate,
  });

  const handleDownloadCsv = () => {
    const headers = ['Categoria', 'Gasto por Competência (centavos)', 'Anterior (centavos)', 'Variação %'];
    const rows = metrics.categorySpending.map((c) => [
      c.categoryName,
      c.totalCents,
      c.previousCents ?? 0,
      c.deltaPct !== null ? `${c.deltaPct.toFixed(1)}%` : 'Sem base',
    ]);
    const csv = buildSafeCsvExport(headers, rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clareza-relatorio-${periodStart}-${periodEnd}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const projectTotals = workspace.projects.map((p) => {
    const inc = workspace.events
      .filter((e) => !e.isDeleted && e.projectId === p.id && e.nature === 'income')
      .reduce((s, e) => s + e.magnitudeCents, 0);
    const exp = workspace.events
      .filter((e) => !e.isDeleted && e.projectId === p.id && e.nature === 'expense')
      .reduce((s, e) => s + e.magnitudeCents, 0);
    return { project: p, inc, exp, net: inc - exp };
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-text)]">Relatórios analíticos</h2>
          <p className="text-xs text-[var(--color-text-secondary)]">
            Período: {formatCivilDateBR(periodStart)} a {formatCivilDateBR(periodEnd)} · Resultado de caixa não equivale a lucro contábil.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={handleDownloadCsv}>
            <Download className="h-4 w-4" aria-hidden="true" />
            Exportar CSV
          </Button>
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer className="h-4 w-4" aria-hidden="true" />
            Imprimir / PDF
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg bg-[var(--color-surface-muted)] p-1 w-fit">
        {(
          [
            { id: 'cash', label: 'Caixa realizado' },
            { id: 'competence', label: 'Competência por categoria' },
            { id: 'accounts', label: 'Posição por conta' },
            { id: 'projects', label: 'Projetos' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setBasis(tab.id)}
            className={`min-h-[38px] rounded-md px-3 text-xs font-medium cursor-pointer ${
              basis === tab.id ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm' : 'text-[var(--color-text-secondary)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {basis === 'cash' && (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-[var(--color-text)]">Resumo de Caixa Realizado</h3>
            <StatusTag label="Base: Caixa realizado" tone="transfer" />
          </div>
          <div className="divide-y divide-[var(--color-border)] text-sm">
            <div className="flex justify-between py-3">
              <span>Receitas recebidas</span>
              <FinancialValue cents={metrics.incomeReceivedCents} privacyMode={privacy} showSign className="font-semibold text-[var(--color-income)]" />
            </div>
            <div className="flex justify-between py-3">
              <span>Despesas pagas (inclui fatura quitada uma vez; exclui transferências)</span>
              <FinancialValue cents={-metrics.expensesPaidCents} privacyMode={privacy} className="font-semibold" />
            </div>
            <div className="flex justify-between py-3 font-semibold">
              <span>Resultado operacional de caixa</span>
              <FinancialValue cents={metrics.operatingCashResultCents} privacyMode={privacy} showSign />
            </div>
            <div className="flex justify-between py-3 text-[var(--color-text-secondary)]">
              <span>Taxa de sobra operacional</span>
              <span>{metrics.savingsRatePct !== null ? `${metrics.savingsRatePct.toFixed(1)}%` : 'Sem base (receita zero)'}</span>
            </div>
            <div className="flex justify-between py-3 text-[var(--color-text-secondary)]">
              <span>Variação total da liquidez no período</span>
              <FinancialValue cents={metrics.liquidityDeltaCents} privacyMode={privacy} showSign />
            </div>
          </div>
        </div>
      )}

      {basis === 'competence' && (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-4">
            <h3 className="text-base font-semibold text-[var(--color-text)]">Consumo por Categoria</h3>
            <StatusTag label="Base: Por competência" tone="neutral" />
          </div>
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--color-surface-muted)] text-xs text-[var(--color-text-secondary)]">
              <tr>
                <th className="px-6 py-3 font-medium">Categoria</th>
                <th className="px-6 py-3 font-medium text-right">Atual</th>
                <th className="px-6 py-3 font-medium text-right">Período anterior</th>
                <th className="px-6 py-3 font-medium text-right">Variação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {metrics.categorySpending.map((c) => (
                <tr key={c.categoryId}>
                  <td className="px-6 py-3 font-medium">{c.categoryName}</td>
                  <td className="px-6 py-3 text-right">
                    <FinancialValue cents={c.totalCents} privacyMode={privacy} />
                  </td>
                  <td className="px-6 py-3 text-right text-[var(--color-text-secondary)]">
                    {c.previousCents !== null ? <FinancialValue cents={c.previousCents} privacyMode={privacy} /> : '—'}
                  </td>
                  <td className="px-6 py-3 text-right text-xs text-[var(--color-text-secondary)]">
                    {c.deltaPct !== null ? `${c.deltaPct > 0 ? '+' : ''}${c.deltaPct.toFixed(1)}%` : 'Sem base de comparação'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {basis === 'accounts' && (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--color-surface-muted)] text-xs text-[var(--color-text-secondary)]">
              <tr>
                <th className="px-6 py-3 font-medium">Conta</th>
                <th className="px-6 py-3 font-medium">Tipo</th>
                <th className="px-6 py-3 font-medium text-right">Saldo no corte</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {workspace.accounts.map((acc) => {
                const s = computeAccountBalance(acc, workspace.movements, workspace.reconciliations, periodEnd);
                return (
                  <tr key={acc.id}>
                    <td className="px-6 py-3 font-medium">{acc.name}</td>
                    <td className="px-6 py-3 text-xs text-[var(--color-text-secondary)]">{acc.type}</td>
                    <td className="px-6 py-3 text-right font-semibold">
                      <FinancialValue cents={s.balanceCents} privacyMode={privacy} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {basis === 'projects' && (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
          <h3 className="text-base font-semibold text-[var(--color-text)] mb-3">Resultado por projeto</h3>
          {projectTotals.length === 0 ? (
            <p className="text-sm text-[var(--color-text-secondary)]">Nenhum projeto atribuído a eventos.</p>
          ) : (
            <div className="divide-y divide-[var(--color-border)] text-sm">
              {projectTotals.map((pt) => (
                <div key={pt.project.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <span className="font-medium">{pt.project.name}</span>
                  <div className="flex gap-4 text-xs">
                    <span className="text-[var(--color-income)]">
                      Receitas: <FinancialValue cents={pt.inc} privacyMode={privacy} />
                    </span>
                    <span>
                      Despesas: <FinancialValue cents={pt.exp} privacyMode={privacy} />
                    </span>
                    <span className="font-semibold">
                      Saldo: <FinancialValue cents={pt.net} privacyMode={privacy} showSign />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="mt-4 text-xs text-[var(--color-text-secondary)]">
            ROI de investimentos permanece desativado até que haja registro explícito de capital aplicado e metodologia.
          </p>
        </div>
      )}
    </div>
  );
};
