import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsvStatement, buildSafeCsvExport } from './csvParser';
import { parseOfxStatement } from './ofxParser';
import { evaluateImportRows } from './deduplicator';

test('CSV: suporta BOM, delimitador ponto-e-vírgula, aspas multilinha, linha de saldo ignorada e fórmula exportada neutralizada', () => {
  const csv = `\uFEFFExtrato Conta Corrente
Data;Descrição;Valor;ID
05/11/2026;"Compra ""Mercado\nCentral""";-150,45;TX-01
06/11/2026;Saldo Anterior;1000,00;
07/11/2026;Pix Recebido;500,00;TX-02`;

  const parsed = parseCsvStatement(csv, { dateFormat: 'DD/MM/YYYY' });
  assert.equal(parsed.detectedDelimiter, ';');
  assert.equal(parsed.summaryLinesSkipped, 1);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].normalizedDate, '2026-11-05');
  assert.equal(parsed.rows[0].normalizedCents, -15045);
  assert.equal(parsed.rows[1].normalizedCents, 50000);

  const exported = buildSafeCsvExport(['Descrição', 'Valor'], [['=CMD|calc', 1500]]);
  assert.ok(exported.includes("'=CMD|calc"));
});

test('OFX: suporta 1.x SGML sem fechamento, bloqueia XXE e bloqueia moeda não-BRL', () => {
  const sgml = `OFXHEADER:100
DATA:OFXSGML
<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<CURDEF>BRL
<BANKACCTFROM>
<BANKID>0341
<ACCTID>12345-6
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261110120000[-3:BRT]
<TRNAMT>-89.90
<FITID>FIT-100
<MEMO>PADARIA CENTRAL
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`;

  const res = parseOfxStatement(sgml);
  assert.equal(res.securityBlocked, false);
  assert.equal(res.currencyBlocked, false);
  assert.equal(res.bankId, '0341');
  assert.equal(res.acctId, '12345-6');
  assert.equal(res.transactions.length, 1);
  assert.equal(res.transactions[0].normalizedDate, '2026-11-10');
  assert.equal(res.transactions[0].signedCents, -8990);
  assert.equal(res.transactions[0].fitid, 'FIT-100');

  const xxe = `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><OFX></OFX>`;
  const blocked = parseOfxStatement(xxe);
  assert.equal(blocked.securityBlocked, true);

  const usd = sgml.replace('<CURDEF>BRL', '<CURDEF>USD');
  const blockedUsd = parseOfxStatement(usd);
  assert.equal(blockedUsd.currencyBlocked, true);
  assert.ok(blockedUsd.transactions[0].validationErrors.length > 0);
});

test('Deduplicação: FITID idêntico detecta duplicata, FITID divergente gera conflito e contas distintas coexistem', () => {
  const existingIdentities = [
    {
      id: 'ei-1',
      ownerId: 'u1',
      accountId: 'acc-1',
      institutionKey: '0341',
      accountKey: '12345',
      fitid: 'FIT-99',
      movementId: 'mov-1',
      effectiveDate: '2026-11-10',
      signedCents: -5000,
    },
  ];

  // Mesma conta, mesmo FITID e mesmo valor/data -> already_exists
  const dup = evaluateImportRows(
    [
      {
        id: 'r1',
        batchId: 'b1',
        rowIndex: 1,
        rawPayload: {},
        normalizedDate: '2026-11-10',
        normalizedDescription: 'Café',
        normalizedCents: -5000,
        externalFitid: 'FIT-99',
        validationErrors: [],
      },
    ],
    {
      accountId: 'acc-1',
      institutionKey: '0341',
      accountKey: '12345',
      existingMovements: [],
      externalIdentities: existingIdentities,
      rules: [],
    }
  );
  assert.equal(dup[0].decision, 'already_exists');

  // Mesma conta, mesmo FITID, valor divergente -> conflito explícito
  const conflict = evaluateImportRows(
    [
      {
        id: 'r2',
        batchId: 'b1',
        rowIndex: 1,
        rawPayload: {},
        normalizedDate: '2026-11-10',
        normalizedDescription: 'Café',
        normalizedCents: -7500,
        externalFitid: 'FIT-99',
        validationErrors: [],
      },
    ],
    {
      accountId: 'acc-1',
      institutionKey: '0341',
      accountKey: '12345',
      existingMovements: [],
      externalIdentities: existingIdentities,
      rules: [],
    }
  );
  assert.equal(conflict[0].decision, 'review_later');
  assert.ok(conflict[0].validationErrors.some((e) => e.includes('Conflito de FITID')));

  // Outra conta com mesmo FITID -> import_new (FITID não é global)
  const otherAcc = evaluateImportRows(
    [
      {
        id: 'r3',
        batchId: 'b1',
        rowIndex: 1,
        rawPayload: {},
        normalizedDate: '2026-11-10',
        normalizedDescription: 'Café',
        normalizedCents: -5000,
        externalFitid: 'FIT-99',
        validationErrors: [],
      },
    ],
    {
      accountId: 'acc-2',
      institutionKey: '0341',
      accountKey: '99999',
      existingMovements: [],
      externalIdentities: existingIdentities,
      rules: [],
    }
  );
  assert.equal(otherAcc[0].decision, 'import_new');
});
