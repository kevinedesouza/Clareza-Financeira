import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processImportPayload } from '../../../workers/importWorker.ts';

// Extrato de fatura fictício (mesmo formato do Nubank: compras positivas, pagamento negativo).
const CSV = [
  'date,title,amount',
  '2026-10-26,Compra antiga,"30,00"',
  '2026-10-27,Loja A,"10,00"',
  '2026-10-28,Cp *Amigao - Parcela 2/3,"140,25"',
  '2026-11-01,Pagamento recebido,"- 2.214,83"',
  '2026-11-02,Uber *Trip,"19,90"',
].join('\n');

function run(extra: Partial<Parameters<typeof processImportPayload>[0]> = {}) {
  return processImportPayload({
    batchId: 'b1',
    ownerId: 'u1',
    accountId: 'acc-card',
    fileName: 'fatura.csv',
    format: 'csv',
    fileBytes: new TextEncoder().encode(CSV),
    existingMovements: [],
    externalIdentities: [],
    rules: [],
    accountType: 'credit_card',
    csvOptions: { dateFormat: 'YYYY-MM-DD', positiveIsExpense: true, importFromDate: '2026-10-27' },
    ...extra,
  });
}

test('linhas antes do início do controle não são importadas', () => {
  const { batch } = run();
  const old = batch.rows.find((r) => r.normalizedDate === '2026-10-26')!;
  assert.equal(old.decision, 'excluded_invalid');
  assert.match(old.candidateReason ?? '', /Anterior ao início do controle \(27\/10\/2026\)/);
});

test('compras do ciclo entram como despesa do cartão (valor positivo invertido)', () => {
  const { batch } = run();
  const shop = batch.rows.find((r) => r.normalizedDate === '2026-10-27')!;
  assert.notEqual(shop.decision, 'excluded_invalid');
  assert.equal(shop.normalizedCents, -1000);
  const uber = batch.rows.find((r) => r.normalizedDescription === 'Uber *Trip')!;
  assert.equal(uber.normalizedCents, -1990);
});

test('pagamento de fatura não é importado como gasto do cartão', () => {
  const { batch, warnings } = run();
  const pay = batch.rows.find((r) => /pagamento/i.test(r.normalizedDescription ?? ''))!;
  assert.equal(pay.decision, 'excluded_invalid');
  assert.match(pay.candidateReason ?? '', /Pagamento da fatura/);
  assert.ok(warnings.some((w) => /pagamento\(s\) de fatura/.test(w)));
});

test('conta corrente não aplica as regras de fatura', () => {
  const { batch } = run({ accountType: 'checking', csvOptions: { dateFormat: 'YYYY-MM-DD' } });
  const pay = batch.rows.find((r) => /pagamento/i.test(r.normalizedDescription ?? ''))!;
  assert.notEqual(pay.decision, 'excluded_invalid');
});
