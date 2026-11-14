-- Clareza Financeira — Migração Inicial v2.0 (Supabase PostgreSQL + RLS + RPCs Transacionais)
-- Moeda padrão: BRL | Valores monetários: BIGINT em centavos | Datas civis: DATE | Auditoria: TIMESTAMPTZ

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Perfis e Configurações do Proprietário
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT 'Titular',
  currency TEXT NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  theme TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
  privacy_mode BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Contas (Ativos de liquidez / passivo de cartão)
CREATE TABLE IF NOT EXISTS public.accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  institution TEXT,
  type TEXT NOT NULL CHECK (type IN ('checking', 'savings', 'cash', 'digital_wallet', 'investment_manual', 'credit_card')),
  currency TEXT NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  masked_identifier TEXT,
  color TEXT NOT NULL DEFAULT '#2955D9',
  opening_balance_cents BIGINT NOT NULL DEFAULT 0,
  opening_date DATE NOT NULL,
  opening_balance_known BOOLEAN NOT NULL DEFAULT TRUE,
  include_in_liquidity BOOLEAN NOT NULL DEFAULT TRUE,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_id, id)
);

-- 3. Cartões de Crédito (Metadados de passivo vinculados à conta de tipo credit_card)
CREATE TABLE IF NOT EXISTS public.cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL,
  name TEXT NOT NULL,
  masked_last4 TEXT,
  credit_limit_cents BIGINT NOT NULL DEFAULT 0 CHECK (credit_limit_cents >= 0),
  limit_verified BOOLEAN NOT NULL DEFAULT FALSE,
  closing_day INTEGER NOT NULL CHECK (closing_day BETWEEN 1 AND 31),
  due_day INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  paying_account_id UUID,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_id, id),
  FOREIGN KEY (owner_id, account_id) REFERENCES public.accounts(owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, paying_account_id) REFERENCES public.accounts(owner_id, id) ON DELETE SET NULL
);

-- 4. Categorias, Tags e Projetos
CREATE TABLE IF NOT EXISTS public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_id UUID,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('income', 'expense', 'transfer', 'opening', 'financing')),
  essentiality TEXT NOT NULL DEFAULT 'unassigned' CHECK (essentiality IN ('essential', 'discretionary', 'unassigned')),
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_id, id),
  FOREIGN KEY (owner_id, parent_id) REFERENCES public.categories(owner_id, id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_id, id)
);

-- 5. Grupos de Transferência
CREATE TABLE IF NOT EXISTS public.transfer_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nature TEXT NOT NULL CHECK (nature IN ('internal_transfer', 'card_payment', 'investment_aport', 'investment_redemption', 'loan_disbursement', 'loan_principal')),
  from_account_id UUID NOT NULL,
  to_account_id UUID NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  effective_date DATE NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_id, id),
  FOREIGN KEY (owner_id, from_account_id) REFERENCES public.accounts(owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, to_account_id) REFERENCES public.accounts(owner_id, id) ON DELETE RESTRICT,
  CHECK (from_account_id <> to_account_id)
);

-- 6. Eventos Financeiros (Competência / Fato Gerador)
CREATE TABLE IF NOT EXISTS public.financial_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nature TEXT NOT NULL CHECK (nature IN ('income', 'expense', 'transfer', 'opening', 'financing', 'investment_flow', 'refund')),
  description TEXT NOT NULL,
  competence_date DATE NOT NULL,
  magnitude_cents BIGINT NOT NULL CHECK (magnitude_cents > 0),
  currency TEXT NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  category_id UUID,
  project_id UUID,
  tags TEXT[] NOT NULL DEFAULT '{}',
  refund_of_event_id UUID,
  notes TEXT,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_id, id),
  FOREIGN KEY (owner_id, category_id) REFERENCES public.categories(owner_id, id) ON DELETE SET NULL,
  FOREIGN KEY (owner_id, project_id) REFERENCES public.projects(owner_id, id) ON DELETE SET NULL,
  FOREIGN KEY (owner_id, refund_of_event_id) REFERENCES public.financial_events(owner_id, id) ON DELETE SET NULL
);

-- 7. Rateios (Allocations) — soma exata validada por trigger/RPC
CREATE TABLE IF NOT EXISTS public.allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id UUID NOT NULL,
  category_id UUID,
  project_id UUID,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  FOREIGN KEY (owner_id, event_id) REFERENCES public.financial_events(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, category_id) REFERENCES public.categories(owner_id, id) ON DELETE SET NULL,
  FOREIGN KEY (owner_id, project_id) REFERENCES public.projects(owner_id, id) ON DELETE SET NULL
);

-- 8. Movimentos de Conta (Caixa Realizado — valor assinado)
CREATE TABLE IF NOT EXISTS public.account_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL,
  event_id UUID,
  transfer_group_id UUID,
  signed_cents BIGINT NOT NULL CHECK (signed_cents <> 0),
  effective_date DATE NOT NULL,
  description TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'csv', 'ofx', 'system_transfer')),
  review_status TEXT NOT NULL DEFAULT 'reviewed' CHECK (review_status IN ('reviewed', 'pending_category', 'pending_review')),
  reconciliation_status TEXT NOT NULL DEFAULT 'unreconciled' CHECK (reconciliation_status IN ('unreconciled', 'reconciled', 'divergent')),
  reconciliation_id UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_id, id),
  FOREIGN KEY (owner_id, account_id) REFERENCES public.accounts(owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, event_id) REFERENCES public.financial_events(owner_id, id) ON DELETE SET NULL,
  FOREIGN KEY (owner_id, transfer_group_id) REFERENCES public.transfer_groups(owner_id, id) ON DELETE SET NULL
);

-- 9. Obrigações (Agenda / Parcelas / Faturas) e Liquidações
CREATE TABLE IF NOT EXISTS public.recurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('payable', 'receivable')),
  description TEXT NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'yearly')),
  anchor_day INTEGER NOT NULL CHECK (anchor_day BETWEEN 1 AND 31),
  start_date DATE NOT NULL,
  end_date DATE,
  account_id UUID,
  category_id UUID,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_id, id),
  FOREIGN KEY (owner_id, account_id) REFERENCES public.accounts(owner_id, id) ON DELETE SET NULL,
  FOREIGN KEY (owner_id, category_id) REFERENCES public.categories(owner_id, id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.installment_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id UUID,
  description TEXT NOT NULL,
  total_contracted_cents BIGINT NOT NULL CHECK (total_contracted_cents > 0),
  installment_count INTEGER NOT NULL CHECK (installment_count >= 2),
  purchase_date DATE NOT NULL,
  category_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_id, id),
  FOREIGN KEY (owner_id, card_id) REFERENCES public.cards(owner_id, id) ON DELETE SET NULL,
  FOREIGN KEY (owner_id, category_id) REFERENCES public.categories(owner_id, id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.obligations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('payable', 'receivable')),
  description TEXT NOT NULL,
  due_date DATE NOT NULL,
  competence_date DATE NOT NULL,
  original_cents BIGINT NOT NULL CHECK (original_cents > 0),
  canceled_cents BIGINT NOT NULL DEFAULT 0 CHECK (canceled_cents >= 0),
  status TEXT NOT NULL DEFAULT 'expected' CHECK (status IN ('expected', 'partially_settled', 'settled', 'canceled')),
  account_id UUID,
  card_id UUID,
  category_id UUID,
  recurrence_id UUID,
  installment_plan_id UUID,
  installment_index INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, recurrence_id, due_date),
  FOREIGN KEY (owner_id, account_id) REFERENCES public.accounts(owner_id, id) ON DELETE SET NULL,
  FOREIGN KEY (owner_id, card_id) REFERENCES public.cards(owner_id, id) ON DELETE SET NULL,
  FOREIGN KEY (owner_id, category_id) REFERENCES public.categories(owner_id, id) ON DELETE SET NULL,
  FOREIGN KEY (owner_id, recurrence_id) REFERENCES public.recurrences(owner_id, id) ON DELETE SET NULL,
  FOREIGN KEY (owner_id, installment_plan_id) REFERENCES public.installment_plans(owner_id, id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  obligation_id UUID NOT NULL,
  movement_id UUID NOT NULL,
  allocated_cents BIGINT NOT NULL CHECK (allocated_cents > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (owner_id, obligation_id) REFERENCES public.obligations(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, movement_id) REFERENCES public.account_movements(owner_id, id) ON DELETE RESTRICT
);

-- 10. Importações, Identidades Externas, Vínculos e Jobs Duráveis
CREATE TABLE IF NOT EXISTS public.import_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  bank_signature TEXT NOT NULL,
  delimiter TEXT NOT NULL DEFAULT ';',
  encoding TEXT NOT NULL DEFAULT 'utf-8',
  date_format TEXT NOT NULL DEFAULT 'DD/MM/YYYY',
  decimal_separator TEXT NOT NULL DEFAULT ',',
  column_map JSONB NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_id, id)
);

CREATE TABLE IF NOT EXISTS public.import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL,
  file_name TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 20971520),
  file_hash TEXT NOT NULL,
  storage_path TEXT,
  format TEXT NOT NULL CHECK (format IN ('csv', 'ofx')),
  parser_version TEXT NOT NULL DEFAULT '2.0.0',
  profile_id UUID,
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'parsing', 'awaiting_review', 'committing', 'committed', 'reverted', 'failed')),
  total_rows INTEGER NOT NULL DEFAULT 0,
  valid_rows INTEGER NOT NULL DEFAULT 0,
  linked_rows INTEGER NOT NULL DEFAULT 0,
  ignored_rows INTEGER NOT NULL DEFAULT 0,
  rejected_rows INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  committed_at TIMESTAMPTZ,
  UNIQUE (owner_id, id),
  FOREIGN KEY (owner_id, account_id) REFERENCES public.accounts(owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, profile_id) REFERENCES public.import_profiles(owner_id, id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.import_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL,
  row_index INTEGER NOT NULL,
  raw_payload JSONB NOT NULL,
  normalized_date DATE,
  normalized_description TEXT,
  normalized_cents BIGINT,
  external_fitid TEXT,
  external_institution TEXT,
  external_account TEXT,
  suggested_category_id UUID,
  candidate_movement_id UUID,
  decision TEXT NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending', 'import_new', 'already_exists', 'is_distinct', 'link_manual', 'review_later', 'excluded_invalid')),
  validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_movement_id UUID,
  UNIQUE (owner_id, id),
  FOREIGN KEY (owner_id, batch_id) REFERENCES public.import_batches(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, suggested_category_id) REFERENCES public.categories(owner_id, id) ON DELETE SET NULL,
  FOREIGN KEY (owner_id, candidate_movement_id) REFERENCES public.account_movements(owner_id, id) ON DELETE SET NULL,
  FOREIGN KEY (owner_id, created_movement_id) REFERENCES public.account_movements(owner_id, id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.external_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL,
  institution_key TEXT NOT NULL,
  account_key TEXT NOT NULL,
  fitid TEXT NOT NULL,
  movement_id UUID NOT NULL,
  effective_date DATE NOT NULL,
  signed_cents BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_id, account_id, institution_key, account_key, fitid),
  FOREIGN KEY (owner_id, account_id) REFERENCES public.accounts(owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, movement_id) REFERENCES public.account_movements(owner_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.source_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  movement_id UUID NOT NULL,
  batch_id UUID,
  import_row_id UUID,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('manual', 'csv', 'ofx')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (owner_id, movement_id) REFERENCES public.account_movements(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, batch_id) REFERENCES public.import_batches(owner_id, id) ON DELETE SET NULL,
  FOREIGN KEY (owner_id, import_row_id) REFERENCES public.import_rows(owner_id, id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'leased', 'completed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_expires_at TIMESTAMPTZ,
  locked_by TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (owner_id, batch_id) REFERENCES public.import_batches(owner_id, id) ON DELETE CASCADE
);

-- 11. Conciliação, Orçamentos, Metas, Regras, Auditoria e Idempotência
CREATE TABLE IF NOT EXISTS public.reconciliations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL,
  cutoff_date DATE NOT NULL,
  reported_balance_cents BIGINT NOT NULL,
  calculated_balance_cents BIGINT NOT NULL,
  difference_cents BIGINT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('matched', 'divergent', 'invalidated')),
  invalidation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_id, id),
  FOREIGN KEY (owner_id, account_id) REFERENCES public.accounts(owner_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month_key TEXT NOT NULL CHECK (month_key ~ '^\d{4}-\d{2}$'),
  category_id UUID NOT NULL,
  limit_cents BIGINT NOT NULL CHECK (limit_cents > 0),
  alert_threshold_pct INTEGER NOT NULL DEFAULT 80 CHECK (alert_threshold_pct BETWEEN 1 AND 100),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_id, month_key, category_id),
  FOREIGN KEY (owner_id, category_id) REFERENCES public.categories(owner_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  target_cents BIGINT NOT NULL CHECK (target_cents > 0),
  reserved_cents BIGINT NOT NULL DEFAULT 0 CHECK (reserved_cents >= 0),
  deadline_date DATE,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_id, id)
);

CREATE TABLE IF NOT EXISTS public.goal_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_id UUID NOT NULL,
  amount_cents BIGINT NOT NULL,
  contribution_date DATE NOT NULL,
  linked_movement_id UUID,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (owner_id, goal_id) REFERENCES public.goals(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, linked_movement_id) REFERENCES public.account_movements(owner_id, id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.category_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 100,
  match_text TEXT NOT NULL,
  account_id UUID,
  target_category_id UUID NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (owner_id, account_id) REFERENCES public.accounts(owner_id, id) ON DELETE SET NULL,
  FOREIGN KEY (owner_id, target_category_id) REFERENCES public.categories(owner_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.idempotency_records (
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  operation_key TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  response_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner_id, operation_key)
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  action TEXT NOT NULL,
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para performance (meta: 50 mil movimentos <= 2s)
CREATE INDEX IF NOT EXISTS idx_movements_owner_acc_date ON public.account_movements(owner_id, account_id, effective_date) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_events_owner_comp_nature ON public.financial_events(owner_id, competence_date, nature) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_obligations_owner_due ON public.obligations(owner_id, due_date, status);
CREATE INDEX IF NOT EXISTS idx_batches_owner_hash ON public.import_batches(owner_id, account_id, file_hash);

-- Habilitar Row Level Security (RLS) em todas as tabelas privadas
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfer_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.installment_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goal_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Policies estritas: somente o proprietário autenticado (auth.uid() = owner_id), nenhum acesso para anon
CREATE POLICY profiles_owner_only ON public.profiles FOR ALL USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY accounts_owner_only ON public.accounts FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY cards_owner_only ON public.cards FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY categories_owner_only ON public.categories FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY projects_owner_only ON public.projects FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY transfer_groups_owner_only ON public.transfer_groups FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY financial_events_owner_only ON public.financial_events FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY allocations_owner_only ON public.allocations FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY account_movements_owner_only ON public.account_movements FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY recurrences_owner_only ON public.recurrences FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY installment_plans_owner_only ON public.installment_plans FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY obligations_owner_only ON public.obligations FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY settlements_owner_only ON public.settlements FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY import_profiles_owner_only ON public.import_profiles FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY import_batches_owner_only ON public.import_batches FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY import_rows_owner_only ON public.import_rows FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY external_identities_owner_only ON public.external_identities FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY source_links_owner_only ON public.source_links FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY import_jobs_owner_only ON public.import_jobs FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY reconciliations_owner_only ON public.reconciliations FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY budgets_owner_only ON public.budgets FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY goals_owner_only ON public.goals FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY goal_contributions_owner_only ON public.goal_contributions FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY category_rules_owner_only ON public.category_rules FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY idempotency_owner_only ON public.idempotency_records FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY audit_logs_select_owner_only ON public.audit_logs FOR SELECT USING (auth.uid() = owner_id);

-- Revogar escrita direta em movimentos/transferências/auditoria para forçar uso de RPCs transacionais
REVOKE INSERT, UPDATE, DELETE ON public.transfer_groups FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.audit_logs FROM anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;

-- Função transacional: criar transferência atômica de 2 pernas com idempotência
CREATE OR REPLACE FUNCTION public.rpc_create_transfer(
  p_operation_key TEXT,
  p_nature TEXT,
  p_from_account_id UUID,
  p_to_account_id UUID,
  p_amount_cents BIGINT,
  p_effective_date DATE,
  p_description TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner_id UUID := auth.uid();
  v_existing JSONB;
  v_group_id UUID;
  v_out_id UUID;
  v_in_id UUID;
  v_result JSONB;
BEGIN
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida';
  END IF;
  IF p_amount_cents <= 0 OR p_from_account_id = p_to_account_id THEN
    RAISE EXCEPTION 'Parâmetros de transferência inválidos';
  END IF;

  SELECT response_payload INTO v_existing
  FROM public.idempotency_records
  WHERE owner_id = v_owner_id AND operation_key = p_operation_key;
  IF FOUND THEN
    RETURN v_existing;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = p_from_account_id AND owner_id = v_owner_id)
     OR NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = p_to_account_id AND owner_id = v_owner_id) THEN
    RAISE EXCEPTION 'Conta não pertence ao usuário autenticado';
  END IF;

  INSERT INTO public.transfer_groups (owner_id, nature, from_account_id, to_account_id, amount_cents, effective_date, description)
  VALUES (v_owner_id, p_nature, p_from_account_id, p_to_account_id, p_amount_cents, p_effective_date, p_description)
  RETURNING id INTO v_group_id;

  INSERT INTO public.account_movements (owner_id, account_id, transfer_group_id, signed_cents, effective_date, description, origin)
  VALUES (v_owner_id, p_from_account_id, v_group_id, -p_amount_cents, p_effective_date, p_description || ' (Saída)', 'system_transfer')
  RETURNING id INTO v_out_id;

  INSERT INTO public.account_movements (owner_id, account_id, transfer_group_id, signed_cents, effective_date, description, origin)
  VALUES (v_owner_id, p_to_account_id, v_group_id, p_amount_cents, p_effective_date, p_description || ' (Entrada)', 'system_transfer')
  RETURNING id INTO v_in_id;

  INSERT INTO public.audit_logs (owner_id, entity_type, entity_id, action, metadata)
  VALUES (v_owner_id, 'transfer_group', v_group_id, 'create_transfer', jsonb_build_object('amount_cents', p_amount_cents::text));

  v_result := jsonb_build_object('transfer_group_id', v_group_id, 'out_movement_id', v_out_id, 'in_movement_id', v_in_id);

  INSERT INTO public.idempotency_records (owner_id, operation_key, endpoint, response_payload)
  VALUES (v_owner_id, p_operation_key, 'rpc_create_transfer', v_result);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_create_transfer(TEXT, TEXT, UUID, UUID, BIGINT, DATE, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_create_transfer(TEXT, TEXT, UUID, UUID, BIGINT, DATE, TEXT) TO authenticated;
