import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeInvestmentReturns, computeMonthlyTrend } from './analytics.ts';
import type { WorkspaceData, Account, FinancialEvent, AccountMovement, TransferGroup } from './types.ts';

const acc = (over: Partial<Account>): Account => ({
  id: 'a1', ownerId: 'u', name: 'Conta', type: 'checking', currency: 'BRL', color: '#000',
  openingBalanceCents: 0, openingDate: '2026-01-01', openingBalanceKnown: true,
  includeInLiquidity: true, isArchived: false, version: 1, ...over,
});
const ev = (id: string, nature: FinancialEvent['nature'], competenceDate: string, magnitudeCents: number): FinancialEvent => ({
  id, ownerId: 'u', nature, description: id, competenceDate, magnitudeCents, currency: 'BRL', tags: [], isDeleted: false, version: 1,
});
const mov = (id: string, accountId: string, signedCents: number, effectiveDate: string, extra: Partial<AccountMovement> = {}): AccountMovement => ({
  id, ownerId: 'u', accountId, signedCents, effectiveDate, description: id, origin: 'manual',
  reviewStatus: 'reviewed', reconciliationStatus: 'unreconciled', isDeleted: false, version: 1, createdAt: '2026-01-01', ...extra,
});
const base = (over: Partial<WorkspaceData>): WorkspaceData => ({
  profile: { id: 'u', email: 'x', displayName: 'x', currency: 'BRL', timezone: 'America/Sao_Paulo', theme: 'light', privacyMode: false },
  accounts: [], cards: [], categories: [], projects: [], events: [], movements: [], transferGroups: [], recurrences: [],
  installmentPlans: [], obligations: [], settlements: [], importBatches: [], externalIdentities: [], sourceLinks: [],
  importProfiles: [], reconciliations: [], budgets: [], goals: [], goalContributions: [], categoryRules: [], auditLogs: [],
  dismissedInsightIds: [], ...over,
});

test('tendência: receitas, despesas (com estorno) e saldo de fim de mês', () => {
  const data = base({
    accounts: [acc({ id: 'c', openingBalanceCents: 100000 })],
    events: [
      ev('r1', 'income', '2026-11-05', 500000),
      ev('d1', 'expense', '2026-11-10', 120000),
      ev('f1', 'refund', '2026-11-12', 20000),
      ev('d0', 'expense', '2026-10-03', 50000),
    ],
    movements: [mov('m1', 'c', 500000, '2026-11-05'), mov('m2', 'c', -120000, '2026-11-10')],
  });
  const { points, liquidityIsPartial } = computeMonthlyTrend(data, '2026-11', 3);
  assert.deepEqual(points.map((p) => p.monthKey), ['2026-09', '2026-10', '2026-11']);
  const nov = points[2];
  assert.equal(nov.incomeCents, 500000);
  assert.equal(nov.expenseCents, 100000);
  assert.equal(nov.resultCents, 400000);
  assert.equal(nov.liquidityEndCents, 100000 + 500000 - 120000);
  assert.equal(points[1].expenseCents, 50000);
  assert.equal(liquidityIsPartial, false);
});

test('tendência marca parcial quando o saldo inicial de uma conta é desconhecido', () => {
  const data = base({ accounts: [acc({ id: 'c', openingBalanceKnown: false })] });
  const { points, liquidityIsPartial } = computeMonthlyTrend(data, '2026-11', 1);
  assert.equal(points[0].liquidityEndCents, null);
  assert.equal(liquidityIsPartial, true);
});

test('rendimento: capital = saldo inicial + aportes; ganho = saldo - capital', () => {
  const inv = acc({ id: 'i', name: 'Tesouro', type: 'investment_manual', openingBalanceCents: 100000, includeInLiquidity: false });
  const tg: TransferGroup = {
    id: 't1', ownerId: 'u', nature: 'investment_aport', fromAccountId: 'c', toAccountId: 'i',
    amountCents: 50000, effectiveDate: '2026-11-02', description: 'aporte',
  };
  const data = base({
    accounts: [inv],
    transferGroups: [tg],
    movements: [mov('leg', 'i', 50000, '2026-11-02'), mov('rend', 'i', 10000, '2026-11-30')],
  });
  const [r] = computeInvestmentReturns(data);
  assert.equal(r.capitalCents, 150000);
  assert.equal(r.currentCents, 160000);
  assert.equal(r.gainCents, 10000);
  assert.equal(r.gainPct, 6.7);
  assert.equal(r.hasContributions, true);
});

test('saldo de fim de mês é vazio antes da abertura da conta', () => {
  const data = base({ accounts: [acc({ id: 'c', openingBalanceCents: 1600000, openingDate: '2026-06-01' })] });
  const { points, liquidityIsPartial } = computeMonthlyTrend(data, '2026-06', 2);
  assert.equal(points[0].liquidityEndCents, null);
  assert.equal(points[1].liquidityEndCents, 1600000);
  assert.equal(liquidityIsPartial, false);
});
