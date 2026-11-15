import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCardDebtSummary } from './ledger.ts';
import type { Account, AccountMovement, Card, InstallmentPlan, Obligation } from './types.ts';

const account: Account = {
  id: 'acc', ownerId: 'u', name: 'Cartão', type: 'credit_card', currency: 'BRL', color: '#000',
  openingBalanceCents: 0, openingDate: '2026-10-01', openingBalanceKnown: true,
  includeInLiquidity: false, isArchived: false, version: 1,
};
const card: Card = {
  id: 'card', ownerId: 'u', accountId: 'acc', name: 'Platinum', creditLimitCents: 255000,
  limitVerified: true, closingDay: 26, dueDay: 3, isArchived: false, version: 1,
};
const mov = (id: string, cents: number, date: string): AccountMovement => ({
  id, ownerId: 'u', accountId: 'acc', signedCents: cents, effectiveDate: date, description: id,
  origin: 'ofx', reviewStatus: 'reviewed', reconciliationStatus: 'unreconciled', isDeleted: false, version: 1, createdAt: date,
});
const ob = (id: string, planId: string, index: number, cents: number): Obligation => ({
  id, ownerId: 'u', direction: 'payable', description: id, dueDate: '2027-01-03', competenceDate: '2026-12-26',
  originalCents: cents, canceledCents: 0, status: 'expected', cardId: 'card', installmentPlanId: planId,
  installmentIndex: index, version: 1,
});

test('parcela futura importada também ocupa o limite (caso da fatura Nubank)', () => {
  // Dívida do ciclo R$ 2.391,66, já com a parcela 2/3 da Amigão; a 3/3 (R$ 140,25) ainda vai cair
  const plan: InstallmentPlan = {
    id: 'p1', ownerId: 'u', cardId: 'card', description: 'Cp *Amigao', totalContractedCents: 42075,
    installmentCount: 3, purchaseDate: '2026-10-27',
  };
  const movements = [mov('outras', -225141, '2026-11-10'), mov('amigao-2', -14025, '2026-10-27')];
  const s = computeCardDebtSummary(card, account, movements, [ob('amigao-3', 'p1', 3, 14025)], [], [plan]);
  assert.equal(s.debtCents, 239166);
  assert.equal(s.futureInstallmentsCents, 14025);
  assert.equal(s.futureNotInDebtCents, 14025);
  // 2.550,00 - 2.391,66 - 140,25 = 18,09
  assert.equal(s.availableEstimatedCents, 1809);
});

test('compra parcelada manual não é descontada duas vezes (total já está na dívida)', () => {
  const plan: InstallmentPlan = {
    id: 'p2', ownerId: 'u', cardId: 'card', description: 'TV', totalContractedCents: 30000,
    installmentCount: 3, purchaseDate: '2026-11-01',
  };
  const movements = [mov('tv-3x', -30000, '2026-11-01')];
  const obs = [ob('tv-1', 'p2', 1, 10000), ob('tv-2', 'p2', 2, 10000), ob('tv-3', 'p2', 3, 10000)];
  const s = computeCardDebtSummary(card, account, movements, obs, [], [plan]);
  assert.equal(s.debtCents, 30000);
  assert.equal(s.futureNotInDebtCents, 0);
  assert.equal(s.availableEstimatedCents, 255000 - 30000);
});

test('disponível nunca fica negativo', () => {
  const s = computeCardDebtSummary(card, account, [mov('x', -260000, '2026-11-01')], [ob('f', 'p9', 2, 5000)], [], []);
  assert.equal(s.availableEstimatedCents, 0);
});
