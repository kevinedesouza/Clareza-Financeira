import React, { useEffect, useState } from 'react';
import { SupabaseDiagnostics } from '../../lib/domain/types';
import { apiRequest } from '../../lib/api/client';
import { Button, StatusTag } from '../ui/Primitives';
import { Check, Copy, Database, Download, X } from 'lucide-react';

interface Props {
  isOpen: boolean;
  supabaseStatus: SupabaseDiagnostics | null;
  onClose: () => void;
}

const SCHEMA_TABLES: Array<{ name: string; group: string; purpose: string }> = [
  { name: 'profiles', group: 'Identidade', purpose: 'Preferências do titular, moeda BRL, fuso e tema' },
  { name: 'accounts', group: 'Contas e Cartões', purpose: 'Contas bancárias, dinheiro, carteiras e passivo de cartão' },
  { name: 'cards', group: 'Contas e Cartões', purpose: 'Cartões de crédito, fechamento, vencimento e limite' },
  { name: 'categories', group: 'Classificação', purpose: 'Categorias de receita/despesa e essencialidade' },
  { name: 'projects', group: 'Classificação', purpose: 'Centros de custo / projetos pessoais' },
  { name: 'transfer_groups', group: 'Razão Financeiro', purpose: 'Agrupamento atômico de transferências (2 pernas)' },
  { name: 'financial_events', group: 'Razão Financeiro', purpose: 'Fatos geradores por competência e estornos' },
  { name: 'allocations', group: 'Razão Financeiro', purpose: 'Rateios por múltiplas categorias e projetos' },
  { name: 'account_movements', group: 'Razão Financeiro', purpose: 'Movimentos realizados em caixa (BIGINT em centavos)' },
  { name: 'recurrences', group: 'Agenda', purpose: 'Regras de recorrência semanal, mensal (dia 31) e anual' },
  { name: 'installment_plans', group: 'Cartões', purpose: 'Planos de compras parceladas no cartão' },
  { name: 'obligations', group: 'Agenda', purpose: 'Contas a pagar/receber, parcelas e faturas' },
  { name: 'settlements', group: 'Agenda', purpose: 'Liquidações parciais ou totais vinculadas a movimentos' },
  { name: 'import_profiles', group: 'Importação', purpose: 'Perfis de mapeamento CSV por banco' },
  { name: 'import_batches', group: 'Importação', purpose: 'Lotes CSV/OFX com hash SHA-256 e caminho no Storage' },
  { name: 'import_rows', group: 'Importação', purpose: 'Linhas em revisão com decisão de deduplicação' },
  { name: 'external_identities', group: 'Importação', purpose: 'Controle anti-duplicata por FITID/instituição/conta' },
  { name: 'source_links', group: 'Rastreabilidade', purpose: 'Vínculo entre lançamentos manuais e extratos' },
  { name: 'import_jobs', group: 'Importação', purpose: 'Fila durável para processamento assíncrono' },
  { name: 'reconciliations', group: 'Conciliação', purpose: 'Conferência por data de corte e divergências' },
  { name: 'budgets', group: 'Planejamento', purpose: 'Limites mensais por categoria (competência)' },
  { name: 'goals', group: 'Planejamento', purpose: 'Metas financeiras e reservas virtuais' },
  { name: 'goal_contributions', group: 'Planejamento', purpose: 'Histórico de aportes/resgates em metas' },
  { name: 'category_rules', group: 'Automação', purpose: 'Regras determinísticas de autocategorização' },
  { name: 'idempotency_records', group: 'Confiabilidade', purpose: 'Prevenção de duplicidade via X-Idempotency-Key' },
  { name: 'audit_logs', group: 'Auditoria', purpose: 'Trilha imutável de criações, edições e reversões' },
];

export const SupabaseSqlModal: React.FC<Props> = ({ isOpen, supabaseStatus, onClose }) => {
  const [tab, setTab] = useState<'tables' | 'sql'>('tables');
  const [sql, setSql] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setLoading(true);
    apiRequest<{ sql: string }>('/api/supabase/migration-sql')
      .then((res) => {
        if (active) setSql(res.sql || '');
      })
      .catch(() => {
        if (active) setSql('-- Não foi possível carregar o arquivo SQL.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCopy = async () => {
    if (!sql) return;
    try {
      await navigator.clipboard.writeText(sql);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = sql;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const handleDownloadSql = () => {
    if (!sql) return;
    const blob = new Blob([sql], { type: 'application/sql;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '0001_initial_schema.sql';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sb-sql-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Database className="h-5 w-5 text-[var(--color-primary)]" aria-hidden="true" />
            <div>
              <h2 id="sb-sql-title" className="text-base font-semibold text-[var(--color-text)]">
                Estrutura de tabelas e migração Supabase (PostgreSQL + RLS)
              </h2>
              <p className="text-xs text-[var(--color-text-secondary)]">
                26 tabelas com BIGINT em centavos, isolamento por owner_id e função transacional rpc_create_transfer
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar janela"
            className="focus-ring flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)] cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {supabaseStatus && !supabaseStatus.schemaApplied && (
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-warning-soft)] p-3.5 text-xs text-[var(--color-warning)] space-y-1.5">
              <p className="font-semibold">Por que as tabelas ainda não aparecem no seu Supabase?</p>
              {!supabaseStatus.authReachable ? (
                <p>
                  1) O domínio <strong>{supabaseStatus.projectHost}</strong> ainda respondeu com erro de conexão ({supabaseStatus.schemaError}). Ative o serviço Supabase no Coolify com certificado HTTPS válido.
                </p>
              ) : null}
              <p>
                {!supabaseStatus.authReachable ? '2) ' : ''}Copie ou baixe o script <span className="font-mono-ref">0001_initial_schema.sql</span> abaixo, abra o <strong>SQL Editor</strong> do seu Supabase e execute-o para criar todas as 26 tabelas, políticas RLS e RPCs.
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1 rounded-lg bg-[var(--color-surface-muted)] p-1 text-xs">
              <button
                type="button"
                onClick={() => setTab('tables')}
                className={`min-h-[34px] rounded-md px-3 font-medium cursor-pointer ${
                  tab === 'tables'
                    ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm'
                    : 'text-[var(--color-text-secondary)]'
                }`}
              >
                Tabelas ({SCHEMA_TABLES.length})
              </button>
              <button
                type="button"
                onClick={() => setTab('sql')}
                className={`min-h-[34px] rounded-md px-3 font-medium cursor-pointer ${
                  tab === 'sql'
                    ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm'
                    : 'text-[var(--color-text-secondary)]'
                }`}
              >
                Script SQL completo
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="md" onClick={handleCopy} disabled={!sql || loading}>
                {copied ? <Check className="h-4 w-4 text-[var(--color-income)]" /> : <Copy className="h-4 w-4" />}
                {copied ? 'SQL copiado!' : 'Copiar SQL'}
              </Button>
              <Button variant="primary" size="md" onClick={handleDownloadSql} disabled={!sql || loading}>
                <Download className="h-4 w-4" />
                Baixar .sql
              </Button>
            </div>
          </div>

          {tab === 'tables' ? (
            <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]">
              <table className="w-full text-left text-xs">
                <thead className="bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)]">
                  <tr>
                    <th className="px-3 py-2.5 font-semibold">Tabela (public)</th>
                    <th className="px-3 py-2.5 font-semibold">Domínio</th>
                    <th className="px-3 py-2.5 font-semibold">Finalidade</th>
                    <th className="px-3 py-2.5 font-semibold">Segurança</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {SCHEMA_TABLES.map((t) => (
                    <tr key={t.name} className="hover:bg-[var(--color-surface-muted)]/40">
                      <td className="px-3 py-2 font-mono-ref font-medium text-[var(--color-text)]">{t.name}</td>
                      <td className="px-3 py-2 text-[var(--color-text-secondary)]">{t.group}</td>
                      <td className="px-3 py-2 text-[var(--color-text)]">{t.purpose}</td>
                      <td className="px-3 py-2">
                        <StatusTag label="RLS owner_id" tone="income" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <pre className="max-h-[46vh] overflow-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4 font-mono-ref text-[11px] leading-relaxed text-[var(--color-text)]">
              {loading ? 'Carregando script SQL…' : sql}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
};
