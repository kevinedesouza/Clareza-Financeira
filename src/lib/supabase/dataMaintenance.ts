/**
 * Manutenção dos dados do próprio usuário (Configurações → Zona de perigo).
 * As duas operações apagam de verdade (não é a exclusão com "Desfazer") e só são
 * chamadas pelo servidor depois da confirmação de senha.
 *
 * Ordem importa por causa das chaves estrangeiras:
 * - settlements.movement_id é RESTRICT: liquidações saem antes dos lançamentos;
 * - source_links e external_identities caem em cascata com o lançamento;
 * - transfer_groups e audit_logs não podem ser apagados pelo usuário (sem permissão):
 *   usam o cliente de serviço, sempre filtrando por owner_id.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseEnv, sbAppendAudit } from './serverAdapter';

const CHUNK = 200;

function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function check(error: { message: string } | null | undefined, step: string) {
  if (error) throw new Error(`Falha ao apagar (${step}): ${error.message}`);
}

/**
 * Esvaziar lixeira: apaga de vez os lançamentos marcados como excluídos (e os eventos
 * que só eles usavam). Contas agendadas que eram quitadas por eles voltam a ficar em aberto.
 */
export async function sbPurgeDeletedMovements(
  sbUser: SupabaseClient,
  sbAdmin: SupabaseClient | null,
  ownerId: string
): Promise<{ removedMovements: number; removedEvents: number }> {
  const { data: deletedRows, error: selErr } = await sbUser
    .from('account_movements')
    .select('id')
    .eq('owner_id', ownerId)
    .eq('is_deleted', true);
  check(selErr, 'lançamentos excluídos');
  const ids = (deletedRows || []).map((r: { id: string }) => r.id);

  const touchedObligations = new Set<string>();
  for (const part of chunks(ids)) {
    const { data: sets } = await sbUser
      .from('settlements')
      .select('obligation_id')
      .eq('owner_id', ownerId)
      .in('movement_id', part);
    for (const s of sets || []) touchedObligations.add((s as { obligation_id: string }).obligation_id);
    const { error: e1 } = await sbUser.from('settlements').delete().eq('owner_id', ownerId).in('movement_id', part);
    check(e1, 'liquidações');
    const { error: e2 } = await sbUser.from('account_movements').delete().eq('owner_id', ownerId).in('id', part);
    check(e2, 'lançamentos');
  }

  // Contas agendadas que perderam a liquidação voltam a ficar em aberto
  for (const part of chunks(Array.from(touchedObligations))) {
    const { data: still } = await sbUser.from('settlements').select('obligation_id').eq('owner_id', ownerId).in('obligation_id', part);
    const paid = new Set((still || []).map((s: { obligation_id: string }) => s.obligation_id));
    const reopen = part.filter((id) => !paid.has(id));
    if (reopen.length > 0) {
      await sbUser
        .from('obligations')
        .update({ status: 'expected' })
        .eq('owner_id', ownerId)
        .in('id', reopen)
        .in('status', ['settled', 'partially_settled']);
    }
  }

  // Eventos marcados como excluídos que nenhum lançamento usa mais
  const { data: delEvents } = await sbUser.from('financial_events').select('id').eq('owner_id', ownerId).eq('is_deleted', true);
  const eventIds = (delEvents || []).map((r: { id: string }) => r.id);
  let removedEvents = 0;
  for (const part of chunks(eventIds)) {
    const { data: used } = await sbUser.from('account_movements').select('event_id').eq('owner_id', ownerId).in('event_id', part);
    const usedSet = new Set((used || []).map((u: { event_id: string }) => u.event_id));
    const free = part.filter((id) => !usedSet.has(id));
    if (free.length === 0) continue;
    const { error } = await sbUser.from('financial_events').delete().eq('owner_id', ownerId).in('id', free);
    check(error, 'eventos');
    removedEvents += free.length;
  }

  await sbAppendAudit(sbAdmin, ownerId, 'data', ownerId, 'purge_deleted', undefined, {
    removedMovements: ids.length,
    removedEvents,
  });
  return { removedMovements: ids.length, removedEvents };
}

export interface ResetOptions {
  /** Também apaga contas e cartões. */
  includeAccounts: boolean;
  /** Também apaga o histórico de auditoria. */
  includeAudit: boolean;
}

/** Tabelas apagadas no zeramento, na ordem segura. `admin` = exige cliente de serviço. */
export const RESET_ORDER: Array<{ table: string; admin?: boolean; when?: keyof ResetOptions }> = [
  { table: 'settlements' },
  { table: 'source_links' },
  { table: 'external_identities' },
  { table: 'goal_contributions' },
  { table: 'import_rows' },
  { table: 'import_jobs' },
  { table: 'import_batches' },
  { table: 'import_profiles' },
  { table: 'allocations' },
  { table: 'account_movements' },
  { table: 'financial_events' },
  { table: 'transfer_groups', admin: true },
  { table: 'obligations' },
  { table: 'installment_plans' },
  { table: 'recurrences' },
  { table: 'reconciliations' },
  { table: 'budgets' },
  { table: 'goals' },
  { table: 'category_rules' },
  { table: 'idempotency_records' },
  { table: 'cards', when: 'includeAccounts' },
  { table: 'accounts', when: 'includeAccounts' },
  { table: 'audit_logs', admin: true, when: 'includeAudit' },
];

/**
 * Apagar dados financeiros para recomeçar do zero. Mantém sempre perfil, login e categorias.
 * Remove também os extratos guardados no Storage.
 */
export async function sbResetFinancialData(
  sbUser: SupabaseClient,
  sbAdmin: SupabaseClient | null,
  ownerId: string,
  opts: ResetOptions
): Promise<{ status: number; payload: Record<string, unknown> }> {
  if (!sbAdmin) {
    return {
      status: 503,
      payload: {
        code: 'SERVICE_KEY_REQUIRED',
        message: 'Para apagar todos os dados o servidor precisa da chave de serviço do Supabase (SUPABASE_SERVICE_ROLE_KEY).',
      },
    };
  }

  // Extratos originais no Storage
  const { data: batches } = await sbUser.from('import_batches').select('storage_path').eq('owner_id', ownerId);
  const paths = (batches || [])
    .map((b: { storage_path: string | null }) => b.storage_path)
    .filter((p): p is string => Boolean(p));
  let removedFiles = 0;
  if (paths.length > 0) {
    const bucket = getSupabaseEnv().storageBucket;
    for (const part of chunks(paths, 100)) {
      const { error } = await sbAdmin.storage.from(bucket).remove(part);
      if (!error) removedFiles += part.length;
    }
  }

  const counts: Record<string, number> = {};
  for (const step of RESET_ORDER) {
    if (step.when && !opts[step.when]) continue;
    const client = step.admin ? sbAdmin : sbUser;
    const { error, count } = await client.from(step.table).delete({ count: 'exact' }).eq('owner_id', ownerId);
    check(error, step.table);
    counts[step.table] = count ?? 0;
  }

  // Um único registro da operação (mesmo quando a auditoria foi apagada) para rastreabilidade.
  await sbAppendAudit(sbAdmin, ownerId, 'data', ownerId, 'reset', undefined, {
    movements: counts.account_movements ?? 0,
    accounts: counts.accounts ?? 0,
    files: removedFiles,
    includeAccounts: opts.includeAccounts,
    includeAudit: opts.includeAudit,
  });

  return { status: 200, payload: { ok: true, removed: counts, removedFiles } };
}
