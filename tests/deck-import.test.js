import test from 'node:test';
import assert from 'node:assert/strict';
import db from '../src/data/generated/cards.json' with { type: 'json' };
import decks from '../src/data/generated/decks.json' with { type: 'json' };
import { buildCustomDeck, parseMassEntry } from '../src/utils/deckImport.js';

const commander = db.hakbal.name;
test('TCGPlayer-style mass entry parser supports quantities, x syntax, and set decorations', () => {
  const parsed = parseMassEntry('1 Sol Ring\n2x Island\n3 Forest\n1 Arcane Signet [CMM] 380');
  assert.equal(parsed.count, 7);
  assert.equal(parsed.errors.length, 0);
  assert.deepEqual(parsed.entries.map(x => x.quantity), [1, 2, 3, 1]);
});

test('custom deck importer builds the runtime deck schema and resolves TCGPlayer set suffixes', () => {
  // Use the stock Explorers list to guarantee a legal supported 99 in the current local DB.
  const stock = structuredClone(decks.find(d => d.id === 'explorers'));
  const lines = stock.cards
    .filter(entry => entry.id !== stock.commander)
    .map(entry => `${entry.quantity} ${db[entry.id].name}${entry.id === 'sol-ring' ? ' [CMM] 396' : ''}`)
    .join('\n');
  const custom = buildCustomDeck({ name: 'Imported Explorers', commander, list: lines }, db, []);
  assert.equal(custom.custom, true);
  assert.equal(custom.cardCount, 100);
  assert.equal(custom.commander, 'hakbal');
  assert.equal(custom.cards.reduce((sum, entry) => sum + entry.quantity, 0), 100);
});

test('custom deck importer rejects lists that are not exactly 99 main-deck cards', () => {
  assert.throws(() => buildCustomDeck({ name: 'Too Short', commander, list: '1 Sol Ring' }, db), /exactly 99 cards/);
});
