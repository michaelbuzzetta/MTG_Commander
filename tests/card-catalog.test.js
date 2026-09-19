import test from 'node:test';
import assert from 'node:assert/strict';
import db from '../src/data/generated/cards.json' with { type: 'json' };
import { commanderLegal, isCommanderCandidate } from '../src/utils/deckBuilder.js';
import { mergeBuilderDatabase, promoteCatalogCard, promoteCatalogDefinitions, promoteCatalogNames } from '../src/utils/cardCatalog.js';

function catalogCard(overrides = {}) {
  return {
    id: 'catalog-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    scryfallId: '11111111-2222-3333-4444-555555555555',
    oracleId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    name: 'Catalog Human',
    aliases: ['Catalog Human'],
    typeLine: 'Legendary Creature — Human Soldier',
    manaCost: '{2}{W}',
    manaValue: 3,
    power: 3,
    toughness: 3,
    colors: ['W'],
    colorIdentity: ['W'],
    keywords: ['vigilance'],
    oracleText: 'Vigilance\nWhen Catalog Human enters, draw a card.',
    abilities: [],
    spellEffects: [],
    legalities: { commander: 'legal' },
    image: 'https://cards.scryfall.io/normal/front/1/1/example.jpg',
    cardFaces: [],
    catalogCard: true,
    supported: false,
    ...overrides
  };
}

test('full-catalog cards can appear as commanders even before runtime promotion', () => {
  const commander = catalogCard();
  assert.equal(isCommanderCandidate(commander), true);
  assert.equal(isCommanderCandidate(catalogCard({ legalities: { commander: 'not_legal' } })), false);
});

test('catalog recommendation legality enforces Commander legality and color identity', () => {
  const commander = catalogCard();
  assert.equal(commanderLegal(catalogCard({ id: 'white-card', name: 'White Card', typeLine: 'Creature — Human' }), commander), true);
  assert.equal(commanderLegal(catalogCard({ id: 'blue-card', name: 'Blue Card', colorIdentity: ['U'] }), commander), false);
  assert.equal(commanderLegal(catalogCard({ id: 'banned-card', name: 'Banned Card', legalities: { commander: 'banned' } }), commander), false);
});

test('builder database keeps hand-authored runtime mechanics over same-name catalog records', () => {
  const fakeSolRing = catalogCard({ id: 'catalog-sol-ring', name: 'Sol Ring', aliases: ['Sol Ring'], typeLine: 'Artifact', colorIdentity: [], oracleText: '{T}: Add {C}{C}.' });
  const unique = catalogCard({ id: 'catalog-unique-card', name: 'Unique Catalog Card', aliases: ['Unique Catalog Card'] });
  const merged = mergeBuilderDatabase(db, [fakeSolRing, unique]);
  assert.equal(merged['catalog-sol-ring'], undefined);
  assert.equal(merged['sol-ring'], db['sol-ring']);
  assert.equal(merged['catalog-unique-card'].name, 'Unique Catalog Card');
});

test('catalog-only records stay unsupported on the default production path', () => {
  const source = catalogCard();
  const promoted = promoteCatalogCard(source);
  assert.equal(promoted.supported, false);
  assert.equal(promoted.id, source.id);
  assert.equal(promoted.name, source.name);
  assert.equal(promoted.certificationEligible, false);
  assert.match(promoted.unsupportedReason, /no certified runtime implementation/i);
});

test('catalog heuristic parsing requires an explicit sandbox approximation opt-in', () => {
  const source = catalogCard();
  const promoted = promoteCatalogCard(source, { allowApproximation: true });
  assert.equal(promoted.supported, true);
  assert.equal(promoted.genericImported, true);
  assert.equal(promoted.sandboxApproximation, true);
  assert.equal(promoted.certificationEligible, false);
  assert.equal(promoted.catalogOriginId, source.id);
  assert.ok(promoted.keywords.includes('vigilance'));
  assert.ok(promoted.abilities.some(ability => ability.type === 'triggered'));
});

test('catalog promotion helpers only expose requested catalog cards and keep them unsupported by default', () => {
  const wanted = catalogCard();
  const other = catalogCard({ id: 'catalog-other', oracleId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', scryfallId: '22222222-2222-2222-2222-222222222222', name: 'Other Card', aliases: ['Other Card'] });
  const builderDb = mergeBuilderDatabase(db, [wanted, other]);
  const byName = promoteCatalogNames(['Catalog Human'], builderDb);
  assert.equal(Object.keys(byName).length, 1);
  assert.equal(Object.values(byName)[0].name, 'Catalog Human');
  assert.equal(Object.values(byName)[0].supported, false);
  const many = promoteCatalogDefinitions([wanted, other]);
  assert.equal(Object.keys(many).length, 2);
  assert.ok(Object.values(many).every(def => def.supported === false));
});
