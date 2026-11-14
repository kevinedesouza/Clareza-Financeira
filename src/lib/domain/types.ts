export type AccountType =
  | 'checking'
  | 'savings'
  | 'cash'
  | 'digital_wallet'
  | 'investment_manual'
  | 'credit_card';

export type EventNature =
  | 'income'
  | 'expense'
  | 'transfer'
  | 'opening'
  | 'financing'
  | 'investment_flow'
  | 'refund';

export type MovementOrigin = 'manual' | 'csv' | 'ofx' | 'system_transfer';
export type ReviewStatus = 'reviewed' | 'pending_category' | 'pending_review';
export type ReconciliationStatus = 'unreconciled' | 'reconciled' | 'divergent';
export type ObligationStatus = 'expected' | 'partially_settled' | 'settled' | 'canceled';
export type TransferNature =
  | 'internal_transfer'
  | 'card_payment'
  | 'investment_aport'
  | 'investment_redemption'
  | 'loan_disbursement'
  | 'loan_principal';

export type ThemeMode = 'light' | 'dark' | 'system';

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  currency: 'BRL';
  timezone: 'America/Sao_Paulo';
  theme: ThemeMode;
  privacyMode: boolean;
}

export interface Account {
  id: string;
  ownerId: string;
  name: string;
  institution?: string;
  type: AccountType;
  currency: 'BRL';
  maskedIdentifier?: string;
  color: string;
  openingBalanceCents: number;
  openingDate: string; // YYYY-MM-DD
  openingBalanceKnown: boolean;
  includeInLiquidity: boolean;
  isArchived: boolean;
  version: number;
}

export interface Card {
  id: string;
  ownerId: string;
  accountId: string;
  name: string;
  maskedLast4?: string;
  creditLimitCents: number;
  limitVerified: boolean;
  closingDay: number;
  dueDay: number;
  payingAccountId?: string;
  isArchived: boolean;
  version: number;
}

export interface Category {
  id: string;
  ownerId: string;
  parentId?: string;
  name: string;
  kind: 'income' | 'expense' | 'transfer' | 'opening' | 'financing';
  essentiality: 'essential' | 'discretionary' | 'unassigned';
  isArchived: boolean;
}

export interface Project {
  id: string;
  ownerId: string;
  name: string;
  isArchived: boolean;
}

export interface Allocation {
  id: string;
  eventId: string;
  categoryId?: string;
  projectId?: string;
  amountCents: number;
}

export interface FinancialEvent {
  id: string;
  ownerId: string;
  nature: EventNature;
  description: string;
  competenceDate: string; // YYYY-MM-DD
  magnitudeCents: number; // Always positive integer cents
  currency: 'BRL';
  categoryId?: string;
  projectId?: string;
  tags: string[];
  refundOfEventId?: string;
  allocations?: Allocation[];
  notes?: string;
  isDeleted: boolean;
  deletedReason?: string;
  version: number;
}

export interface TransferGroup {
  id: string;
  ownerId: string;
  nature: TransferNature;
  fromAccountId: string;
  toAccountId: string;
  amountCents: number;
  effectiveDate: string; // YYYY-MM-DD
  description: string;
}

export interface AccountMovement {
  id: string;
  ownerId: string;
  accountId: string;
  eventId?: string;
  transferGroupId?: string;
  signedCents: number; // Positive inflow, negative outflow
  effectiveDate: string; // YYYY-MM-DD
  description: string;
  origin: MovementOrigin;
  reviewStatus: ReviewStatus;
  reconciliationStatus: ReconciliationStatus;
  reconciliationId?: string;
  isDeleted: boolean;
  version: number;
  createdAt: string;
}

export interface Recurrence {
  id: string;
  ownerId: string;
  direction: 'payable' | 'receivable';
  description: string;
  amountCents: number;
  frequency: 'weekly' | 'monthly' | 'yearly';
  anchorDay: number;
  startDate: string;
  endDate?: string;
  accountId?: string;
  categoryId?: string;
  isActive: boolean;
}

export interface InstallmentPlan {
  id: string;
  ownerId: string;
  cardId?: string;
  description: string;
  totalContractedCents: number;
  installmentCount: number;
  purchaseDate: string;
  categoryId?: string;
}

export interface Obligation {
  id: string;
  ownerId: string;
  direction: 'payable' | 'receivable';
  description: string;
  dueDate: string; // YYYY-MM-DD
  competenceDate: string; // YYYY-MM-DD
  originalCents: number;
  canceledCents: number;
  status: ObligationStatus;
  accountId?: string;
  cardId?: string;
  categoryId?: string;
  recurrenceId?: string;
  installmentPlanId?: string;
  installmentIndex?: number;
  version: number;
}

export interface Settlement {
  id: string;
  ownerId: string;
  obligationId: string;
  movementId: string;
  allocatedCents: number;
  createdAt: string;
}

export type ImportDecision =
  | 'pending'
  | 'import_new'
  | 'already_exists'
  | 'is_distinct'
  | 'link_manual'
  | 'review_later'
  | 'excluded_invalid';

export interface ImportRow {
  id: string;
  batchId: string;
  rowIndex: number;
  rawPayload: Record<string, string>;
  normalizedDate?: string;
  normalizedDescription?: string;
  normalizedCents?: number;
  externalFitid?: string;
  externalInstitution?: string;
  externalAccount?: string;
  suggestedCategoryId?: string;
  suggestionSource?: 'rule' | 'ai';
  suggestionConfidence?: number;
  candidateMovementId?: string;
  candidateReason?: string;
  decision: ImportDecision;
  validationErrors: string[];
  createdMovementId?: string;
}

export interface ImportBatch {
  id: string;
  ownerId: string;
  accountId: string;
  fileName: string;
  fileSizeBytes: number;
  fileHash: string;
  format: 'csv' | 'ofx';
  parserVersion: string;
  status: 'uploaded' | 'parsing' | 'awaiting_review' | 'committed' | 'reverted' | 'failed';
  totalRows: number;
  validRows: number;
  linkedRows: number;
  ignoredRows: number;
  rejectedRows: number;
  errorMessage?: string;
  rows: ImportRow[];
  createdAt: string;
  committedAt?: string;
}

export interface ExternalIdentity {
  id: string;
  ownerId: string;
  accountId: string;
  institutionKey: string;
  accountKey: string;
  fitid: string;
  movementId: string;
  effectiveDate: string;
  signedCents: number;
}

export interface SourceLink {
  id: string;
  ownerId: string;
  movementId: string;
  batchId?: string;
  importRowId?: string;
  sourceKind: 'manual' | 'csv' | 'ofx';
  createdAt: string;
}

export interface ImportProfile {
  id: string;
  ownerId: string;
  name: string;
  bankSignature: string;
  delimiter: ',' | ';' | '\t';
  encoding: 'utf-8' | 'windows-1252';
  dateFormat: 'DD/MM/YYYY' | 'YYYY-MM-DD';
  decimalSeparator: ',' | '.';
  columnMap: {
    date: string;
    description: string;
    amount?: string;
    credit?: string;
    debit?: string;
    fitid?: string;
    balance?: string;
  };
}

export interface Reconciliation {
  id: string;
  ownerId: string;
  accountId: string;
  cutoffDate: string;
  reportedBalanceCents: number;
  calculatedBalanceCents: number;
  differenceCents: number;
  status: 'matched' | 'divergent' | 'invalidated';
  invalidationReason?: string;
  createdAt: string;
}

export interface Budget {
  id: string;
  ownerId: string;
  monthKey: string; // YYYY-MM
  categoryId: string;
  limitCents: number;
  alertThresholdPct: number;
  version: number;
}

export interface Goal {
  id: string;
  ownerId: string;
  name: string;
  targetCents: number;
  reservedCents: number;
  deadlineDate?: string;
  version: number;
}

export interface GoalContribution {
  id: string;
  ownerId: string;
  goalId: string;
  amountCents: number;
  contributionDate: string;
  linkedMovementId?: string;
  note?: string;
}

export interface CategoryRule {
  id: string;
  ownerId: string;
  priority: number;
  matchText: string;
  accountId?: string;
  targetCategoryId: string;
  isActive: boolean;
}

export interface AuditLog {
  id: string;
  ownerId: string;
  entityType: string;
  entityId: string;
  action: string;
  reason?: string;
  metadata?: Record<string, string | number | boolean>;
  createdAt: string;
}

export interface InsightItem {
  id: string;
  ruleKey:
    | 'category_growth'
    | 'budget_threshold'
    | 'negative_projection'
    | 'possible_subscription'
    | 'duplicate_charge'
    | 'fees_interest'
    | 'outlier_expense'
    | 'pending_data'
    | 'goal_behind';
  severity: 'info' | 'warning' | 'danger';
  title: string;
  observation: string;
  formula: string;
  periodLabel: string;
  confidenceNote: string;
  isEstimate?: boolean;
  evidenceMovementIds: string[];
  evidenceLabel: string;
  actionLabel: string;
  actionTarget: string;
  status: 'active' | 'dismissed' | 'snoozed' | 'resolved';
}

export interface WorkspaceData {
  profile: UserProfile;
  accounts: Account[];
  cards: Card[];
  categories: Category[];
  projects: Project[];
  events: FinancialEvent[];
  movements: AccountMovement[];
  transferGroups: TransferGroup[];
  recurrences: Recurrence[];
  installmentPlans: InstallmentPlan[];
  obligations: Obligation[];
  settlements: Settlement[];
  importBatches: ImportBatch[];
  externalIdentities: ExternalIdentity[];
  sourceLinks: SourceLink[];
  importProfiles: ImportProfile[];
  reconciliations: Reconciliation[];
  budgets: Budget[];
  goals: Goal[];
  goalContributions: GoalContribution[];
  categoryRules: CategoryRule[];
  auditLogs: AuditLog[];
  dismissedInsightIds: string[];
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
