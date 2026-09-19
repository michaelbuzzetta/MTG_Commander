import test from 'node:test';
import assert from 'node:assert/strict';
import { RulesVersionService, RulesVersionCompatibilityError, CURRENT_RULES_VERSION } from '../src/engine/rules-version/index.js';
import { GameEngine } from '../src/engine/GameEngine.js';
import { ReplayRunner } from '../src/engine/replay/index.js';
import { db, decks } from './helpers.js';

test('Step 44 exposes a stable current rules version descriptor', () => {
  const service = new RulesVersionService();
  assert.equal(service.currentVersion, CURRENT_RULES_VERSION);
  assert.equal(service.descriptor().current, true);
  assert.ok(service.snapshot().compatibleReplayVersions.includes(CURRENT_RULES_VERSION));
});

test('Step 44 exact-version replays are compatible', () => {
  const service = new RulesVersionService({ currentVersion:'rules-A' });
  const result = service.validateReplay({ rulesVersion:'rules-A' }, 'rules-A', { throwOnFailure:false });
  assert.equal(result.compatible, true);
});

test('Step 44 incompatible historical rules versions fail explicitly', () => {
  const service = new RulesVersionService({ currentVersion:'rules-B' });
  assert.throws(() => service.validateReplay({ rulesVersion:'rules-A' }, 'rules-B'), RulesVersionCompatibilityError);
});

test('Step 44 supports explicit compatibility declarations', () => {
  const service = new RulesVersionService({ currentVersion:'rules-B', compatibility:{ 'rules-B':['rules-A','rules-B'] } });
  assert.equal(service.validateReplay({ rulesVersion:'rules-A' }, 'rules-B').compatible, true);
});

test('Step 44 replay metadata carries the exact engine rules version', () => {
  const deck = decks[0];
  const engine = new GameEngine(deck, deck, db, { seed:'step44', validateDecks:false, rulesVersion:'rules-test-44' });
  const replay = JSON.parse(engine.serializeReplay());
  assert.equal(replay.metadata.rulesVersion, 'rules-test-44');
  assert.equal(replay.metadata.rulesVersionDescriptor.version, 'rules-test-44');
});

test('Step 44 replay runner rejects requested incompatible runtime version before playback', () => {
  const deck = decks[0];
  const engine = new GameEngine(deck, deck, db, { seed:'step44-runner', validateDecks:false, rulesVersion:'rules-old' });
  const replay = JSON.parse(engine.serializeReplay());
  assert.throws(() => ReplayRunner.run(replay, { deckA:deck, deckB:deck, db, runtimeRulesVersion:'rules-new' }), /not compatible/);
});
