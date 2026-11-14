import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatBRL,
  parseMoneyToCents,
  splitInstallments,
  addMonthsCivil,
} from './money';
import {
  buildReferenceScenarioWorkspace,
  computeDashboardMetrics,
  computeAccountBalance,
  computeCardDebtSummary,
  computeObligationOpenCents,
  generateRecurrenceDates,
  createEmptyWorkspace,
} from './ledger';
import { computeDeterministicInsights } from './insights';

test('money math: formatBRL, parseMoneyToCents e parcelas de R$ 1.000,00 em 3x', () => {
  assert.equal(formatBRL(123456), 'R$ 1.234,56');
  assert.equal(formatBRL(-5000), '−R$ 50,00');
  assert.equal(formatBRL(123456, { masked: true }), 'R$ •••••');

  assert.equal(parseMoneyToCents('1.234,56', ','), 123456);
  assert.equal(parseMoneyToCents('(245,90)', ','), -24590);
  assert.equal(parseMoneyToCents('-1234.56', '.'), -123456);

  const parts = splitInstallments(100000, 3);
  assert.deepEqual(parts, [33334, 33333, 33333]);
  assert.equal(
    parts.reduce((a, b) => a + b, 0),
    100000
  );
});

test('PRD §16 Cenário de Referência: ANTES de pagar fatura do cartão', () => {
  const ws = buildReferenceScenarioWorkspace(false);
  const metrics = computeDashboardMetrics(ws, {
    periodStart: '2026-11-01',
    periodEnd: '2026-11-30',
    todayDate: '2026-11-14',
  });

  const accA = computeAccountBalance(ws.accounts[0], ws.movements, ws.reconciliations, '2026-11-30');
  const accB = computeAccountBalance(ws.accounts[1], ws.movements, ws.reconciliations, '2026-11-30');
  const card = computeCardDebtSummary(ws.cards[0], ws.accounts[2], ws.movements, ws.obligations, ws.settlements);

  assert.equal(accA.balanceCents, 330000); // 1000 + 3000 - 200 - 500 = 3300
  assert.equal(accB.balanceCents, 70000);  // 200 + 500 = 700
  assert.equal(metrics.liquidityBalanceCents, 400000); // R$ 4.000
  assert.equal(metrics.incomeReceivedCents, 300000);   // R$ 3.000
  assert.equal(metrics.expensesPaidCents, 20000);      // R$ 200 (compra no cartão ainda não saiu do caixa)
  assert.equal(card.debtCents, 30000);                 // Dívida cartão R$ 300
  assert.equal(metrics.netWorthCents, 370000);         // Patrimônio R$ 3.700

  const totalCompetencia = metrics.categorySpending.reduce((a, c) => a + c.totalCents, 0);
  assert.equal(totalCompetencia, 50000); // Consumo por competência R$ 500 (mercado 200 + cartão 300)
});

test('PRD §16 Cenário de Referência: APÓS pagar fatura do cartão', () => {
  const ws = buildReferenceScenarioWorkspace(true);
  const metrics = computeDashboardMetrics(ws, {
    periodStart: '2026-11-01',
    periodEnd: '2026-11-30',
    todayDate: '2026-11-14',
  });

  const accA = computeAccountBalance(ws.accounts[0], ws.movements, ws.reconciliations, '2026-11-30');
  const accB = computeAccountBalance(ws.accounts[1], ws.movements, ws.reconciliations, '2026-11-30');
  const card = computeCardDebtSummary(ws.cards[0], ws.accounts[2], ws.movements, ws.obligations, ws.settlements);

  assert.equal(accA.balanceCents, 300000); // R$ 3.000
  assert.equal(accB.balanceCents, 70000);  // R$ 700
  assert.equal(metrics.liquidityBalanceCents, 370000); // R$ 3.700
  assert.equal(metrics.incomeReceivedCents, 300000);   // R$ 3.000
  assert.equal(metrics.expensesPaidCents, 50000);      // R$ 500 (mercado 200 + fatura 300)
  assert.equal(metrics.operatingCashResultCents, 250000); // R$ 2.500
  assert.equal(card.debtCents, 0); // Cartão quitado

  const totalCompetencia = metrics.categorySpending.reduce((a, c) => a + c.totalCents, 0);
  assert.equal(totalCompetencia, 50000); // Pagamento da fatura NÃO duplica consumo por competência!
});

test('Recorrência dia 31 ajusta para último dia do mês sem NaN nem duplicação', () => {
  assert.equal(addMonthsCivil('2026-01-31', 1, 31), '2026-02-28');
  assert.equal(addMonthsCivil('2024-01-31', 1, 31), '2024-02-29'); // ano bissexto
  assert.equal(addMonthsCivil('2026-01-31', 3, 31), '2026-04-30');

  const dates = generateRecurrenceDates(
    {
      id: 'rec-1',
      ownerId: 'u1',
      direction: 'payable',
      description: 'Condomínio',
      amountCents: 60000,
      frequency: 'monthly',
      anchorDay: 31,
      startDate: '2026-01-31',
      isActive: true,
    },
    '2026-04-30'
  );
  assert.deepEqual(dates, ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
});

test('Obrigação de R$ 500 com liquidação parcial R$ 200 mantém R$ 300 em aberto', () => {
  const ob = {
    id: 'ob-1',
    ownerId: 'u1',
    direction: 'payable' as const,
    description: 'Fornecedor',
    dueDate: '2026-11-20',
    competenceDate: '2026-11-10',
    originalCents: 50000,
    canceledCents: 0,
    status: 'partially_settled' as const,
    version: 1,
  };
  const settlements = [
    {
      id: 's1',
      ownerId: 'u1',
      obligationId: 'ob-1',
      movementId: 'm1',
      allocatedCents: 20000,
      createdAt: '2026-11-12T10:00:00Z',
    },
  ];
  assert.equal(computeObligationOpenCents(ob, settlements), 30000);
});

test('Receita zero, saldo desconhecido e mês vazio não geram NaN', () => {
  const ws = createEmptyWorkspace('u1', 'a@b.com', 'Teste');
  ws.accounts.push({
    id: 'acc-unk',
    ownerId: 'u1',
    name: 'Conta Antiga',
    type: 'checking',
    currency: 'BRL',
    color: '#2955D9',
    openingBalanceCents: 0,
    openingDate: '2026-11-01',
    openingBalanceKnown: false,
    includeInLiquidity: true,
    isArchived: false,
    version: 1,
  });

  const metrics = computeDashboardMetrics(ws, {
    periodStart: '2026-11-01',
    periodEnd: '2026-11-30',
    todayDate: '2026-11-14',
  });

  assert.equal(metrics.liquidityIsPartial, true);
  assert.equal(metrics.savingsRatePct, null);
  assert.equal(metrics.commitmentRatePct, null);
  assert.equal(Number.isNaN(metrics.liquidityBalanceCents), false);
});

test('Insights determinísticos: exemplo de aumento de Mercado R$ 180 (+24%)', () => {
  const ws = createEmptyWorkspace('u1', 'a@b.com', 'Teste');
  ws.accounts.push({
    id: 'a1',
    ownerId: 'u1',
    name: 'Conta',
    type: 'checking',
    currency: 'BRL',
    color: '#2955D9',
    openingBalanceCents: 200000,
    openingDate: '2026-10-01',
    openingBalanceKnown: true,
    includeInLiquidity: true,
    isArchived: false,
    version: 1,
  });
  // Outubro (30 dias anteriores): R$ 750 em Mercado
  ws.events.push({
    id: 'e-prev',
    ownerId: 'u1',
    nature: 'expense',
    description: 'Mercado Outubro',
    competenceDate: '2026-10-15',
    magnitudeCents: 75000,
    currency: 'BRL',
    categoryId: 'cat-exp-3',
    tags: [],
    isDeleted: false,
    version: 1,
  });
  // Novembro: R$ 930 em Mercado (+R$ 180, +24%)
  ws.events.push({
    id: 'e-curr',
    ownerId: 'u1',
    nature: 'expense',
    description: 'Mercado Novembro',
    competenceDate: '2026-11-10',
    magnitudeCents: 93000,
    currency: 'BRL',
    categoryId: 'cat-exp-3',
    tags: [],
    isDeleted: false,
    version: 1,
  });

  const insights = computeDeterministicInsights(ws, {
    periodStart: '2026-11-01',
    periodEnd: '2026-11-30',
    todayDate: '2026-11-14',
  });

  const growth = insights.find((i) => i.ruleKey === 'category_growth');
  assert.ok(growth);
  assert.ok(growth.title.includes('Mercado aumentou R$ 180,00 (+24%)'));
});
