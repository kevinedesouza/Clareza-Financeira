import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sbPurgeDeletedMovements, sbResetFinancialData, RESET_ORDER } from './dataMaintenance.ts';

type Row = Record<string, unknown>;
type Db = Record<string, Row[]>;

/** Cliente Supabase falso, em memória, que registra cada operação. */
function fakeClient(db: Db, log: string[], name: string) {
  const from = (table: string) => {
    let op: 'select' | 'delete' | 'update' | 'insert' = 'select';
    let payload: Row = {};
    const filters: Array<(r: Row) => boolean> = [];
    let ownerFiltered = false;
    const builder: any = {
      select() {
        return builder;
      },
      delete() {
        op = 'delete';
        return builder;
      },
      update(p: Row) {
        op = 'update';
        payload = p;
        return builder;
      },
      insert(p: Row) {
        op = 'insert';
        payload = p;
        return builder;
      },
      eq(col: string, val: unknown) {
        if (col === 'owner_id') ownerFiltered = true;
        filters.push((r) => r[col] === val);
        return builder;
      },
      in(col: string, vals: unknown[]) {
        filters.push((r) => vals.includes(r[col]));
        return builder;
      },
      then(resolve: (v: unknown) => void) {
        const rows = (db[table] ||= []);
        if (op === 'insert') {
          rows.push(payload);
          log.push(`${name}:insert:${table}`);
          return resolve({ data: null, error: null });
        }
        if (op !== 'select' && !ownerFiltered) throw new Error(`${op} em ${table} sem filtro owner_id`);
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        if (op === 'select') return resolve({ data: hit, error: null });
        if (op === 'update') {
          hit.forEach((r) => Object.assign(r, payload));
          return resolve({ data: null, error: null });
        }
        db[table] = rows.filter((r) => !hit.includes(r));
        log.push(`${name}:delete:${table}:${hit.length}`);
        return resolve({ data: null, error: null, count: hit.length });
      },
    };
    return builder;
  };
  const storage = {
    from: () => ({
      remove: async (paths: string[]) => {
        log.push(`${name}:storage:${paths.length}`);
        return { error: null };
      },
    }),
  };
  return { from, storage } as any;
}

const ME = 'me';
const OTHER = 'other';

function seed(): Db {
  return {
    accounts: [{ id: 'a1', owner_id: ME }, { id: 'a9', owner_id: OTHER }],
    cards: [{ id: 'c1', owner_id: ME }],
    categories: [{ id: 'k1', owner_id: ME }],
    account_movements: [
      { id: 'm1', owner_id: ME, is_deleted: false, event_id: 'e1' },
      { id: 'm2', owner_id: ME, is_deleted: true, event_id: 'e2' },
      { id: 'm3', owner_id: ME, is_deleted: true, event_id: 'e1' },
      { id: 'mx', owner_id: OTHER, is_deleted: true, event_id: 'ex' },
    ],
    financial_events: [
      { id: 'e1', owner_id: ME, is_deleted: true },
      { id: 'e2', owner_id: ME, is_deleted: true },
      { id: 'e3', owner_id: ME, is_deleted: false },
      { id: 'ex', owner_id: OTHER, is_deleted: true },
    ],
    settlements: [{ id: 's1', owner_id: ME, movement_id: 'm2', obligation_id: 'o1' }],
    obligations: [{ id: 'o1', owner_id: ME, status: 'settled' }],
    transfer_groups: [{ id: 't1', owner_id: ME }],
    import_batches: [{ id: 'b1', owner_id: ME, storage_path: 'me/b1.ofx' }],
    audit_logs: [{ id: 'l1', owner_id: ME }],
  };
}

test('esvaziar lixeira: apaga só lançamentos excluídos do próprio usuário, liquidação antes', async () => {
  const db = seed();
  const log: string[] = [];
  const user = fakeClient(db, log, 'user');
  const admin = fakeClient(db, log, 'admin');
  const out = await sbPurgeDeletedMovements(user, admin, ME);

  assert.equal(out.removedMovements, 2);
  assert.deepEqual(db.account_movements.map((m) => m.id).sort(), ['m1', 'mx']);
  // e2 não é usado por ninguém; e1 ainda é usado por m1
  assert.equal(out.removedEvents, 1);
  assert.deepEqual(db.financial_events.map((e) => e.id).sort(), ['e1', 'e3', 'ex']);
  // a liquidação sai antes do lançamento (RESTRICT)
  assert.ok(log.indexOf('user:delete:settlements:1') < log.indexOf('user:delete:account_movements:2'));
  // a conta agendada quitada pelo lançamento apagado volta a ficar em aberto
  assert.equal(db.obligations[0].status, 'expected');
});

test('zerar dados: mantém contas, cartões, categorias e auditoria por padrão', async () => {
  const db = seed();
  const log: string[] = [];
  const out = await sbResetFinancialData(fakeClient(db, log, 'user'), fakeClient(db, log, 'admin'), ME, {
    includeAccounts: false,
    includeAudit: false,
  });
  assert.equal(out.status, 200);
  assert.equal(db.account_movements.filter((m) => m.owner_id === ME).length, 0);
  assert.equal(db.financial_events.filter((e) => e.owner_id === ME).length, 0);
  assert.equal(db.transfer_groups.length, 0);
  assert.equal(db.accounts.filter((a) => a.owner_id === ME).length, 1);
  assert.equal(db.cards.length, 1);
  assert.equal(db.categories.length, 1);
  // auditoria antiga mantida + 1 registro da operação
  assert.equal(db.audit_logs.length, 2);
  // dados de outro usuário intactos
  assert.ok(db.account_movements.some((m) => m.id === 'mx'));
  assert.ok(db.accounts.some((a) => a.id === 'a9'));
  // transferências usam o cliente de serviço; extratos removidos do Storage
  assert.ok(log.includes('admin:delete:transfer_groups:1'));
  assert.ok(log.includes('admin:storage:1'));
});

test('zerar dados com contas e auditoria: apaga também, mas deixa um registro da operação', async () => {
  const db = seed();
  const log: string[] = [];
  await sbResetFinancialData(fakeClient(db, log, 'user'), fakeClient(db, log, 'admin'), ME, {
    includeAccounts: true,
    includeAudit: true,
  });
  assert.equal(db.accounts.filter((a) => a.owner_id === ME).length, 0);
  assert.equal(db.cards.length, 0);
  assert.equal(db.categories.length, 1);
  assert.equal(db.audit_logs.length, 1);
  // cartões saem antes das contas (cartão aponta para a conta)
  assert.ok(log.findIndex((l) => l.startsWith('user:delete:cards')) < log.findIndex((l) => l.startsWith('user:delete:accounts')));
});

test('zerar dados sem chave de serviço não apaga nada', async () => {
  const db = seed();
  const log: string[] = [];
  const out = await sbResetFinancialData(fakeClient(db, log, 'user'), null, ME, { includeAccounts: true, includeAudit: true });
  assert.equal(out.status, 503);
  assert.equal(log.filter((l) => l.includes('delete')).length, 0);
});

test('ordem de exclusão: liquidações antes de lançamentos, lançamentos antes de eventos', () => {
  const order = RESET_ORDER.map((s) => s.table);
  assert.ok(order.indexOf('settlements') < order.indexOf('account_movements'));
  assert.ok(order.indexOf('account_movements') < order.indexOf('financial_events'));
  assert.ok(order.indexOf('obligations') < order.indexOf('installment_plans'));
  assert.ok(order.indexOf('installment_plans') < order.indexOf('cards'));
});
