import crypto from 'node:crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  Account,
  AccountMovement,
  Allocation,
  AuditLog,
  Budget,
  Card,
  Category,
  CategoryRule,
  ExternalIdentity,
  FinancialEvent,
  Goal,
  GoalContribution,
  ImportBatch,
  ImportDecision,
  ImportProfile,
  ImportRow,
  InstallmentPlan,
  Obligation,
  Project,
  Reconciliation,
  Recurrence,
  Settlement,
  SourceLink,
  ThemeMode,
  TransferGroup,
  TransferNature,
  WorkspaceData,
} from '../domain/types';
import {
  computeAccountBalance,
  createDefaultCategories,
  generateRecurrenceDates,
} from '../domain/ledger';
import { splitInstallments, todayCivilSaoPaulo } from '../domain/money';
import { processImportPayload } from '../../../workers/importWorker';

export interface SupabaseEnvConfig {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  storageBucket: string;
  databaseUrl: string;
  configured: boolean;
  hasUrl: boolean;
  hasAnonKey: boolean;
  hasServiceRoleKey: boolean;
  hasDatabaseUrl: boolean;
}

export function getSupabaseEnv(): SupabaseEnvConfig {
  // Variáveis do servidor: SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY (VITE_* não é usado no servidor)
  const url = (process.env.SUPABASE_URL || '').trim();
  const anonKey = (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const storageBucket = (process.env.SUPABASE_STORAGE_BUCKET || 'clareza-extratos').trim();
  const databaseUrl = (process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || '').trim();

  const validUrl = Boolean(url && !url.includes('seu-projeto.supabase.co') && url.startsWith('http'));
  const validAnon = Boolean(anonKey && !anonKey.includes('sua-chave'));
  const validService = Boolean(serviceRoleKey && !serviceRoleKey.includes('sua-chave'));

  return {
    url,
    anonKey,
    serviceRoleKey,
    storageBucket,
    databaseUrl,
    configured: validUrl && validService && validAnon,
    hasUrl: validUrl,
    hasAnonKey: validAnon,
    hasServiceRoleKey: validService,
    hasDatabaseUrl: Boolean(databaseUrl),
  };
}

export function createSupabaseAdminClient(): SupabaseClient | null {
  const env = getSupabaseEnv();
  if (!env.hasUrl || !env.hasServiceRoleKey) return null;
  return createClient(env.url, env.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function createSupabaseAnonClient(): SupabaseClient | null {
  const env = getSupabaseEnv();
  if (!env.hasUrl || !env.hasAnonKey) return null;
  return createClient(env.url, env.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function createSupabaseUserClient(accessToken: string): SupabaseClient | null {
  const env = getSupabaseEnv();
  if (!env.hasUrl || !env.hasAnonKey || !accessToken) return null;
  return createClient(env.url, env.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

export interface SupabaseDiagnostics {
  configured: boolean;
  projectHost: string | null;
  keys: {
    url: boolean;
    anonKey: boolean;
    serviceRoleKey: boolean;
    databaseUrl: boolean;
  };
  authReachable: boolean;
  schemaApplied: boolean;
  schemaError: string | null;
  httpStatus?: number | null;
  storageBucketReady: boolean;
  storageBucketName: string;
}

export async function getSupabaseDiagnostics(): Promise<SupabaseDiagnostics> {
  const env = getSupabaseEnv();
  let projectHost: string | null = null;
  try {
    if (env.hasUrl) projectHost = new URL(env.url).host;
  } catch {
    projectHost = null;
  }

  const base: SupabaseDiagnostics = {
    configured: env.configured,
    projectHost,
    keys: {
      url: env.hasUrl,
      anonKey: env.hasAnonKey,
      serviceRoleKey: env.hasServiceRoleKey,
      databaseUrl: env.hasDatabaseUrl,
    },
    authReachable: false,
    schemaApplied: false,
    schemaError: null,
    httpStatus: null,
    storageBucketReady: false,
    storageBucketName: env.storageBucket,
  };

  const admin = createSupabaseAdminClient();
  if (!admin) return base;

  try {
    const res = await fetch(`${env.url.replace(/\/$/, '')}/auth/v1/health`, {
      headers: { apikey: env.anonKey || env.serviceRoleKey },
    });
    base.httpStatus = res.status;
    if (!res.ok) {
      base.authReachable = false;
      base.schemaError = `Servidor Supabase retornou HTTP ${res.status} (${res.statusText || 'Indisponível'}).`;
      return base;
    }
  } catch (err: any) {
    base.authReachable = false;
    const code = err?.cause?.code || '';
    const msg = err?.cause?.message || err?.message || 'Erro de rede';
    if (String(code).includes('SELF_SIGNED') || String(msg).includes('self-signed')) {
      base.schemaError = `Certificado TLS autoassinado ou serviço offline em ${projectHost} (${code || 'SELF_SIGNED_CERT'}).`;
    } else {
      base.schemaError = `Falha de conexão com ${projectHost}: ${msg}${code ? ` (${code})` : ''}`;
    }
    return base;
  }

  try {
    const { error: authErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
    base.authReachable = !authErr;
    if (authErr && !base.schemaError) {
      base.schemaError = `Auth: ${authErr.message}`;
    }
  } catch (err: any) {
    base.authReachable = false;
    const causeMsg = err?.cause ? `${err.cause.code || ''} ${err.cause.message || ''}`.trim() : '';
    base.schemaError = `Auth exception: ${err?.message || err}${causeMsg ? ` (${causeMsg})` : ''}`;
  }

  try {
    const { error: schemaErr } = await admin.from('profiles').select('id').limit(1);
    if (!schemaErr) {
      base.schemaApplied = true;
      base.schemaError = null;
    } else {
      base.schemaApplied = false;
      const details = (schemaErr as any).details || '';
      base.schemaError = schemaErr.code
        ? `${schemaErr.code}: ${schemaErr.message}${details ? ` (${details})` : ''}`
        : `${schemaErr.message}${details ? ` (${details})` : ''}`;
    }
  } catch (err: any) {
    base.schemaApplied = false;
    const causeMsg = err?.cause ? `${err.cause.code || ''} ${err.cause.message || ''}`.trim() : '';
    base.schemaError = `${err?.message || 'Erro ao verificar schema'}${causeMsg ? ` (${causeMsg})` : ''}`;
  }

  try {
    const { data: buckets, error: listErr } = await admin.storage.listBuckets();
    if (!listErr && buckets) {
      const exists = buckets.some((b) => b.name === env.storageBucket);
      if (exists) {
        base.storageBucketReady = true;
      } else {
        const { error: createErr } = await admin.storage.createBucket(env.storageBucket, {
          public: false,
          fileSizeLimit: 20971520,
        });
        base.storageBucketReady = !createErr;
      }
    }
  } catch {
    base.storageBucketReady = false;
  }

  return base;
}

export async function ensureSupabaseUserProfile(
  sbUser: SupabaseClient,
  userId: string,
  email: string,
  displayName?: string
): Promise<void> {
  const { data: existingProfile, error: profErr } = await sbUser
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle();

  if (profErr) {
    throw new Error(`Falha ao verificar perfil no Supabase: ${profErr.message}`);
  }

  if (!existingProfile) {
    const { error: insErr } = await sbUser.from('profiles').insert({
      id: userId,
      display_name: (displayName || email.split('@')[0] || 'Titular').trim(),
      currency: 'BRL',
      timezone: 'America/Sao_Paulo',
      theme: 'system',
      privacy_mode: false,
    });
    if (insErr && insErr.code !== '23505') {
      throw new Error(`Falha ao criar perfil: ${insErr.message}`);
    }
  }

  const { data: existingCats } = await sbUser
    .from('categories')
    .select('id')
    .eq('owner_id', userId)
    .limit(1);

  if (!existingCats || existingCats.length === 0) {
    const defaults = createDefaultCategories(userId).map((c) => ({
      owner_id: userId,
      name: c.name,
      kind: c.kind,
      essentiality: c.essentiality,
      is_archived: false,
    }));
    await sbUser.from('categories').insert(defaults);
  }
}

export async function sbAppendAudit(
  sbAdmin: SupabaseClient | null,
  ownerId: string,
  entityType: string,
  entityId: string,
  action: string,
  reason?: string,
  metadata?: Record<string, string | number | boolean>
): Promise<void> {
  if (!sbAdmin) return;
  await sbAdmin.from('audit_logs').insert({
    owner_id: ownerId,
    entity_type: entityType,
    entity_id: entityId,
    action,
    reason: reason || null,
    metadata: metadata || {},
  });
}

export async function sbCheckIdempotency(
  sbUser: SupabaseClient,
  ownerId: string,
  operationKey?: string | null
): Promise<unknown | null> {
  if (!operationKey) return null;
  const { data } = await sbUser
    .from('idempotency_records')
    .select('response_payload')
    .eq('owner_id', ownerId)
    .eq('operation_key', operationKey)
    .maybeSingle();
  return data?.response_payload ?? null;
}

export async function sbRecordIdempotency(
  sbUser: SupabaseClient,
  ownerId: string,
  operationKey: string | null | undefined,
  endpoint: string,
  payload: unknown
): Promise<void> {
  if (!operationKey) return;
  await sbUser.from('idempotency_records').upsert(
    {
      owner_id: ownerId,
      operation_key: operationKey,
      endpoint,
      response_payload: payload,
    },
    { onConflict: 'owner_id,operation_key', ignoreDuplicates: true }
  );
}

// Mappers SQL (snake_case) -> Domínio (camelCase)
function mapAccount(r: Record<string, any>): Account {
  return {
    id: r.id,
    ownerId: r.owner_id,
    name: r.name,
    institution: r.institution || undefined,
    type: r.type,
    currency: 'BRL',
    maskedIdentifier: r.masked_identifier || undefined,
    color: r.color || '#2955D9',
    openingBalanceCents: Number(r.opening_balance_cents || 0),
    openingDate: r.opening_date,
    openingBalanceKnown: Boolean(r.opening_balance_known),
    includeInLiquidity: Boolean(r.include_in_liquidity),
    isArchived: Boolean(r.is_archived),
    version: Number(r.version || 1),
  };
}

function mapCard(r: Record<string, any>): Card {
  return {
    id: r.id,
    ownerId: r.owner_id,
    accountId: r.account_id,
    name: r.name,
    maskedLast4: r.masked_last4 || undefined,
    creditLimitCents: Number(r.credit_limit_cents || 0),
    limitVerified: Boolean(r.limit_verified),
    closingDay: Number(r.closing_day),
    dueDay: Number(r.due_day),
    payingAccountId: r.paying_account_id || undefined,
    isArchived: Boolean(r.is_archived),
    version: Number(r.version || 1),
  };
}

function mapCategory(r: Record<string, any>): Category {
  return {
    id: r.id,
    ownerId: r.owner_id,
    parentId: r.parent_id || undefined,
    name: r.name,
    kind: r.kind,
    essentiality: r.essentiality,
    isArchived: Boolean(r.is_archived),
  };
}

function mapMovement(r: Record<string, any>): AccountMovement {
  return {
    id: r.id,
    ownerId: r.owner_id,
    accountId: r.account_id,
    eventId: r.event_id || undefined,
    transferGroupId: r.transfer_group_id || undefined,
    signedCents: Number(r.signed_cents),
    effectiveDate: r.effective_date,
    description: r.description,
    origin: r.origin,
    reviewStatus: r.review_status,
    reconciliationStatus: r.reconciliation_status,
    reconciliationId: r.reconciliation_id || undefined,
    isDeleted: Boolean(r.is_deleted),
    version: Number(r.version || 1),
    createdAt: r.created_at,
  };
}

function mapEvent(r: Record<string, any>, allocsByEvent: Map<string, Allocation[]>): FinancialEvent {
  const allocs = allocsByEvent.get(r.id);
  return {
    id: r.id,
    ownerId: r.owner_id,
    nature: r.nature,
    description: r.description,
    competenceDate: r.competence_date,
    magnitudeCents: Number(r.magnitude_cents),
    currency: 'BRL',
    categoryId: r.category_id || undefined,
    projectId: r.project_id || undefined,
    tags: Array.isArray(r.tags) ? r.tags : [],
    refundOfEventId: r.refund_of_event_id || undefined,
    allocations: allocs && allocs.length > 0 ? allocs : undefined,
    notes: r.notes || undefined,
    isDeleted: Boolean(r.is_deleted),
    deletedReason: r.deleted_reason || undefined,
    version: Number(r.version || 1),
  };
}

function mapImportRow(r: Record<string, any>): ImportRow {
  const rawPayload = (r.raw_payload && typeof r.raw_payload === 'object' ? { ...r.raw_payload } : {}) as Record<string, string>;
  const candidateReason = rawPayload.__candidateReason || undefined;
  if ('__candidateReason' in rawPayload) {
    delete rawPayload.__candidateReason;
  }
  return {
    id: r.id,
    batchId: r.batch_id,
    rowIndex: Number(r.row_index),
    rawPayload,
    normalizedDate: r.normalized_date || undefined,
    normalizedDescription: r.normalized_description || undefined,
    normalizedCents: r.normalized_cents !== null && r.normalized_cents !== undefined ? Number(r.normalized_cents) : undefined,
    externalFitid: r.external_fitid || undefined,
    externalInstitution: r.external_institution || undefined,
    externalAccount: r.external_account || undefined,
    suggestedCategoryId: r.suggested_category_id || undefined,
    candidateMovementId: r.candidate_movement_id || undefined,
    candidateReason,
    decision: r.decision,
    validationErrors: Array.isArray(r.validation_errors) ? r.validation_errors : [],
    createdMovementId: r.created_movement_id || undefined,
  };
}

function mapImportBatch(r: Record<string, any>, rows: ImportRow[]): ImportBatch {
  return {
    id: r.id,
    ownerId: r.owner_id,
    accountId: r.account_id,
    fileName: r.file_name,
    fileSizeBytes: Number(r.file_size_bytes),
    fileHash: r.file_hash,
    format: r.format,
    parserVersion: r.parser_version || '2.0.0',
    status: r.status,
    totalRows: Number(r.total_rows || 0),
    validRows: Number(r.valid_rows || 0),
    linkedRows: Number(r.linked_rows || 0),
    ignoredRows: Number(r.ignored_rows || 0),
    rejectedRows: Number(r.rejected_rows || 0),
    errorMessage: r.error_message || undefined,
    rows,
    createdAt: r.created_at,
    committedAt: r.committed_at || undefined,
  };
}

export async function loadWorkspaceFromSupabase(
  sbUser: SupabaseClient,
  userId: string,
  userEmail: string,
  displayNameFallback?: string
): Promise<WorkspaceData> {
  await ensureSupabaseUserProfile(sbUser, userId, userEmail, displayNameFallback);

  const [
    profRes,
    accRes,
    cardRes,
    catRes,
    projRes,
    evRes,
    allocRes,
    movRes,
    tgRes,
    recRes,
    instRes,
    obRes,
    setRes,
    batchRes,
    rowRes,
    extRes,
    linkRes,
    impProfRes,
    reconRes,
    budRes,
    goalRes,
    gcRes,
    ruleRes,
    auditRes,
  ] = await Promise.all([
    sbUser.from('profiles').select('*').eq('id', userId).single(),
    sbUser.from('accounts').select('*').order('created_at', { ascending: true }),
    sbUser.from('cards').select('*').order('created_at', { ascending: true }),
    sbUser.from('categories').select('*').order('created_at', { ascending: true }),
    sbUser.from('projects').select('*').order('created_at', { ascending: true }),
    sbUser.from('financial_events').select('*').eq('is_deleted', false).order('competence_date', { ascending: true }),
    sbUser.from('allocations').select('*'),
    sbUser.from('account_movements').select('*').eq('is_deleted', false).order('effective_date', { ascending: true }),
    sbUser.from('transfer_groups').select('*').order('effective_date', { ascending: true }),
    sbUser.from('recurrences').select('*').order('created_at', { ascending: true }),
    sbUser.from('installment_plans').select('*').order('purchase_date', { ascending: true }),
    sbUser.from('obligations').select('*').order('due_date', { ascending: true }),
    sbUser.from('settlements').select('*').order('created_at', { ascending: true }),
    sbUser.from('import_batches').select('*').order('created_at', { ascending: false }),
    sbUser.from('import_rows').select('*').order('row_index', { ascending: true }),
    sbUser.from('external_identities').select('*'),
    sbUser.from('source_links').select('*'),
    sbUser.from('import_profiles').select('*'),
    sbUser.from('reconciliations').select('*').order('created_at', { ascending: false }),
    sbUser.from('budgets').select('*'),
    sbUser.from('goals').select('*').order('created_at', { ascending: true }),
    sbUser.from('goal_contributions').select('*').order('contribution_date', { ascending: false }),
    sbUser.from('category_rules').select('*').order('priority', { ascending: true }),
    sbUser.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(500),
  ]);

  if (profRes.error) throw new Error(`Erro ao carregar perfil: ${profRes.error.message}`);

  const allocsByEvent = new Map<string, Allocation[]>();
  for (const a of allocRes.data || []) {
    const arr = allocsByEvent.get(a.event_id) || [];
    arr.push({
      id: a.id,
      eventId: a.event_id,
      categoryId: a.category_id || undefined,
      projectId: a.project_id || undefined,
      amountCents: Number(a.amount_cents),
    });
    allocsByEvent.set(a.event_id, arr);
  }

  const rowsByBatch = new Map<string, ImportRow[]>();
  for (const r of rowRes.data || []) {
    const arr = rowsByBatch.get(r.batch_id) || [];
    arr.push(mapImportRow(r));
    rowsByBatch.set(r.batch_id, arr);
  }

  const auditLogs: AuditLog[] = [];
  const dismissedInsightIds: string[] = [];
  for (const l of auditRes.data || []) {
    if (l.entity_type === 'insight_preference' && l.action === 'dismiss' && l.metadata?.insightId) {
      const id = String(l.metadata.insightId);
      if (!dismissedInsightIds.includes(id)) dismissedInsightIds.push(id);
      continue;
    }
    auditLogs.push({
      id: l.id,
      ownerId: l.owner_id,
      entityType: l.entity_type,
      entityId: l.entity_id,
      action: l.action,
      reason: l.reason || undefined,
      metadata: l.metadata || undefined,
      createdAt: l.created_at,
    });
  }

  const prof = profRes.data;

  return {
    profile: {
      id: prof.id,
      email: userEmail,
      displayName: prof.display_name,
      currency: 'BRL',
      timezone: 'America/Sao_Paulo',
      theme: prof.theme as ThemeMode,
      privacyMode: Boolean(prof.privacy_mode),
    },
    accounts: (accRes.data || []).map(mapAccount),
    cards: (cardRes.data || []).map(mapCard),
    categories: (catRes.data || []).map(mapCategory),
    projects: (projRes.data || []).map((p: any): Project => ({
      id: p.id,
      ownerId: p.owner_id,
      name: p.name,
      isArchived: Boolean(p.is_archived),
    })),
    events: (evRes.data || []).map((e: any) => mapEvent(e, allocsByEvent)),
    movements: (movRes.data || []).map(mapMovement),
    transferGroups: (tgRes.data || []).map((t: any): TransferGroup => ({
      id: t.id,
      ownerId: t.owner_id,
      nature: t.nature,
      fromAccountId: t.from_account_id,
      toAccountId: t.to_account_id,
      amountCents: Number(t.amount_cents),
      effectiveDate: t.effective_date,
      description: t.description,
    })),
    recurrences: (recRes.data || []).map((r: any): Recurrence => ({
      id: r.id,
      ownerId: r.owner_id,
      direction: r.direction,
      description: r.description,
      amountCents: Number(r.amount_cents),
      frequency: r.frequency,
      anchorDay: Number(r.anchor_day),
      startDate: r.start_date,
      endDate: r.end_date || undefined,
      accountId: r.account_id || undefined,
      categoryId: r.category_id || undefined,
      isActive: Boolean(r.is_active),
    })),
    installmentPlans: (instRes.data || []).map((p: any): InstallmentPlan => ({
      id: p.id,
      ownerId: p.owner_id,
      cardId: p.card_id || undefined,
      description: p.description,
      totalContractedCents: Number(p.total_contracted_cents),
      installmentCount: Number(p.installment_count),
      purchaseDate: p.purchase_date,
      categoryId: p.category_id || undefined,
    })),
    obligations: (obRes.data || []).map((o: any): Obligation => ({
      id: o.id,
      ownerId: o.owner_id,
      direction: o.direction,
      description: o.description,
      dueDate: o.due_date,
      competenceDate: o.competence_date,
      originalCents: Number(o.original_cents),
      canceledCents: Number(o.canceled_cents || 0),
      status: o.status,
      accountId: o.account_id || undefined,
      cardId: o.card_id || undefined,
      categoryId: o.category_id || undefined,
      recurrenceId: o.recurrence_id || undefined,
      installmentPlanId: o.installment_plan_id || undefined,
      installmentIndex: o.installment_index !== null && o.installment_index !== undefined ? Number(o.installment_index) : undefined,
      version: Number(o.version || 1),
    })),
    settlements: (setRes.data || []).map((s: any): Settlement => ({
      id: s.id,
      ownerId: s.owner_id,
      obligationId: s.obligation_id,
      movementId: s.movement_id,
      allocatedCents: Number(s.allocated_cents),
      createdAt: s.created_at,
    })),
    importBatches: (batchRes.data || []).map((b: any) => mapImportBatch(b, rowsByBatch.get(b.id) || [])),
    externalIdentities: (extRes.data || []).map((e: any): ExternalIdentity => ({
      id: e.id,
      ownerId: e.owner_id,
      accountId: e.account_id,
      institutionKey: e.institution_key,
      accountKey: e.account_key,
      fitid: e.fitid,
      movementId: e.movement_id,
      effectiveDate: e.effective_date,
      signedCents: Number(e.signed_cents),
    })),
    sourceLinks: (linkRes.data || []).map((l: any): SourceLink => ({
      id: l.id,
      ownerId: l.owner_id,
      movementId: l.movement_id,
      batchId: l.batch_id || undefined,
      importRowId: l.import_row_id || undefined,
      sourceKind: l.source_kind,
      createdAt: l.created_at,
    })),
    importProfiles: (impProfRes.data || []).map((p: any): ImportProfile => ({
      id: p.id,
      ownerId: p.owner_id,
      name: p.name,
      bankSignature: p.bank_signature,
      delimiter: p.delimiter,
      encoding: p.encoding,
      dateFormat: p.date_format,
      decimalSeparator: p.decimal_separator,
      columnMap: p.column_map,
    })),
    reconciliations: (reconRes.data || []).map((r: any): Reconciliation => ({
      id: r.id,
      ownerId: r.owner_id,
      accountId: r.account_id,
      cutoffDate: r.cutoff_date,
      reportedBalanceCents: Number(r.reported_balance_cents),
      calculatedBalanceCents: Number(r.calculated_balance_cents),
      differenceCents: Number(r.difference_cents),
      status: r.status,
      invalidationReason: r.invalidation_reason || undefined,
      createdAt: r.created_at,
    })),
    budgets: (budRes.data || []).map((b: any): Budget => ({
      id: b.id,
      ownerId: b.owner_id,
      monthKey: b.month_key,
      categoryId: b.category_id,
      limitCents: Number(b.limit_cents),
      alertThresholdPct: Number(b.alert_threshold_pct),
      version: Number(b.version || 1),
    })),
    goals: (goalRes.data || []).map((g: any): Goal => ({
      id: g.id,
      ownerId: g.owner_id,
      name: g.name,
      targetCents: Number(g.target_cents),
      reservedCents: Number(g.reserved_cents || 0),
      deadlineDate: g.deadline_date || undefined,
      version: Number(g.version || 1),
    })),
    goalContributions: (gcRes.data || []).map((c: any): GoalContribution => ({
      id: c.id,
      ownerId: c.owner_id,
      goalId: c.goal_id,
      amountCents: Number(c.amount_cents),
      contributionDate: c.contribution_date,
      linkedMovementId: c.linked_movement_id || undefined,
      note: c.note || undefined,
    })),
    categoryRules: (ruleRes.data || []).map((r: any): CategoryRule => ({
      id: r.id,
      ownerId: r.owner_id,
      priority: Number(r.priority),
      matchText: r.match_text,
      accountId: r.account_id || undefined,
      targetCategoryId: r.target_category_id,
      isActive: Boolean(r.is_active),
    })),
    auditLogs,
    dismissedInsightIds,
  };
}

export async function sbUpdateProfile(
  sbUser: SupabaseClient,
  userId: string,
  userEmail: string,
  body: { displayName?: string; theme?: ThemeMode; privacyMode?: boolean }
) {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.displayName === 'string' && body.displayName.trim()) {
    patch.display_name = body.displayName.trim();
  }
  if (body.theme === 'light' || body.theme === 'dark' || body.theme === 'system') {
    patch.theme = body.theme;
  }
  if (typeof body.privacyMode === 'boolean') {
    patch.privacy_mode = body.privacyMode;
  }
  const { data, error } = await sbUser
    .from('profiles')
    .update(patch)
    .eq('id', userId)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return {
    id: data.id,
    email: userEmail,
    displayName: data.display_name,
    currency: 'BRL' as const,
    timezone: 'America/Sao_Paulo' as const,
    theme: data.theme as ThemeMode,
    privacyMode: Boolean(data.privacy_mode),
  };
}

export async function sbCreateAccount(
  sbUser: SupabaseClient,
  sbAdmin: SupabaseClient | null,
  ownerId: string,
  body: Record<string, any>
): Promise<Account> {
  const type = body.type || 'checking';
  const includeInLiquidity =
    type === 'credit_card' || type === 'investment_manual' ? false : body.includeInLiquidity !== false;
  const { data, error } = await sbUser
    .from('accounts')
    .insert({
      owner_id: ownerId,
      name: String(body.name).trim(),
      institution: body.institution?.trim() || null,
      type,
      currency: 'BRL',
      masked_identifier: body.maskedIdentifier?.trim() || null,
      color: body.color || '#2955D9',
      opening_balance_cents: Number.isInteger(body.openingBalanceCents) ? body.openingBalanceCents : 0,
      opening_date: body.openingDate || todayCivilSaoPaulo(),
      opening_balance_known: body.openingBalanceKnown !== false,
      include_in_liquidity: includeInLiquidity,
      is_archived: false,
      version: 1,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  const acc = mapAccount(data);
  await sbAppendAudit(sbAdmin, ownerId, 'account', acc.id, 'create', undefined, { name: acc.name });
  return acc;
}

export async function sbUpdateAccount(
  sbUser: SupabaseClient,
  sbAdmin: SupabaseClient | null,
  ownerId: string,
  accountId: string,
  body: Record<string, any>
): Promise<{ status: number; account?: Account; code?: string; message?: string }> {
  const { data: existing, error: getErr } = await sbUser
    .from('accounts')
    .select('*')
    .eq('id', accountId)
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (getErr || !existing) {
    return { status: 404, code: 'NOT_FOUND', message: 'Conta não encontrada.' };
  }
  if (typeof body.expectedVersion === 'number' && body.expectedVersion !== Number(existing.version)) {
    return {
      status: 409,
      code: 'VERSION_CONFLICT',
      message: 'Esta conta foi alterada em outro dispositivo. Recarregue para revisar.',
    };
  }
  const patch: Record<string, unknown> = {
    version: Number(existing.version) + 1,
    updated_at: new Date().toISOString(),
  };
  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.isArchived === 'boolean') patch.is_archived = body.isArchived;
  if (typeof body.openingBalanceKnown === 'boolean') patch.opening_balance_known = body.openingBalanceKnown;
  if (Number.isInteger(body.openingBalanceCents)) patch.opening_balance_cents = body.openingBalanceCents;
  if (typeof body.openingDate === 'string') patch.opening_date = body.openingDate;

  const { data: updated, error: updErr } = await sbUser
    .from('accounts')
    .update(patch)
    .eq('id', accountId)
    .eq('owner_id', ownerId)
    .select('*')
    .single();
  if (updErr) throw new Error(updErr.message);

  await sbAppendAudit(sbAdmin, ownerId, 'account', accountId, 'update');
  return { status: 200, account: mapAccount(updated) };
}

export async function sbCreateEventAndMovement(
  sbUser: SupabaseClient,
  sbAdmin: SupabaseClient | null,
  ownerId: string,
  body: Record<string, any>
): Promise<{ status: number; payload?: { event: FinancialEvent; movement: AccountMovement }; code?: string; message?: string }> {
  const {
    nature,
    description,
    competenceDate,
    effectiveDate,
    magnitudeCents,
    accountId,
    categoryId,
    projectId,
    tags,
    allocations,
    notes,
  } = body;

  const { data: acc } = await sbUser
    .from('accounts')
    .select('id, is_archived')
    .eq('id', accountId)
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (!acc || acc.is_archived) {
    return { status: 400, code: 'INVALID_ACCOUNT', message: 'Conta selecionada é inválida.' };
  }

  if (Array.isArray(allocations) && allocations.length > 0) {
    const sum = allocations.reduce((s: number, a: { amountCents: number }) => s + (a.amountCents || 0), 0);
    if (sum !== magnitudeCents) {
      return {
        status: 400,
        code: 'ALLOCATION_MISMATCH',
        message: 'Os rateios devem somar exatamente o valor total do lançamento.',
      };
    }
  }

  const resolvedNature = nature === 'income' || nature === 'refund' ? nature : 'expense';
  const signedCents = resolvedNature === 'income' || resolvedNature === 'refund' ? magnitudeCents : -magnitudeCents;
  const compDate = competenceDate || effectiveDate || todayCivilSaoPaulo();
  const effDate = effectiveDate || compDate;

  const { data: evRow, error: evErr } = await sbUser
    .from('financial_events')
    .insert({
      owner_id: ownerId,
      nature: resolvedNature,
      description: String(description).trim(),
      competence_date: compDate,
      magnitude_cents: magnitudeCents,
      currency: 'BRL',
      category_id: categoryId || null,
      project_id: projectId || null,
      tags: Array.isArray(tags) ? tags : [],
      notes: notes || null,
      is_deleted: false,
      version: 1,
    })
    .select('*')
    .single();
  if (evErr) throw new Error(evErr.message);

  let createdAllocs: Allocation[] | undefined;
  if (Array.isArray(allocations) && allocations.length > 0) {
    const { data: allocRows, error: alErr } = await sbUser
      .from('allocations')
      .insert(
        allocations.map((a: { categoryId?: string; projectId?: string; amountCents: number }) => ({
          owner_id: ownerId,
          event_id: evRow.id,
          category_id: a.categoryId || null,
          project_id: a.projectId || null,
          amount_cents: a.amountCents,
        }))
      )
      .select('*');
    if (alErr) throw new Error(alErr.message);
    createdAllocs = (allocRows || []).map((a: any) => ({
      id: a.id,
      eventId: a.event_id,
      categoryId: a.category_id || undefined,
      projectId: a.project_id || undefined,
      amountCents: Number(a.amount_cents),
    }));
  }

  const reviewStatus = categoryId || (allocations && allocations.length > 0) ? 'reviewed' : 'pending_category';
  const { data: movRow, error: movErr } = await sbUser
    .from('account_movements')
    .insert({
      owner_id: ownerId,
      account_id: acc.id,
      event_id: evRow.id,
      signed_cents: signedCents,
      effective_date: effDate,
      description: evRow.description,
      origin: 'manual',
      review_status: reviewStatus,
      reconciliation_status: 'unreconciled',
      is_deleted: false,
      version: 1,
    })
    .select('*')
    .single();
  if (movErr) throw new Error(movErr.message);

  await sbUser.from('source_links').insert({
    owner_id: ownerId,
    movement_id: movRow.id,
    source_kind: 'manual',
  });

  await sbAppendAudit(sbAdmin, ownerId, 'movement', movRow.id, 'create_manual', undefined, { signedCents });

  const allocMap = new Map<string, Allocation[]>();
  if (createdAllocs) allocMap.set(evRow.id, createdAllocs);

  return {
    status: 201,
    payload: {
      event: mapEvent(evRow, allocMap),
      movement: mapMovement(movRow),
    },
  };
}

export async function sbUpdateMovement(
  sbUser: SupabaseClient,
  sbAdmin: SupabaseClient | null,
  ownerId: string,
  movId: string,
  body: Record<string, any>
): Promise<{ status: number; payload?: { movement: AccountMovement; event?: FinancialEvent }; code?: string; message?: string }> {
  const { data: movRow } = await sbUser
    .from('account_movements')
    .select('*')
    .eq('id', movId)
    .eq('owner_id', ownerId)
    .eq('is_deleted', false)
    .maybeSingle();

  if (!movRow) {
    return { status: 404, code: 'NOT_FOUND', message: 'Lançamento não encontrado.' };
  }
  if (typeof body.expectedVersion === 'number' && body.expectedVersion !== Number(movRow.version)) {
    return {
      status: 409,
      code: 'VERSION_CONFLICT',
      message: 'Este lançamento foi alterado em outro dispositivo. Recarregue para revisar.',
    };
  }

  const changingValueOrDate =
    (Number.isInteger(body.signedCents) && body.signedCents !== Number(movRow.signed_cents)) ||
    (typeof body.effectiveDate === 'string' && body.effectiveDate !== movRow.effective_date);

  const movPatch: Record<string, unknown> = {
    version: Number(movRow.version) + 1,
    updated_at: new Date().toISOString(),
  };

  if (movRow.reconciliation_status === 'reconciled' && changingValueOrDate) {
    if (!body.reason || !String(body.reason).trim()) {
      return {
        status: 400,
        code: 'RECONCILED_REASON_REQUIRED',
        message: 'Alterar valor ou data de registro conciliado exige informar o motivo e invalida a conferência.',
      };
    }
    movPatch.reconciliation_status = 'unreconciled';
    await sbUser
      .from('reconciliations')
      .update({
        status: 'invalidated',
        invalidation_reason: String(body.reason).trim(),
      })
      .eq('owner_id', ownerId)
      .eq('account_id', movRow.account_id)
      .gte('cutoff_date', movRow.effective_date)
      .neq('status', 'invalidated');
  }

  if (typeof body.description === 'string' && body.description.trim()) {
    movPatch.description = body.description.trim();
  }
  if (typeof body.effectiveDate === 'string') {
    movPatch.effective_date = body.effectiveDate;
  }
  if (Number.isInteger(body.signedCents) && body.signedCents !== 0) {
    movPatch.signed_cents = body.signedCents;
  }

  let updatedEventRow: any = null;
  if (movRow.event_id) {
    const { data: evRow } = await sbUser
      .from('financial_events')
      .select('*')
      .eq('id', movRow.event_id)
      .eq('owner_id', ownerId)
      .maybeSingle();

    if (evRow) {
      const evPatch: Record<string, unknown> = {
        version: Number(evRow.version) + 1,
        updated_at: new Date().toISOString(),
      };
      if (typeof body.description === 'string' && body.description.trim()) {
        evPatch.description = body.description.trim();
      }
      if ('categoryId' in body) {
        evPatch.category_id = body.categoryId || null;
        movPatch.review_status = body.categoryId ? 'reviewed' : 'pending_category';
      }
      if ('projectId' in body) {
        evPatch.project_id = body.projectId || null;
      }
      if (typeof body.competenceDate === 'string') {
        evPatch.competence_date = body.competenceDate;
      }
      if (Number.isInteger(body.signedCents) && body.signedCents !== 0) {
        evPatch.magnitude_cents = Math.abs(body.signedCents);
      }
      const { data: updEv } = await sbUser
        .from('financial_events')
        .update(evPatch)
        .eq('id', evRow.id)
        .eq('owner_id', ownerId)
        .select('*')
        .single();
      updatedEventRow = updEv;
    }
  } else if ('categoryId' in body) {
    const { data: newEv, error: newEvErr } = await sbUser
      .from('financial_events')
      .insert({
        owner_id: ownerId,
        nature: Number(movRow.signed_cents) >= 0 ? 'income' : 'expense',
        description: (movPatch.description as string) || movRow.description,
        competence_date: (movPatch.effective_date as string) || movRow.effective_date,
        magnitude_cents: Math.abs(Number(movPatch.signed_cents ?? movRow.signed_cents)),
        currency: 'BRL',
        category_id: body.categoryId || null,
        tags: [],
        is_deleted: false,
        version: 1,
      })
      .select('*')
      .single();
    if (newEvErr) throw new Error(newEvErr.message);
    movPatch.event_id = newEv.id;
    movPatch.review_status = body.categoryId ? 'reviewed' : 'pending_category';
    updatedEventRow = newEv;
  }

  const { data: updMov, error: updMovErr } = await sbUser
    .from('account_movements')
    .update(movPatch)
    .eq('id', movId)
    .eq('owner_id', ownerId)
    .select('*')
    .single();
  if (updMovErr) throw new Error(updMovErr.message);

  await sbAppendAudit(sbAdmin, ownerId, 'movement', movId, 'update', body.reason);

  return {
    status: 200,
    payload: {
      movement: mapMovement(updMov),
      event: updatedEventRow ? mapEvent(updatedEventRow, new Map()) : undefined,
    },
  };
}

export async function sbSoftDeleteMovement(
  sbUser: SupabaseClient,
  sbAdmin: SupabaseClient | null,
  ownerId: string,
  movId: string,
  reason?: string
): Promise<boolean> {
  const { data: mov } = await sbUser
    .from('account_movements')
    .select('id, event_id, version')
    .eq('id', movId)
    .eq('owner_id', ownerId)
    .eq('is_deleted', false)
    .maybeSingle();
  if (!mov) return false;

  await sbUser
    .from('account_movements')
    .update({ is_deleted: true, version: Number(mov.version) + 1, updated_at: new Date().toISOString() })
    .eq('id', movId)
    .eq('owner_id', ownerId);

  if (mov.event_id) {
    await sbUser
      .from('financial_events')
      .update({
        is_deleted: true,
        deleted_reason: reason || 'Exclusão pelo usuário',
        updated_at: new Date().toISOString(),
      })
      .eq('id', mov.event_id)
      .eq('owner_id', ownerId);
  }

  await sbAppendAudit(sbAdmin, ownerId, 'movement', movId, 'soft_delete', reason);
  return true;
}

export async function sbCreateTransfer(
  sbUser: SupabaseClient,
  ownerId: string,
  operationKey: string | null,
  body: Record<string, any>
): Promise<{ status: number; payload?: { transferGroup: TransferGroup; movements: AccountMovement[] }; code?: string; message?: string }> {
  const { fromAccountId, toAccountId, amountCents, effectiveDate, description, nature } = body;
  const { data: fromAcc } = await sbUser.from('accounts').select('id, name').eq('id', fromAccountId).eq('owner_id', ownerId).maybeSingle();
  const { data: toAcc } = await sbUser.from('accounts').select('id, name, type').eq('id', toAccountId).eq('owner_id', ownerId).maybeSingle();
  if (!fromAcc || !toAcc) {
    return { status: 404, code: 'ACCOUNT_NOT_FOUND', message: 'Conta de origem ou destino não encontrada.' };
  }

  const date = effectiveDate || todayCivilSaoPaulo();
  const desc = String(description || `Transferência ${fromAcc.name} → ${toAcc.name}`).trim();
  const resolvedNature: TransferNature = nature || (toAcc.type === 'credit_card' ? 'card_payment' : 'internal_transfer');
  const opKey = operationKey || crypto.randomUUID();

  const { data: rpcRes, error: rpcErr } = await sbUser.rpc('rpc_create_transfer', {
    p_operation_key: opKey,
    p_nature: resolvedNature,
    p_from_account_id: fromAccountId,
    p_to_account_id: toAccountId,
    p_amount_cents: amountCents,
    p_effective_date: date,
    p_description: desc,
  });

  if (rpcErr) {
    return { status: 400, code: 'TRANSFER_RPC_ERROR', message: rpcErr.message };
  }

  const { transfer_group_id, out_movement_id, in_movement_id } = rpcRes as {
    transfer_group_id: string;
    out_movement_id: string;
    in_movement_id: string;
  };

  const [{ data: tgRow }, { data: movRows }] = await Promise.all([
    sbUser.from('transfer_groups').select('*').eq('id', transfer_group_id).single(),
    sbUser.from('account_movements').select('*').in('id', [out_movement_id, in_movement_id]),
  ]);

  const transferGroup: TransferGroup = tgRow
    ? {
        id: tgRow.id,
        ownerId: tgRow.owner_id,
        nature: tgRow.nature,
        fromAccountId: tgRow.from_account_id,
        toAccountId: tgRow.to_account_id,
        amountCents: Number(tgRow.amount_cents),
        effectiveDate: tgRow.effective_date,
        description: tgRow.description,
      }
    : {
        id: transfer_group_id,
        ownerId,
        nature: resolvedNature,
        fromAccountId,
        toAccountId,
        amountCents,
        effectiveDate: date,
        description: desc,
      };

  return {
    status: 201,
    payload: {
      transferGroup,
      movements: (movRows || []).map(mapMovement),
    },
  };
}

export async function sbCreateReconciliation(
  sbUser: SupabaseClient,
  sbAdmin: SupabaseClient | null,
  ownerId: string,
  accountId: string,
  cutoffDate: string | undefined,
  reportedBalanceCents: number
): Promise<{ status: number; reconciliation?: Reconciliation; code?: string; message?: string }> {
  const { data: accRow } = await sbUser.from('accounts').select('*').eq('id', accountId).eq('owner_id', ownerId).maybeSingle();
  if (!accRow) {
    return { status: 404, code: 'NOT_FOUND', message: 'Conta não encontrada.' };
  }
  const [{ data: movRows }, { data: recRows }] = await Promise.all([
    sbUser.from('account_movements').select('*').eq('account_id', accountId).eq('owner_id', ownerId),
    sbUser.from('reconciliations').select('*').eq('account_id', accountId).eq('owner_id', ownerId),
  ]);

  const acc = mapAccount(accRow);
  const movs = (movRows || []).map(mapMovement);
  const recs: Reconciliation[] = (recRows || []).map((r: any) => ({
    id: r.id,
    ownerId: r.owner_id,
    accountId: r.account_id,
    cutoffDate: r.cutoff_date,
    reportedBalanceCents: Number(r.reported_balance_cents),
    calculatedBalanceCents: Number(r.calculated_balance_cents),
    differenceCents: Number(r.difference_cents),
    status: r.status,
    invalidationReason: r.invalidation_reason || undefined,
    createdAt: r.created_at,
  }));

  const targetCutoff = cutoffDate || todayCivilSaoPaulo();
  const summary = computeAccountBalance(acc, movs, recs, targetCutoff);
  const calculated = summary.rawComputedCents;
  const diff = reportedBalanceCents - calculated;
  const recStatus: Reconciliation['status'] = diff === 0 ? 'matched' : 'divergent';

  const { data: created, error: insErr } = await sbUser
    .from('reconciliations')
    .insert({
      owner_id: ownerId,
      account_id: acc.id,
      cutoff_date: targetCutoff,
      reported_balance_cents: reportedBalanceCents,
      calculated_balance_cents: calculated,
      difference_cents: diff,
      status: recStatus,
    })
    .select('*')
    .single();
  if (insErr) throw new Error(insErr.message);

  if (recStatus === 'matched') {
    await sbUser
      .from('account_movements')
      .update({
        reconciliation_status: 'reconciled',
        reconciliation_id: created.id,
      })
      .eq('owner_id', ownerId)
      .eq('account_id', acc.id)
      .eq('is_deleted', false)
      .lte('effective_date', targetCutoff);
  }

  await sbAppendAudit(sbAdmin, ownerId, 'reconciliation', created.id, 'reconcile', undefined, { status: recStatus, diff });

  return {
    status: 201,
    reconciliation: {
      id: created.id,
      ownerId: created.owner_id,
      accountId: created.account_id,
      cutoffDate: created.cutoff_date,
      reportedBalanceCents: Number(created.reported_balance_cents),
      calculatedBalanceCents: Number(created.calculated_balance_cents),
      differenceCents: Number(created.difference_cents),
      status: created.status,
      createdAt: created.created_at,
    },
  };
}

export async function sbCreateCard(
  sbUser: SupabaseClient,
  sbAdmin: SupabaseClient | null,
  ownerId: string,
  body: Record<string, any>
): Promise<{ card: Card; account: Account }> {
  const { name, maskedLast4, creditLimitCents, limitVerified, closingDay, dueDay, payingAccountId } = body;
  const { data: accRow, error: accErr } = await sbUser
    .from('accounts')
    .insert({
      owner_id: ownerId,
      name: String(name).trim(),
      type: 'credit_card',
      currency: 'BRL',
      masked_identifier: maskedLast4 ? `•••• ${maskedLast4}` : null,
      color: '#172554',
      opening_balance_cents: 0,
      opening_date: todayCivilSaoPaulo(),
      opening_balance_known: true,
      include_in_liquidity: false,
      is_archived: false,
      version: 1,
    })
    .select('*')
    .single();
  if (accErr) throw new Error(accErr.message);

  const { data: cardRow, error: cardErr } = await sbUser
    .from('cards')
    .insert({
      owner_id: ownerId,
      account_id: accRow.id,
      name: String(name).trim(),
      masked_last4: maskedLast4 || null,
      credit_limit_cents: Number.isInteger(creditLimitCents) ? creditLimitCents : 0,
      limit_verified: Boolean(limitVerified),
      closing_day: Number(closingDay) || 10,
      due_day: Number(dueDay) || 18,
      paying_account_id: payingAccountId || null,
      is_archived: false,
      version: 1,
    })
    .select('*')
    .single();
  if (cardErr) throw new Error(cardErr.message);

  await sbAppendAudit(sbAdmin, ownerId, 'card', cardRow.id, 'create');
  return { card: mapCard(cardRow), account: mapAccount(accRow) };
}

export async function sbCreateCardInstallments(
  sbUser: SupabaseClient,
  sbAdmin: SupabaseClient | null,
  ownerId: string,
  cardId: string,
  body: Record<string, any>
): Promise<{ status: number; payload?: { plan: InstallmentPlan; obligations: Obligation[] }; code?: string; message?: string }> {
  const { data: cardRow } = await sbUser
    .from('cards')
    .select('*')
    .eq('id', cardId)
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (!cardRow) return { status: 404, code: 'NOT_FOUND', message: 'Cartão não encontrado.' };

  const card = mapCard(cardRow);
  const { description, totalCents, installmentCount, purchaseDate, categoryId } = body;
  const parts = splitInstallments(totalCents, installmentCount);
  const pDate = purchaseDate || todayCivilSaoPaulo();

  let planId: string | null = null;
  let plan: InstallmentPlan;

  if (installmentCount >= 2) {
    const { data: planRow, error: planErr } = await sbUser
      .from('installment_plans')
      .insert({
        owner_id: ownerId,
        card_id: card.id,
        description: String(description).trim(),
        total_contracted_cents: totalCents,
        installment_count: installmentCount,
        purchase_date: pDate,
        category_id: categoryId || null,
      })
      .select('*')
      .single();
    if (planErr) throw new Error(planErr.message);
    planId = planRow.id;
    plan = {
      id: planRow.id,
      ownerId,
      cardId: card.id,
      description: planRow.description,
      totalContractedCents: Number(planRow.total_contracted_cents),
      installmentCount: Number(planRow.installment_count),
      purchaseDate: planRow.purchase_date,
      categoryId: planRow.category_id || undefined,
    };
  } else {
    plan = {
      id: crypto.randomUUID(),
      ownerId,
      cardId: card.id,
      description: String(description).trim(),
      totalContractedCents: totalCents,
      installmentCount: 1,
      purchaseDate: pDate,
      categoryId: categoryId || undefined,
    };
  }

  await sbUser.from('account_movements').insert({
    owner_id: ownerId,
    account_id: card.accountId,
    signed_cents: -totalCents,
    effective_date: pDate,
    description: `${plan.description} (${installmentCount}x)`,
    origin: 'manual',
    review_status: categoryId ? 'reviewed' : 'pending_category',
    reconciliation_status: 'unreconciled',
    is_deleted: false,
    version: 1,
  });

  const eventsToInsert: any[] = [];
  const obsToInsert: any[] = [];
  parts.forEach((cents, idx) => {
    const [y, m] = pDate.split('-').map(Number);
    const totalM = y * 12 + (m - 1) + idx;
    const tY = Math.floor(totalM / 12);
    const tM = (totalM % 12) + 1;
    const compDate = `${String(tY).padStart(4, '0')}-${String(tM).padStart(2, '0')}-${String(Math.min(card.closingDay, 28)).padStart(2, '0')}`;
    const dueDate = `${String(tY).padStart(4, '0')}-${String(tM).padStart(2, '0')}-${String(Math.min(card.dueDay, 28)).padStart(2, '0')}`;

    eventsToInsert.push({
      owner_id: ownerId,
      nature: 'expense',
      description: `${plan.description} (${idx + 1}/${installmentCount})`,
      competence_date: compDate,
      magnitude_cents: cents,
      currency: 'BRL',
      category_id: categoryId || null,
      tags: ['parcelado'],
      is_deleted: false,
      version: 1,
    });

    obsToInsert.push({
      owner_id: ownerId,
      direction: 'payable',
      description: `${plan.description} (${idx + 1}/${installmentCount})`,
      due_date: dueDate,
      competence_date: compDate,
      original_cents: cents,
      canceled_cents: 0,
      status: 'expected',
      card_id: card.id,
      category_id: categoryId || null,
      installment_plan_id: planId,
      installment_index: idx + 1,
      version: 1,
    });
  });

  await sbUser.from('financial_events').insert(eventsToInsert);
  const { data: obRows, error: obErr } = await sbUser.from('obligations').insert(obsToInsert).select('*');
  if (obErr) throw new Error(obErr.message);

  if (planId) {
    await sbAppendAudit(sbAdmin, ownerId, 'installment_plan', planId, 'create', undefined, { totalCents, installmentCount });
  }

  return {
    status: 201,
    payload: {
      plan,
      obligations: (obRows || []).map((o: any): Obligation => ({
        id: o.id,
        ownerId: o.owner_id,
        direction: o.direction,
        description: o.description,
        dueDate: o.due_date,
        competenceDate: o.competence_date,
        originalCents: Number(o.original_cents),
        canceledCents: Number(o.canceled_cents || 0),
        status: o.status,
        cardId: o.card_id || undefined,
        categoryId: o.category_id || undefined,
        installmentPlanId: o.installment_plan_id || undefined,
        installmentIndex: o.installment_index ? Number(o.installment_index) : undefined,
        version: Number(o.version || 1),
      })),
    },
  };
}

export async function sbPrepareImport(
  sbUser: SupabaseClient,
  sbAdmin: SupabaseClient | null,
  ownerId: string,
  body: Record<string, any>
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const { accountId, fileName, format, contentBase64, csvOptions } = body;
  const { data: acc } = await sbUser.from('accounts').select('id').eq('id', accountId).eq('owner_id', ownerId).maybeSingle();
  if (!acc) {
    return { status: 400, payload: { code: 'INVALID_ACCOUNT', message: 'Selecione uma conta válida para a importação.' } };
  }

  const fileBytes = Uint8Array.from(Buffer.from(contentBase64, 'base64'));
  const fileHash = crypto.createHash('sha256').update(fileBytes).digest('hex');

  const { data: prevBatch } = await sbUser
    .from('import_batches')
    .select('*')
    .eq('owner_id', ownerId)
    .eq('account_id', accountId)
    .eq('file_hash', fileHash)
    .eq('status', 'committed')
    .limit(1)
    .maybeSingle();

  if (prevBatch) {
    const { data: prevRows } = await sbUser
      .from('import_rows')
      .select('*')
      .eq('batch_id', prevBatch.id)
      .order('row_index', { ascending: true });
    return {
      status: 200,
      payload: {
        duplicateBatch: true,
        existingBatch: mapImportBatch(prevBatch, (prevRows || []).map(mapImportRow)),
        warnings: ['Este mesmo arquivo já foi confirmado nesta conta anteriormente.'],
      },
    };
  }

  const [{ data: movRows }, { data: extRows }, { data: ruleRows }] = await Promise.all([
    sbUser.from('account_movements').select('*').eq('owner_id', ownerId),
    sbUser.from('external_identities').select('*').eq('owner_id', ownerId),
    sbUser.from('category_rules').select('*').eq('owner_id', ownerId),
  ]);

  const batchId = crypto.randomUUID();
  const result = processImportPayload({
    batchId,
    ownerId,
    accountId,
    fileName: String(fileName),
    format,
    fileBytes,
    existingMovements: (movRows || []).map(mapMovement),
    externalIdentities: (extRows || []).map((e: any): ExternalIdentity => ({
      id: e.id,
      ownerId: e.owner_id,
      accountId: e.account_id,
      institutionKey: e.institution_key,
      accountKey: e.account_key,
      fitid: e.fitid,
      movementId: e.movement_id,
      effectiveDate: e.effective_date,
      signedCents: Number(e.signed_cents),
    })),
    rules: (ruleRows || []).map((r: any): CategoryRule => ({
      id: r.id,
      ownerId: r.owner_id,
      priority: Number(r.priority),
      matchText: r.match_text,
      accountId: r.account_id || undefined,
      targetCategoryId: r.target_category_id,
      isActive: Boolean(r.is_active),
    })),
    csvOptions,
  });

  // Upload opcional do extrato original para bucket privado no Supabase Storage
  let storagePath: string | null = null;
  const env = getSupabaseEnv();
  if (sbAdmin) {
    const safeName = String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
    const objectPath = `${ownerId}/${batchId}/${safeName}`;
    const { error: upErr } = await sbAdmin.storage
      .from(env.storageBucket)
      .upload(objectPath, fileBytes, {
        contentType: format === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ofx',
        upsert: false,
      });
    if (!upErr) {
      storagePath = objectPath;
    }
  }

  const b = result.batch;
  const { error: batchErr } = await sbUser.from('import_batches').insert({
    id: b.id,
    owner_id: ownerId,
    account_id: b.accountId,
    file_name: b.fileName,
    file_size_bytes: b.fileSizeBytes,
    file_hash: b.fileHash,
    storage_path: storagePath,
    format: b.format,
    parser_version: b.parserVersion,
    status: b.status,
    total_rows: b.totalRows,
    valid_rows: b.validRows,
    linked_rows: b.linkedRows,
    ignored_rows: b.ignoredRows,
    rejected_rows: b.rejectedRows,
  });
  if (batchErr) throw new Error(batchErr.message);

  if (b.rows.length > 0) {
    const rowPayload = b.rows.map((r) => ({
      id: r.id,
      owner_id: ownerId,
      batch_id: b.id,
      row_index: r.rowIndex,
      raw_payload: r.candidateReason ? { ...r.rawPayload, __candidateReason: r.candidateReason } : r.rawPayload,
      normalized_date: r.normalizedDate || null,
      normalized_description: r.normalizedDescription || null,
      normalized_cents: r.normalizedCents ?? null,
      external_fitid: r.externalFitid || null,
      external_institution: r.externalInstitution || null,
      external_account: r.externalAccount || null,
      suggested_category_id: r.suggestedCategoryId || null,
      candidate_movement_id: r.candidateMovementId || null,
      decision: r.decision,
      validation_errors: r.validationErrors,
    }));
    const { error: rowErr } = await sbUser.from('import_rows').insert(rowPayload);
    if (rowErr) throw new Error(rowErr.message);
  }

  await sbAppendAudit(sbAdmin, ownerId, 'import_batch', batchId, 'prepare', undefined, { totalRows: b.totalRows });

  return { status: 201, payload: { batch: b, warnings: result.warnings } };
}

export async function sbUpdateImportDecisions(
  sbUser: SupabaseClient,
  ownerId: string,
  batchId: string,
  updates: Array<{ rowId: string; decision: ImportDecision; categoryId?: string }> | undefined
): Promise<ImportBatch | null> {
  const { data: batchRow } = await sbUser
    .from('import_batches')
    .select('*')
    .eq('id', batchId)
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (!batchRow) return null;

  if (Array.isArray(updates)) {
    for (const u of updates) {
      const patch: Record<string, unknown> = { decision: u.decision };
      if (u.categoryId !== undefined) patch.suggested_category_id = u.categoryId || null;
      await sbUser.from('import_rows').update(patch).eq('id', u.rowId).eq('batch_id', batchId).eq('owner_id', ownerId);
    }
  }

  const { data: allRows } = await sbUser
    .from('import_rows')
    .select('*')
    .eq('batch_id', batchId)
    .eq('owner_id', ownerId)
    .order('row_index', { ascending: true });
  const mappedRows = (allRows || []).map(mapImportRow);
  const linkedRows = mappedRows.filter((r) => r.decision === 'link_manual').length;
  const ignoredRows = mappedRows.filter((r) => r.decision === 'already_exists' || r.decision === 'excluded_invalid').length;

  const { data: updBatch } = await sbUser
    .from('import_batches')
    .update({ linked_rows: linkedRows, ignored_rows: ignoredRows })
    .eq('id', batchId)
    .eq('owner_id', ownerId)
    .select('*')
    .single();

  return mapImportBatch(updBatch || batchRow, mappedRows);
}

export async function sbCommitImportBatch(
  sbUser: SupabaseClient,
  sbAdmin: SupabaseClient | null,
  ownerId: string,
  batchId: string
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const { data: batchRow } = await sbUser
    .from('import_batches')
    .select('*')
    .eq('id', batchId)
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (!batchRow) return { status: 404, payload: { code: 'NOT_FOUND', message: 'Lote não encontrado.' } };

  const { data: rawRows } = await sbUser
    .from('import_rows')
    .select('*')
    .eq('batch_id', batchId)
    .eq('owner_id', ownerId)
    .order('row_index', { ascending: true });
  const rows = (rawRows || []).map(mapImportRow);

  if (batchRow.status === 'committed') {
    return { status: 200, payload: { batch: mapImportBatch(batchRow, rows), idempotent: true } };
  }

  const blockingInvalid = rows.filter(
    (r) => r.validationErrors.length > 0 && r.decision !== 'excluded_invalid' && r.decision !== 'review_later'
  );
  if (blockingInvalid.length > 0) {
    return {
      status: 400,
      payload: {
        code: 'INVALID_ROWS_BLOCKING',
        message: 'Existem linhas inválidas não excluídas. Exclua-as explicitamente antes de confirmar.',
      },
    };
  }

  let importedCount = 0;
  let linkedCount = 0;
  let ignoredCount = 0;

  for (const row of rows) {
    if (row.decision === 'already_exists' || row.decision === 'excluded_invalid' || row.decision === 'review_later') {
      ignoredCount += 1;
      continue;
    }

    if (row.decision === 'link_manual' && row.candidateMovementId) {
      await sbUser.from('source_links').insert({
        owner_id: ownerId,
        movement_id: row.candidateMovementId,
        batch_id: batchId,
        import_row_id: row.id,
        source_kind: batchRow.format,
      });
      if (row.externalFitid && row.normalizedDate && row.normalizedCents !== undefined) {
        await sbUser.from('external_identities').upsert(
          {
            owner_id: ownerId,
            account_id: batchRow.account_id,
            institution_key: row.externalInstitution || 'generic',
            account_key: row.externalAccount || batchRow.account_id,
            fitid: row.externalFitid,
            movement_id: row.candidateMovementId,
            effective_date: row.normalizedDate,
            signed_cents: row.normalizedCents,
          },
          { onConflict: 'owner_id,account_id,institution_key,account_key,fitid', ignoreDuplicates: true }
        );
      }
      linkedCount += 1;
      continue;
    }

    if (
      (row.decision === 'import_new' || row.decision === 'is_distinct' || row.decision === 'pending') &&
      row.normalizedDate &&
      row.normalizedCents
    ) {
      const { data: evRow, error: evErr } = await sbUser
        .from('financial_events')
        .insert({
          owner_id: ownerId,
          nature: row.normalizedCents > 0 ? 'income' : 'expense',
          description: row.normalizedDescription || 'Lançamento importado',
          competence_date: row.normalizedDate,
          magnitude_cents: Math.abs(row.normalizedCents),
          currency: 'BRL',
          category_id: row.suggestedCategoryId || null,
          tags: [],
          is_deleted: false,
          version: 1,
        })
        .select('id, description')
        .single();
      if (evErr) throw new Error(evErr.message);

      const { data: movRow, error: movErr } = await sbUser
        .from('account_movements')
        .insert({
          owner_id: ownerId,
          account_id: batchRow.account_id,
          event_id: evRow.id,
          signed_cents: row.normalizedCents,
          effective_date: row.normalizedDate,
          description: evRow.description,
          origin: batchRow.format,
          review_status: row.suggestedCategoryId ? 'reviewed' : 'pending_category',
          reconciliation_status: 'unreconciled',
          is_deleted: false,
          version: 1,
        })
        .select('id')
        .single();
      if (movErr) throw new Error(movErr.message);

      row.createdMovementId = movRow.id;
      await sbUser
        .from('import_rows')
        .update({ created_movement_id: movRow.id })
        .eq('id', row.id)
        .eq('owner_id', ownerId);

      await sbUser.from('source_links').insert({
        owner_id: ownerId,
        movement_id: movRow.id,
        batch_id: batchId,
        import_row_id: row.id,
        source_kind: batchRow.format,
      });

      if (row.externalFitid) {
        await sbUser.from('external_identities').upsert(
          {
            owner_id: ownerId,
            account_id: batchRow.account_id,
            institution_key: row.externalInstitution || 'generic',
            account_key: row.externalAccount || batchRow.account_id,
            fitid: row.externalFitid,
            movement_id: movRow.id,
            effective_date: row.normalizedDate,
            signed_cents: row.normalizedCents,
          },
          { onConflict: 'owner_id,account_id,institution_key,account_key,fitid', ignoreDuplicates: true }
        );
      }
      importedCount += 1;
    }
  }

  const { data: updatedBatch } = await sbUser
    .from('import_batches')
    .update({
      status: 'committed',
      committed_at: new Date().toISOString(),
      valid_rows: importedCount,
      linked_rows: linkedCount,
      ignored_rows: ignoredCount,
    })
    .eq('id', batchId)
    .eq('owner_id', ownerId)
    .select('*')
    .single();

  await sbAppendAudit(sbAdmin, ownerId, 'import_batch', batchId, 'commit', undefined, {
    importedCount,
    linkedCount,
    ignoredCount,
  });

  return {
    status: 200,
    payload: {
      batch: mapImportBatch(updatedBatch || batchRow, rows),
      importedCount,
      linkedCount,
      ignoredCount,
    },
  };
}

export async function sbUndoImportBatch(
  sbUser: SupabaseClient,
  sbAdmin: SupabaseClient | null,
  ownerId: string,
  batchId: string
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const { data: batchRow } = await sbUser
    .from('import_batches')
    .select('*')
    .eq('id', batchId)
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (!batchRow || batchRow.status !== 'committed') {
    return { status: 400, payload: { code: 'CANNOT_UNDO', message: 'Apenas lotes confirmados podem ser revertidos.' } };
  }

  const [{ data: rawRows }, { data: links }] = await Promise.all([
    sbUser.from('import_rows').select('*').eq('batch_id', batchId).eq('owner_id', ownerId),
    sbUser.from('source_links').select('*').eq('owner_id', ownerId),
  ]);
  const rows = (rawRows || []).map(mapImportRow);
  const allLinks = links || [];

  let revertedCount = 0;
  let preservedShared = 0;

  for (const row of rows) {
    if (row.createdMovementId) {
      const otherSources = allLinks.filter((l: any) => l.movement_id === row.createdMovementId && l.batch_id !== batchId);
      if (otherSources.length > 0) {
        preservedShared += 1;
      } else {
        const { data: mov } = await sbUser
          .from('account_movements')
          .select('id, event_id')
          .eq('id', row.createdMovementId)
          .eq('owner_id', ownerId)
          .maybeSingle();
        if (mov) {
          await sbUser.from('account_movements').update({ is_deleted: true }).eq('id', mov.id).eq('owner_id', ownerId);
          if (mov.event_id) {
            await sbUser.from('financial_events').update({ is_deleted: true }).eq('id', mov.event_id).eq('owner_id', ownerId);
          }
          await sbUser.from('external_identities').delete().eq('movement_id', mov.id).eq('owner_id', ownerId);
          revertedCount += 1;
        }
      }
    }
  }

  await sbUser.from('source_links').delete().eq('batch_id', batchId).eq('owner_id', ownerId);
  const { data: updBatch } = await sbUser
    .from('import_batches')
    .update({ status: 'reverted' })
    .eq('id', batchId)
    .eq('owner_id', ownerId)
    .select('*')
    .single();

  await sbAppendAudit(sbAdmin, ownerId, 'import_batch', batchId, 'undo', undefined, { revertedCount, preservedShared });

  return {
    status: 200,
    payload: {
      batch: mapImportBatch(updBatch || batchRow, rows),
      revertedCount,
      preservedShared,
    },
  };
}

export async function sbCreateObligation(
  sbUser: SupabaseClient,
  sbAdmin: SupabaseClient | null,
  ownerId: string,
  body: Record<string, any>
): Promise<Obligation> {
  const { direction, description, dueDate, competenceDate, originalCents, accountId, categoryId } = body;
  const due = dueDate || todayCivilSaoPaulo();
  const { data, error } = await sbUser
    .from('obligations')
    .insert({
      owner_id: ownerId,
      direction: direction === 'receivable' ? 'receivable' : 'payable',
      description: String(description).trim(),
      due_date: due,
      competence_date: competenceDate || due,
      original_cents: originalCents,
      canceled_cents: 0,
      status: 'expected',
      account_id: accountId || null,
      category_id: categoryId || null,
      version: 1,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  await sbAppendAudit(sbAdmin, ownerId, 'obligation', data.id, 'create');
  return {
    id: data.id,
    ownerId: data.owner_id,
    direction: data.direction,
    description: data.description,
    dueDate: data.due_date,
    competenceDate: data.competence_date,
    originalCents: Number(data.original_cents),
    canceledCents: Number(data.canceled_cents || 0),
    status: data.status,
    accountId: data.account_id || undefined,
    categoryId: data.category_id || undefined,
    version: Number(data.version || 1),
  };
}

export async function sbCreateRecurrence(
  sbUser: SupabaseClient,
  ownerId: string,
  body: Record<string, any>
): Promise<Recurrence> {
  const { direction, description, amountCents, frequency, anchorDay, startDate, endDate, accountId, categoryId } = body;
  const resolvedStart = startDate || todayCivilSaoPaulo();
  const resolvedAnchor = Number(anchorDay) || Number(resolvedStart.split('-')[2]) || 1;
  const { data: recRow, error } = await sbUser
    .from('recurrences')
    .insert({
      owner_id: ownerId,
      direction: direction === 'receivable' ? 'receivable' : 'payable',
      description: String(description).trim(),
      amount_cents: amountCents,
      frequency: frequency === 'weekly' || frequency === 'yearly' ? frequency : 'monthly',
      anchor_day: resolvedAnchor,
      start_date: resolvedStart,
      end_date: endDate || null,
      account_id: accountId || null,
      category_id: categoryId || null,
      is_active: true,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);

  const rec: Recurrence = {
    id: recRow.id,
    ownerId: recRow.owner_id,
    direction: recRow.direction,
    description: recRow.description,
    amountCents: Number(recRow.amount_cents),
    frequency: recRow.frequency,
    anchorDay: Number(recRow.anchor_day),
    startDate: recRow.start_date,
    endDate: recRow.end_date || undefined,
    accountId: recRow.account_id || undefined,
    categoryId: recRow.category_id || undefined,
    isActive: Boolean(recRow.is_active),
  };

  const horizon = '2027-12-31';
  const dates = generateRecurrenceDates(rec, horizon).slice(0, 6);
  if (dates.length > 0) {
    await sbUser.from('obligations').upsert(
      dates.map((dt) => ({
        owner_id: ownerId,
        direction: rec.direction,
        description: rec.description,
        due_date: dt,
        competence_date: dt,
        original_cents: rec.amountCents,
        canceled_cents: 0,
        status: 'expected',
        account_id: rec.accountId || null,
        category_id: rec.categoryId || null,
        recurrence_id: rec.id,
        version: 1,
      })),
      { onConflict: 'owner_id,recurrence_id,due_date', ignoreDuplicates: true }
    );
  }
  return rec;
}

export async function sbSettleObligation(
  sbUser: SupabaseClient,
  sbAdmin: SupabaseClient | null,
  ownerId: string,
  obId: string,
  body: Record<string, any>
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const { data: obRow } = await sbUser
    .from('obligations')
    .select('*')
    .eq('id', obId)
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (!obRow) return { status: 404, payload: { code: 'NOT_FOUND', message: 'Obrigação não encontrada.' } };

  const { data: existingSettles } = await sbUser
    .from('settlements')
    .select('allocated_cents')
    .eq('obligation_id', obId)
    .eq('owner_id', ownerId);
  const alreadyPaid = (existingSettles || []).reduce((acc: number, s: any) => acc + Number(s.allocated_cents), 0);
  const open = Math.max(0, Number(obRow.original_cents) - Number(obRow.canceled_cents || 0) - alreadyPaid);

  const { accountId, amountCents, effectiveDate, existingMovementId } = body;
  if (amountCents > open) {
    return { status: 400, payload: { code: 'EXCEEDS_OPEN', message: 'Valor supera o saldo em aberto desta obrigação.' } };
  }

  let movementId = existingMovementId;
  if (!movementId) {
    const { data: acc } = await sbUser.from('accounts').select('id').eq('id', accountId).eq('owner_id', ownerId).maybeSingle();
    if (!acc) return { status: 400, payload: { code: 'INVALID_ACCOUNT', message: 'Conta pagadora/recebedora inválida.' } };

    const effDate = effectiveDate || todayCivilSaoPaulo();
    const { data: evRow, error: evErr } = await sbUser
      .from('financial_events')
      .insert({
        owner_id: ownerId,
        nature: obRow.direction === 'receivable' ? 'income' : 'expense',
        description: `Liquidação: ${obRow.description}`,
        competence_date: obRow.competence_date,
        magnitude_cents: amountCents,
        currency: 'BRL',
        category_id: obRow.category_id || null,
        tags: [],
        is_deleted: false,
        version: 1,
      })
      .select('id')
      .single();
    if (evErr) throw new Error(evErr.message);

    const { data: movRow, error: movErr } = await sbUser
      .from('account_movements')
      .insert({
        owner_id: ownerId,
        account_id: acc.id,
        event_id: evRow.id,
        signed_cents: obRow.direction === 'receivable' ? amountCents : -amountCents,
        effective_date: effDate,
        description: `Liquidação: ${obRow.description}`,
        origin: 'manual',
        review_status: obRow.category_id ? 'reviewed' : 'pending_category',
        reconciliation_status: 'unreconciled',
        is_deleted: false,
        version: 1,
      })
      .select('id')
      .single();
    if (movErr) throw new Error(movErr.message);
    movementId = movRow.id;
  }

  const { data: setRow, error: setErr } = await sbUser
    .from('settlements')
    .insert({
      owner_id: ownerId,
      obligation_id: obId,
      movement_id: movementId,
      allocated_cents: amountCents,
    })
    .select('*')
    .single();
  if (setErr) throw new Error(setErr.message);

  const newPaid = alreadyPaid + amountCents;
  const nextStatus = newPaid >= Number(obRow.original_cents) - Number(obRow.canceled_cents || 0) ? 'settled' : 'partially_settled';
  const { data: updOb } = await sbUser
    .from('obligations')
    .update({ status: nextStatus, version: Number(obRow.version) + 1, updated_at: new Date().toISOString() })
    .eq('id', obId)
    .eq('owner_id', ownerId)
    .select('*')
    .single();

  await sbAppendAudit(sbAdmin, ownerId, 'obligation', obId, 'settle', undefined, { amountCents });

  return {
    status: 201,
    payload: {
      obligation: {
        id: updOb.id,
        ownerId: updOb.owner_id,
        direction: updOb.direction,
        description: updOb.description,
        dueDate: updOb.due_date,
        competenceDate: updOb.competence_date,
        originalCents: Number(updOb.original_cents),
        canceledCents: Number(updOb.canceled_cents || 0),
        status: updOb.status,
        version: Number(updOb.version || 1),
      },
      settlement: {
        id: setRow.id,
        ownerId: setRow.owner_id,
        obligationId: setRow.obligation_id,
        movementId: setRow.movement_id,
        allocatedCents: Number(setRow.allocated_cents),
        createdAt: setRow.created_at,
      },
    },
  };
}

export async function sbUpsertBudget(
  sbUser: SupabaseClient,
  ownerId: string,
  body: Record<string, any>
): Promise<{ status: number; budget: Budget }> {
  const { monthKey, categoryId, limitCents, alertThresholdPct } = body;
  const { data: existing } = await sbUser
    .from('budgets')
    .select('*')
    .eq('owner_id', ownerId)
    .eq('month_key', monthKey)
    .eq('category_id', categoryId)
    .maybeSingle();

  if (existing) {
    const { data: upd, error } = await sbUser
      .from('budgets')
      .update({
        limit_cents: limitCents,
        alert_threshold_pct: Number(alertThresholdPct) || 80,
        version: Number(existing.version) + 1,
      })
      .eq('id', existing.id)
      .eq('owner_id', ownerId)
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return {
      status: 200,
      budget: {
        id: upd.id,
        ownerId: upd.owner_id,
        monthKey: upd.month_key,
        categoryId: upd.category_id,
        limitCents: Number(upd.limit_cents),
        alertThresholdPct: Number(upd.alert_threshold_pct),
        version: Number(upd.version),
      },
    };
  }

  const { data: created, error } = await sbUser
    .from('budgets')
    .insert({
      owner_id: ownerId,
      month_key: monthKey,
      category_id: categoryId,
      limit_cents: limitCents,
      alert_threshold_pct: Number(alertThresholdPct) || 80,
      version: 1,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return {
    status: 201,
    budget: {
      id: created.id,
      ownerId: created.owner_id,
      monthKey: created.month_key,
      categoryId: created.category_id,
      limitCents: Number(created.limit_cents),
      alertThresholdPct: Number(created.alert_threshold_pct),
      version: Number(created.version),
    },
  };
}

export async function sbCreateGoal(
  sbUser: SupabaseClient,
  ownerId: string,
  body: Record<string, any>
): Promise<Goal> {
  const { name, targetCents, reservedCents, deadlineDate } = body;
  const { data, error } = await sbUser
    .from('goals')
    .insert({
      owner_id: ownerId,
      name: String(name).trim(),
      target_cents: targetCents,
      reserved_cents: Number.isInteger(reservedCents) && reservedCents >= 0 ? reservedCents : 0,
      deadline_date: deadlineDate || null,
      version: 1,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return {
    id: data.id,
    ownerId: data.owner_id,
    name: data.name,
    targetCents: Number(data.target_cents),
    reservedCents: Number(data.reserved_cents),
    deadlineDate: data.deadline_date || undefined,
    version: Number(data.version),
  };
}

export async function sbContributeGoal(
  sbUser: SupabaseClient,
  ownerId: string,
  goalId: string,
  amountCents: number,
  note?: string
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const { data: goalRow } = await sbUser.from('goals').select('*').eq('id', goalId).eq('owner_id', ownerId).maybeSingle();
  if (!goalRow) return { status: 404, payload: { code: 'NOT_FOUND', message: 'Meta não encontrada.' } };

  const nextReserved = Number(goalRow.reserved_cents) + amountCents;
  if (nextReserved < 0) {
    return { status: 400, payload: { code: 'NEGATIVE_RESERVE', message: 'Reserva da meta não pode ficar negativa.' } };
  }

  if (amountCents > 0) {
    const [{ data: accRows }, { data: movRows }, { data: recRows }, { data: goalRows }] = await Promise.all([
      sbUser.from('accounts').select('*').eq('owner_id', ownerId),
      sbUser.from('account_movements').select('*').eq('owner_id', ownerId),
      sbUser.from('reconciliations').select('*').eq('owner_id', ownerId),
      sbUser.from('goals').select('reserved_cents').eq('owner_id', ownerId),
    ]);
    const accounts = (accRows || []).map(mapAccount);
    const movements = (movRows || []).map(mapMovement);
    const recs: Reconciliation[] = (recRows || []).map((r: any) => ({
      id: r.id,
      ownerId: r.owner_id,
      accountId: r.account_id,
      cutoffDate: r.cutoff_date,
      reportedBalanceCents: Number(r.reported_balance_cents),
      calculatedBalanceCents: Number(r.calculated_balance_cents),
      differenceCents: Number(r.difference_cents),
      status: r.status,
      createdAt: r.created_at,
    }));
    const totalLiquidity = accounts
      .filter((a) => !a.isArchived && a.includeInLiquidity && a.type !== 'credit_card' && a.openingBalanceKnown)
      .reduce((acc, a) => acc + (computeAccountBalance(a, movements, recs).balanceCents ?? 0), 0);
    const totalReservedAfter = (goalRows || []).reduce((acc: number, g: any) => acc + Number(g.reserved_cents), 0) + amountCents;

    if (totalReservedAfter > totalLiquidity) {
      return {
        status: 400,
        payload: {
          code: 'EXCEEDS_LIQUIDITY',
          message: 'Não é possível reservar em metas um valor superior ao saldo líquido disponível.',
        },
      };
    }
  }

  const { data: updGoal, error: updErr } = await sbUser
    .from('goals')
    .update({ reserved_cents: nextReserved, version: Number(goalRow.version) + 1 })
    .eq('id', goalId)
    .eq('owner_id', ownerId)
    .select('*')
    .single();
  if (updErr) throw new Error(updErr.message);

  await sbUser.from('goal_contributions').insert({
    owner_id: ownerId,
    goal_id: goalId,
    amount_cents: amountCents,
    contribution_date: todayCivilSaoPaulo(),
    note: note || null,
  });

  return {
    status: 200,
    payload: {
      goal: {
        id: updGoal.id,
        ownerId: updGoal.owner_id,
        name: updGoal.name,
        targetCents: Number(updGoal.target_cents),
        reservedCents: Number(updGoal.reserved_cents),
        deadlineDate: updGoal.deadline_date || undefined,
        version: Number(updGoal.version),
      },
    },
  };
}

export async function sbRestorePackage(
  sbUser: SupabaseClient,
  sbAdmin: SupabaseClient | null,
  ownerId: string,
  pkg: Record<string, any>
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const [{ data: accExisting }, { data: movExisting }] = await Promise.all([
    sbUser.from('accounts').select('id').eq('owner_id', ownerId).limit(1),
    sbUser.from('account_movements').select('id').eq('owner_id', ownerId).limit(1),
  ]);

  if ((accExisting && accExisting.length > 0) || (movExisting && movExisting.length > 0)) {
    return {
      status: 409,
      payload: {
        code: 'WORKSPACE_NOT_EMPTY',
        message: 'Na versão atual, a restauração pessoal exige uma conta/espaço vazio para evitar sobrescrita acidental.',
      },
    };
  }

  const uuidOrNew = (id: string | undefined, map: Map<string, string>) => {
    if (!id) return crypto.randomUUID();
    if (!map.has(id)) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      map.set(id, isUuid ? id : crypto.randomUUID());
    }
    return map.get(id)!;
  };

  const idMap = new Map<string, string>();
  const data = pkg.data || {};

  const categories = (data.categories || []).map((c: Category) => ({
    id: uuidOrNew(c.id, idMap),
    owner_id: ownerId,
    parent_id: c.parentId ? uuidOrNew(c.parentId, idMap) : null,
    name: c.name,
    kind: c.kind,
    essentiality: c.essentiality || 'unassigned',
    is_archived: Boolean(c.isArchived),
  }));
  if (categories.length > 0) await sbUser.from('categories').upsert(categories, { onConflict: 'id' });

  const accounts = (data.accounts || []).map((a: Account) => ({
    id: uuidOrNew(a.id, idMap),
    owner_id: ownerId,
    name: a.name,
    institution: a.institution || null,
    type: a.type,
    currency: 'BRL',
    masked_identifier: a.maskedIdentifier || null,
    color: a.color || '#2955D9',
    opening_balance_cents: a.openingBalanceCents,
    opening_date: a.openingDate,
    opening_balance_known: a.openingBalanceKnown,
    include_in_liquidity: a.includeInLiquidity,
    is_archived: Boolean(a.isArchived),
    version: 1,
  }));
  if (accounts.length > 0) await sbUser.from('accounts').insert(accounts);

  const cards = (data.cards || []).map((c: Card) => ({
    id: uuidOrNew(c.id, idMap),
    owner_id: ownerId,
    account_id: uuidOrNew(c.accountId, idMap),
    name: c.name,
    masked_last4: c.maskedLast4 || null,
    credit_limit_cents: c.creditLimitCents,
    limit_verified: Boolean(c.limitVerified),
    closing_day: c.closingDay,
    due_day: c.dueDay,
    paying_account_id: c.payingAccountId ? uuidOrNew(c.payingAccountId, idMap) : null,
    is_archived: Boolean(c.isArchived),
    version: 1,
  }));
  if (cards.length > 0) await sbUser.from('cards').insert(cards);

  const events = (data.events || []).map((e: FinancialEvent) => ({
    id: uuidOrNew(e.id, idMap),
    owner_id: ownerId,
    nature: e.nature,
    description: e.description,
    competence_date: e.competenceDate,
    magnitude_cents: e.magnitudeCents,
    currency: 'BRL',
    category_id: e.categoryId ? uuidOrNew(e.categoryId, idMap) : null,
    tags: e.tags || [],
    notes: e.notes || null,
    is_deleted: Boolean(e.isDeleted),
    version: 1,
  }));
  if (events.length > 0) await sbUser.from('financial_events').insert(events);

  const movements = (data.movements || []).map((m: AccountMovement) => ({
    id: uuidOrNew(m.id, idMap),
    owner_id: ownerId,
    account_id: uuidOrNew(m.accountId, idMap),
    event_id: m.eventId ? uuidOrNew(m.eventId, idMap) : null,
    signed_cents: m.signedCents,
    effective_date: m.effectiveDate,
    description: m.description,
    origin: m.origin,
    review_status: m.reviewStatus,
    reconciliation_status: m.reconciliationStatus,
    is_deleted: Boolean(m.isDeleted),
    version: 1,
  }));
  if (movements.length > 0) await sbUser.from('account_movements').insert(movements);

  const budgets = (data.budgets || []).map((b: Budget) => ({
    id: uuidOrNew(b.id, idMap),
    owner_id: ownerId,
    month_key: b.monthKey,
    category_id: uuidOrNew(b.categoryId, idMap),
    limit_cents: b.limitCents,
    alert_threshold_pct: b.alertThresholdPct,
    version: 1,
  }));
  if (budgets.length > 0) await sbUser.from('budgets').insert(budgets);

  const goals = (data.goals || []).map((g: Goal) => ({
    id: uuidOrNew(g.id, idMap),
    owner_id: ownerId,
    name: g.name,
    target_cents: g.targetCents,
    reserved_cents: g.reservedCents,
    deadline_date: g.deadlineDate || null,
    version: 1,
  }));
  if (goals.length > 0) await sbUser.from('goals').insert(goals);

  await sbAppendAudit(sbAdmin, ownerId, 'backup', ownerId, 'personal_restore');
  return {
    status: 200,
    payload: {
      ok: true,
      restoredAccounts: accounts.length,
      restoredMovements: movements.length,
    },
  };
}

export async function sbCreateCategory(
  sbUser: SupabaseClient,
  ownerId: string,
  body: Record<string, any>
): Promise<Category> {
  const { name, kind, essentiality, parentId } = body;
  const { data, error } = await sbUser
    .from('categories')
    .insert({
      owner_id: ownerId,
      parent_id: parentId || null,
      name: String(name).trim(),
      kind: kind === 'income' ? 'income' : 'expense',
      essentiality: essentiality || 'unassigned',
      is_archived: false,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return mapCategory(data);
}

export async function sbCreateCategoryRule(
  sbUser: SupabaseClient,
  ownerId: string,
  body: Record<string, any>
): Promise<CategoryRule> {
  const { matchText, targetCategoryId, priority } = body;
  const { data, error } = await sbUser
    .from('category_rules')
    .insert({
      owner_id: ownerId,
      priority: Number(priority) || 50,
      match_text: String(matchText).trim(),
      target_category_id: targetCategoryId,
      is_active: true,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return {
    id: data.id,
    ownerId: data.owner_id,
    priority: Number(data.priority),
    matchText: data.match_text,
    accountId: data.account_id || undefined,
    targetCategoryId: data.target_category_id,
    isActive: Boolean(data.is_active),
  };
}

export async function sbDismissInsight(
  sbAdmin: SupabaseClient | null,
  ownerId: string,
  insightId: string
): Promise<void> {
  await sbAppendAudit(sbAdmin, ownerId, 'insight_preference', ownerId, 'dismiss', undefined, { insightId });
}

/**
 * Exclui um lote do histórico. Lotes confirmados precisam ser revertidos antes.
 * As linhas do lote são removidas em cascata; o extrato original no Storage é removido em seguida.
 */
export async function sbDeleteImportBatch(
  sbUser: SupabaseClient,
  sbAdmin: SupabaseClient | null,
  ownerId: string,
  batchId: string
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const { data: batchRow } = await sbUser
    .from('import_batches')
    .select('id,status,storage_path,file_name')
    .eq('id', batchId)
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (!batchRow) {
    return { status: 404, payload: { code: 'NOT_FOUND', message: 'Lote não encontrado.' } };
  }
  if (batchRow.status === 'committed') {
    return { status: 400, payload: { code: 'CANNOT_DELETE', message: 'Reverta o lote antes de excluí-lo.' } };
  }

  const { error: delErr } = await sbUser.from('import_batches').delete().eq('id', batchId).eq('owner_id', ownerId);
  if (delErr) {
    return { status: 500, payload: { code: 'DELETE_FAILED', message: delErr.message } };
  }

  if (sbAdmin && batchRow.storage_path) {
    const env = getSupabaseEnv();
    await sbAdmin.storage.from(env.storageBucket).remove([batchRow.storage_path as string]);
  }

  await sbAppendAudit(sbAdmin, ownerId, 'import_batch', batchId, 'delete', undefined, {
    fileName: String(batchRow.file_name || ''),
  });
  return { status: 200, payload: { ok: true } };
}

/**
 * Exclusão em lote (soft delete) de lançamentos do próprio usuário.
 * Processa em blocos pequenos para não sobrecarregar a conexão; ids inexistentes/alheios são ignorados.
 */
export async function sbSoftDeleteMovementsBulk(
  sbUser: SupabaseClient,
  sbAdmin: SupabaseClient | null,
  ownerId: string,
  movIds: string[],
  reason?: string
): Promise<{ deleted: number; skipped: number }> {
  const unique = Array.from(new Set(movIds));
  let deleted = 0;
  const CHUNK = 10;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const results = await Promise.all(
      unique.slice(i, i + CHUNK).map((id) => sbSoftDeleteMovement(sbUser, sbAdmin, ownerId, id, reason))
    );
    deleted += results.filter(Boolean).length;
  }
  return { deleted, skipped: unique.length - deleted };
}
