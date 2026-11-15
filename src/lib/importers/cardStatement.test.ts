import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  currentCycleStart,
  futureInstallmentDates,
  invoiceFor,
  isCardPayment,
  parseInstallment,
} from './cardStatement.ts';

test('parseInstallment reconhece parcela N/M e separa a descrição', () => {
  assert.deepEqual(parseInstallment('Cp *Amigao 35 V. Redon - Parcela 2/3'), { base: 'Cp *Amigao 35 V. Redon', index: 2, total: 3 });
  assert.deepEqual(parseInstallment('Kalunga Volt*Kalunga - Parcela 10/10'), { base: 'Kalunga Volt*Kalunga', index: 10, total: 10 });
  assert.equal(parseInstallment('Uber *Trip'), null);
  assert.equal(parseInstallment('Loja - Parcela 1/1'), null);
  assert.equal(parseInstallment('Parcela 2/3'), null);
});

test('isCardPayment identifica pagamento de fatura, não compras', () => {
  assert.equal(isCardPayment('Pagamento recebido'), true);
  assert.equal(isCardPayment('Pagamento da fatura'), true);
  assert.equal(isCardPayment('Uber *Trip'), false);
  assert.equal(isCardPayment('Pagamento de boleto'), false);
});

test('compra cai na fatura do próximo fechamento (fechamento dia 26, vencimento dia 3)', () => {
  // 27/10 passa do fechamento de 26/10: fatura fecha 26/11 e vence 03/12
  assert.deepEqual(invoiceFor('2026-10-27', 26, 3), { closeDate: '2026-11-26', dueDate: '2026-12-03' });
  // 26/10 ainda é do fechamento de 26/10, vence 03/11
  assert.deepEqual(invoiceFor('2026-10-26', 26, 3), { closeDate: '2026-10-26', dueDate: '2026-11-03' });
  assert.deepEqual(invoiceFor('2026-11-14', 26, 3), { closeDate: '2026-11-26', dueDate: '2026-12-03' });
});

test('início do ciclo aberto em 15/11/2026 é 27/10/2026', () => {
  assert.equal(currentCycleStart(26, '2026-11-15'), '2026-10-27');
  assert.equal(currentCycleStart(26, '2026-11-26'), '2026-10-27');
  assert.equal(currentCycleStart(26, '2026-11-27'), '2026-11-27');
});

test('parcelas futuras caem nas faturas seguintes', () => {
  // Amigão 2/3 comprado em 27/10: a 3/3 cai na fatura de 26/12, vence 03/01/2027
  assert.deepEqual(futureInstallmentDates({ base: 'x', index: 2, total: 3 }, '2026-10-27', 26, 3), [
    { index: 3, closeDate: '2026-12-26', dueDate: '2027-01-03' },
  ]);
  // Kalunga 10/10 não tem parcelas futuras
  assert.deepEqual(futureInstallmentDates({ base: 'y', index: 10, total: 10 }, '2026-10-27', 26, 3), []);
});
