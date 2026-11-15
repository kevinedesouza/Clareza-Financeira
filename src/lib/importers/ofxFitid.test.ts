import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processImportPayload } from '../../../workers/importWorker.ts';

// Trecho no formato do OFX de cartão do Nubank: a compra internacional e o IOF dela com o MESMO FITID
const OFX = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>BRL
<CCACCTFROM><ACCTID>conta-cartao</ACCTID></CCACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20261112000000[-3:BRT]</DTPOSTED><TRNAMT>-4.00</TRNAMT><FITID>abc</FITID><MEMO>IOF de compra internacional</MEMO></STMTTRN>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20261112000000[-3:BRT]</DTPOSTED><TRNAMT>-114.40</TRNAMT><FITID>abc</FITID><MEMO>Anthropic* Claude Sub</MEMO></STMTTRN>
</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;

const run = (externalIdentities: any[] = []) =>
  processImportPayload({
    batchId: 'b',
    ownerId: 'u',
    accountId: 'card-acc',
    fileName: 'nubank.ofx',
    format: 'ofx',
    fileBytes: new TextEncoder().encode(OFX),
    existingMovements: [],
    externalIdentities,
    rules: [],
    accountType: 'credit_card',
  });

test('FITID repetido no arquivo: as duas linhas entram, cada uma com identidade própria', () => {
  const { batch } = run();
  assert.equal(batch.rows.length, 2);
  assert.deepEqual(batch.rows.map((r) => r.externalFitid), ['abc', 'abc#2']);
  assert.ok(batch.rows.every((r) => r.decision === 'import_new'));
});

test('reimportar o mesmo OFX reconhece as duas linhas como já existentes (sem conflito no IOF)', () => {
  const first = run().batch.rows;
  const identities = first.map((r, i) => ({
    id: `ei${i}`,
    ownerId: 'u',
    accountId: 'card-acc',
    institutionKey: r.externalInstitution,
    accountKey: r.externalAccount,
    fitid: r.externalFitid,
    movementId: `m${i}`,
    effectiveDate: r.normalizedDate,
    signedCents: r.normalizedCents,
  }));
  const again = run(identities).batch.rows;
  assert.deepEqual(again.map((r) => r.decision), ['already_exists', 'already_exists']);
});
