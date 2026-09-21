import test from 'node:test';
import assert from 'node:assert/strict';
import supportPayload from '../src/data/generated/card-support.json' with { type: 'json' };
import coverage from '../src/data/generated/coverage-report.json' with { type: 'json' };
import oracleRegistryPayload from '../src/data/generated/oracle-registry.json' with { type: 'json' };
import deckReadiness from '../src/data/generated/deck-readiness.json' with { type: 'json' };
import legacyRemoval from '../src/data/generated/legacy-handler-removal.json' with { type: 'json' };
import { OracleImplementationRegistry, CardSupportService, SUPPORT_STATUS } from '../src/cards/index.js';
import { GameEngine } from '../src/engine/GameEngine.js';
import { db, decks } from './helpers.js';

const supportById = Object.fromEntries(supportPayload.cards.map(row => [row.cardId, row]));

function simplePrinting(id, extra = {}) {
  return {
    id,
    name: 'Shared Oracle Card',
    oracleId: 'oracle-shared-1',
    typeLine: 'Creature — Test',
    manaCost: '{1}{U}',
    manaValue: 2,
    power: 2,
    toughness: 2,
    colors: ['U'],
    colorIdentity: ['U'],
    subtypes: ['Test'],
    keywords: [],
    abilities: [],
    spellEffects: [],
    oracleText: 'Flying',
    supported: true,
    ...extra
  };
}

test('Step 17: every authoritative trainer card has a measurable support record', () => {
  assert.equal(supportPayload.cards.length, Object.keys(db).length);
  for (const [id, card] of Object.entries(db)) {
    const row = supportById[id];
    assert.ok(row, `missing support record for ${id}`);
    assert.equal(row.cardId, id);
    assert.equal(row.name, card.name);
    assert.ok(['fully_supported','partially_supported','unsupported'].includes(row.supportStatus));
    assert.ok(['auto-template-candidate','declarative-scripted','complex-scripted','custom-hook-required','non-digital-unsupported'].includes(row.implementationPath));
    assert.equal(typeof row.testCount, 'number');
    assert.ok(Array.isArray(row.caveats));
    assert.ok(Array.isArray(row.requiredCustomHooks));
  }
});

test('Step 17: fully supported cards are test-backed, caveat-free, and strict eligible', () => {
  const full = supportPayload.cards.filter(row => row.supportStatus === SUPPORT_STATUS.FULL);
  assert.ok(full.length > 0);
  for (const row of full) {
    assert.ok(row.testCount > 0, `${row.cardId} needs a behavioral test`);
    assert.deepEqual(row.caveats, [], `${row.cardId} cannot be fully supported with caveats`);
    assert.equal(row.strictEligible, true);
    assert.ok(row.certification, `${row.cardId} needs explicit Step 17 certification`);
  }
});

test('Step 17: coverage percentages are computed from support records rather than estimates', () => {
  const expected = supportPayload.cards.reduce((acc, row) => {
    acc[row.supportStatus] = (acc[row.supportStatus] || 0) + 1;
    return acc;
  }, {});
  assert.equal(coverage.cardCount, Object.keys(db).length);
  assert.deepEqual(coverage.statusCounts, expected);
  assert.equal(Object.values(coverage.statusCounts).reduce((a,b)=>a+b,0), coverage.cardCount);
  assert.equal(coverage.cardsWithFullCertification, expected.fully_supported || 0);
  assert.match(coverage.metricPolicy, /computed exclusively from card-support records/i);
});

test('Step 17: current project decks are completely mapped and never silently claim unsupported behavior', () => {
  assert.equal(deckReadiness.decks.length, decks.length);
  for (const deck of decks) {
    const row = deckReadiness.decks.find(item => item.deckId === deck.id);
    assert.ok(row, `missing readiness row for ${deck.id}`);
    assert.equal(row.cardCount, 100);
    assert.equal(row.mappedSupportRecords, deck.cards.length);
    assert.equal(row.silentUnsupportedCount, 0);
    if (!row.strictReady) assert.ok(row.blockerCount > 0, 'non-ready decks must expose blockers');
  }
  assert.equal(coverage.currentDecks.allCardsMapped, true);
  assert.equal(coverage.currentDecks.silentlyUnsupportedCards, 0);
});

test('Step 17: Oracle registry reuses one canonical rules implementation across printings', () => {
  const dbFixture = {
    printA: simplePrinting('printA', { scryfallId: 'scryfall-a', image: 'a.jpg', abilities: [{ type: 'static', effect: { keywords: ['flying'] } }] }),
    printB: simplePrinting('printB', { scryfallId: 'scryfall-b', image: 'b.jpg', abilities: [] })
  };
  const registry = new OracleImplementationRegistry(dbFixture);
  const snapshot = registry.snapshot();
  assert.equal(snapshot.implementations.length, 1);
  assert.equal(snapshot.printingToImplementation.printA, snapshot.printingToImplementation.printB);
  const prepared = registry.applyToDatabase(dbFixture);
  assert.deepEqual(prepared.printA.abilities, prepared.printB.abilities);
  assert.equal(prepared.printA.image, 'a.jpg');
  assert.equal(prepared.printB.image, 'b.jpg');
  assert.equal(prepared.printA.scryfallId, 'scryfall-a');
  assert.equal(prepared.printB.scryfallId, 'scryfall-b');
  assert.equal(prepared.printA.rulesImplementationId, prepared.printB.rulesImplementationId);
});

test('Step 17: differing Oracle text under the same Oracle id creates version-specific implementation records', () => {
  const fixture = {
    oldPrint: simplePrinting('oldPrint', { oracleText: 'Flying' }),
    changedPrint: simplePrinting('changedPrint', { oracleText: 'Flying\nWard {1}', keywords: ['flying','ward'] })
  };
  const registry = new OracleImplementationRegistry(fixture);
  const snapshot = registry.snapshot();
  assert.equal(snapshot.implementations.length, 2);
  assert.notEqual(snapshot.printingToImplementation.oldPrint, snapshot.printingToImplementation.changedPrint);
  assert.match(snapshot.printingToImplementation.oldPrint, /^oracle:oracle-shared-1@/);
});

test('Step 17: cached Scryfall data supplies real Oracle identities where available and falls back visibly otherwise', () => {
  assert.equal(coverage.identityCoverage.cardsWithOracleId, 178);
  assert.equal(coverage.identityCoverage.cardsUsingLocalNameFallback, 534);
  const jhoira = supportById['user-jhoira-of-the-ghitu'];
  assert.ok(jhoira.oracleId);
  assert.match(jhoira.oracleIdentity, /^oracle:/);
  const grizzly = supportById['grizzly-bears'];
  assert.equal(grizzly.oracleId, null);
  assert.match(grizzly.oracleIdentity, /^local-name:/);
  assert.ok(grizzly.identityWarnings.length > 0);
});

test('Step 17: generated Oracle-to-implementation registry maps every printing exactly once', () => {
  const mappings = oracleRegistryPayload.printingToImplementation;
  assert.equal(Object.keys(mappings).length, Object.keys(db).length);
  for (const id of Object.keys(db)) assert.ok(mappings[id], `missing implementation mapping for ${id}`);
  const implementationIds = new Set(oracleRegistryPayload.implementations.map(row => row.implementationId));
  for (const implementationId of Object.values(mappings)) assert.ok(implementationIds.has(implementationId));
});

test('Step 17: GameEngine loads support metadata before game object creation and exposes support APIs', () => {
  const e = new GameEngine(decks[0], decks[1], db, { rng: () => 0.42 });
  const card = e.getCardDefinition('sol-ring');
  assert.equal(card.supportStatus, 'fully_supported');
  assert.equal(card.supportMetadata.strictEligible, true);
  assert.ok(card.rulesImplementationId);
  const status = e.getCardSupportStatus('sol-ring');
  assert.equal(status.supportStatus, 'fully_supported');
  const implementation = e.getOracleImplementation('sol-ring');
  assert.equal(implementation.canonicalCardId, 'sol-ring');
  const ready = e.getDeckSupportReadiness(decks[0]);
  assert.equal(ready.cardCount, 100);
  assert.equal(ready.silentUnsupportedCount, 0);
  assert.equal(e.getCardSupportCoverage().cardCount, 712);
});

test('Step 17: runtime cards not present in the certified database fail closed to partial support', () => {
  const service = new CardSupportService({});
  const card = simplePrinting('runtime-new', { oracleId: null, name: 'Runtime New Card' });
  const status = service.registerRuntimeCard(card);
  assert.equal(status.supportStatus, 'partially_supported');
  assert.equal(status.strictEligible, false);
  assert.ok(status.caveats.some(text => /not been certified/i.test(text)));
  const prepared = service.prepareCard(card);
  assert.equal(prepared.supportMetadata.strictEligible, false);
});

test('Step 17: legacy one-off behavior is tracked as an explicit removal/review list', () => {
  assert.ok(legacyRemoval.candidateCardCount > 0);
  const tracker = legacyRemoval.candidates.find(row => row.cardId === 'lcc-topography-tracker');
  assert.ok(tracker);
  assert.ok(tracker.reasons.includes('direct-card-id-condition'));
  assert.ok(tracker.references.some(ref => ref.file === 'src/engine/EffectEngine.js'));
});

test('Step 17: implementation-path classification is data-backed across all required workflow paths that occur in the current database', () => {
  const paths = new Set(supportPayload.cards.map(row => row.implementationPath));
  assert.ok(paths.has('auto-template-candidate'));
  assert.ok(paths.has('declarative-scripted'));
  assert.ok(paths.has('complex-scripted'));
  assert.equal(coverage.implementationPathCounts['auto-template-candidate'] > 0, true);
  assert.equal(coverage.implementationPathCounts['declarative-scripted'] > 0, true);
});
