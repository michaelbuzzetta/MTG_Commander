import test from 'node:test';
import assert from 'node:assert/strict';
import db from '../src/data/generated/cards.json' with { type: 'json' };
import decks from '../src/data/generated/decks.json' with { type: 'json' };
import { buildCustomDeck, fetchMissingCardDefinitions, importableCardName, parseMassEntry } from '../src/utils/deckImport.js';

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

test('Archidekt set, collector, category, and commander decorations are removed from names', () => {
  assert.equal(importableCardName('Akroma, Vision of Ixidor (cmr) 2 [Pump]'), 'Akroma, Vision of Ixidor');
  assert.equal(importableCardName('1x Sisay, Weatherlight Captain (prm) 91211 [Commander{top}]'), 'Sisay, Weatherlight Captain');
  const custom = buildCustomDeck({
    name: 'Archidekt Import',
    commander: '1x Sisay, Weatherlight Captain (prm) 91211 [Commander{top}]',
    list: '99 Forest (ecl) 276 [Land]'
  }, db, []);
  assert.equal(custom.commander, 'sisay');
  assert.equal(custom.cards.reduce((sum, entry) => sum + entry.quantity, 0), 100);
});

test('missing Archidekt cards can be fetched and normalized for local custom-deck storage', async () => {
  const fetched = {
    id: '00000000-1111-2222-3333-444444444444',
    oracle_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    name: 'Akroma, Vision of Ixidor',
    type_line: 'Legendary Creature — Angel',
    mana_cost: '{5}{W}{W}', cmc: 7, power: '6', toughness: '6',
    colors: ['W'], color_identity: ['W'], keywords: ['Flying', 'First strike', 'Vigilance', 'Trample'],
    oracle_text: 'Flying, first strike, vigilance, trample',
    image_uris: { normal: 'https://cards.scryfall.io/normal/front/0/0/example.jpg' },
    legalities: { commander: 'legal' }
  };
  const mockFetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.identifiers[0].name, 'Akroma, Vision of Ixidor');
    return { ok: true, status: 200, json: async () => ({ data: [fetched], not_found: [] }) };
  };
  const definitions = await fetchMissingCardDefinitions(['Akroma, Vision of Ixidor (cmr) 2 [Pump]'], db, mockFetch);
  const definition = Object.values(definitions)[0];
  assert.equal(definition.name, 'Akroma, Vision of Ixidor');
  assert.equal(definition.supported, true);
  assert.deepEqual(definition.colorIdentity, ['W']);
  assert.ok(definition.keywords.includes('flying'));
});
