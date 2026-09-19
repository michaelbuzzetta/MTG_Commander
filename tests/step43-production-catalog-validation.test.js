import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBulkBuffer, validateBulk } from '../scripts/sync-scryfall-catalog.mjs';

function oracleCards(count = 10_000) {
  return Array.from({ length: count }, (_, i) => ({ id: `oracle-print-${i}`, oracle_id: `oracle-${i}`, name: `Oracle Card ${i}` }));
}
function printingCards(count = 10_000) {
  return Array.from({ length: count }, (_, i) => ({ id: `printing-${i}`, oracle_id: `oracle-${i}`, name: `Printing ${i}` }));
}

test('Step 43 production validation accepts a structurally complete unique Oracle/default-card pair', () => {
  assert.doesNotThrow(() => validateBulk(oracleCards(), printingCards()));
});

test('Step 43 production validation rejects duplicate Oracle identities even when record count looks complete', () => {
  const oracle = oracleCards();
  oracle[9999] = { ...oracle[9999], oracle_id: oracle[0].oracle_id };
  assert.throws(() => validateBulk(oracle, printingCards()), /one-record-per-Oracle-ID/i);
});

test('Step 43 production validation rejects duplicate printing IDs', () => {
  const printings = printingCards();
  printings[9999] = { ...printings[9999], id: printings[0].id };
  assert.throws(() => validateBulk(oracleCards(), printings), /duplicate Scryfall printing IDs/i);
});

test('Step 43 production validation rejects obviously incomplete bulk files', () => {
  assert.throws(() => validateBulk(oracleCards(9999), printingCards()), /Oracle bulk input was incomplete/i);
  assert.throws(() => validateBulk(oracleCards(), printingCards(9999)), /Printing bulk input was incomplete/i);
});

test('Step 43 bulk parser supports JSON arrays and JSONL payloads', () => {
  const rows = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(parseBulkBuffer(Buffer.from(JSON.stringify(rows)), 'fixture.json'), rows);
  assert.deepEqual(parseBulkBuffer(Buffer.from(rows.map(row => JSON.stringify(row)).join('\n')), 'fixture.jsonl'), rows);
});
