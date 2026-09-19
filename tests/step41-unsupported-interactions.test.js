import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/engine/GameEngine.js';
import { makeCardInstance } from '../src/engine/GameState.js';
import { HeadlessSimulationRunner } from '../src/engine/performance/index.js';
import { UNSUPPORTED_INTERACTION_MODE, UnsupportedInteraction } from '../src/engine/diagnostics/index.js';
import { db, decks } from './helpers.js';

const playable = decks.filter(deck => deck.playable !== false);

function strictReadyDeck(id) {
  return {
    id,
    name: `Strict Ready ${id}`,
    format: 'Commander',
    commander: 'hakbal',
    colorIdentity: ['G', 'U'],
    cards: [
      { id: 'hakbal', quantity: 1 },
      { id: 'forest', quantity: 99 }
    ],
    cardCount: 100
  };
}

function make(mode = UNSUPPORTED_INTERACTION_MODE.STANDARD) {
  return new GameEngine(playable[0], playable[1], db, {
    seed: `step41-${mode}`,
    startingPlayer: 'first',
    rulesVersion: 'step41-test-rules',
    gameId: `step41-${mode}-game`,
    unsupportedInteractionMode: mode,
    invariantChecks: true
  });
}

test('Step 41 strict preflight rejects non-certified decks before game state creation and allows fully certified support-only decks', () => {
  assert.throws(
    () => new GameEngine(playable[0], playable[1], db, {
      seed: 'step41-strict-block',
      unsupportedInteractionMode: UNSUPPORTED_INTERACTION_MODE.STRICT,
      simulationPurpose: 'official-simulation'
    }),
    error => {
      assert.ok(error instanceof UnsupportedInteraction);
      assert.equal(error.code, 'UNSUPPORTED_INTERACTION');
      assert.equal(error.context?.kind, 'deck-preflight');
      assert.equal(error.suggestedSupportStatus, 'fully_supported');
      return true;
    }
  );

  const a = strictReadyDeck('strict-a');
  const b = strictReadyDeck('strict-b');
  const syntheticSupport = {
    cards: [
      { cardId: 'hakbal', name: db.hakbal.name, supportStatus: 'fully_supported', strictEligible: true, caveats: [], testCount: 1, requiredCustomHooks: [], lastValidatedRulesVersion: 'step41-test' },
      { cardId: 'forest', name: db.forest.name, supportStatus: 'fully_supported', strictEligible: true, caveats: [], testCount: 1, requiredCustomHooks: [], lastValidatedRulesVersion: 'step41-test' }
    ]
  };
  const engine = new GameEngine(a, b, db, {
    seed: 'step41-strict-pass',
    validateDecks: false,
    cardSupportOptions: { supportPayload: syntheticSupport },
    unsupportedInteractionMode: UNSUPPORTED_INTERACTION_MODE.STRICT,
    simulationPurpose: 'official-simulation'
  });
  const report = engine.preflightDeckSupport([a, b], { requireStrict: false });
  assert.equal(report.strictReady, true);
  assert.equal(report.blockers.length, 0);
  assert.equal(engine.getUnsupportedInteractionPolicy().mode, 'strict');
});

test('Step 41 explicit unsupported card action fails during validation before costs or game-state mutation', () => {
  const e = make();
  e._registerRuntimeCardDefinition('step41-unsupported-card', {
    id: 'step41-unsupported-card',
    name: 'Step 41 Unsupported Card',
    cardType: 'Instant',
    typeLine: 'Instant',
    manaCost: '',
    supported: false,
    unsupportedReason: 'Synthetic unsupported interaction for Step 41.',
    spellEffects: []
  });
  const card = makeCardInstance('step41-unsupported-card', 'player', 'hand', {}, e.db['step41-unsupported-card']);
  e.state.players.player.hand.push(card);
  const before = e.getReplayStateHash();
  const response = e.submitAction('player', { type: 'CAST_SPELL', cardInstanceId: card.instanceId });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'UNSUPPORTED_INTERACTION');
  assert.equal(response.error.cardName, 'Step 41 Unsupported Card');
  assert.equal(response.error.context.kind, 'action-preflight');
  assert.equal(e.getReplayStateHash(), before);
  assert.equal(e.state.players.player.hand.some(item => item.instanceId === card.instanceId), true);
  assert.equal(e.getUnsupportedDiagnostics().length, 1);
});

test('Step 41 unsupported effect node rolls an in-progress stack resolution back to its exact checkpoint', () => {
  const e = make();
  const source = e.state.players.player.command[0];
  const beforeLife = e.state.players.player.life;
  e.stack.push({
    type: 'ability',
    controller: 'player',
    source,
    effect: {
      type: 'sequence',
      effects: [
        { type: 'gainLife', amount: 5 },
        { type: 'step41MissingEffect', payload: { synthetic: true } }
      ]
    }
  });
  const beforeHash = e.getReplayStateHash();
  const beforeDepth = e.state.stack.length;
  assert.throws(() => e.resolution.resolveTop(), error => error?.code === 'UNSUPPORTED_INTERACTION');
  assert.equal(e.state.players.player.life, beforeLife);
  assert.equal(e.state.stack.length, beforeDepth);
  assert.equal(e.getReplayStateHash(), beforeHash);
  const diagnostic = e.getUnsupportedDiagnostics().at(-1);
  assert.equal(diagnostic.context.kind, 'effect-node');
  assert.equal(diagnostic.scriptNode.type, 'step41MissingEffect');
  assert.equal(diagnostic.rollback, 'resolution-checkpoint-restored');
  assert.equal(diagnostic.rulesVersion, 'step41-test-rules');
  assert.equal(diagnostic.gameId, 'step41-standard-game');
  assert.ok(Object.hasOwn(diagnostic, 'eventId'));
  assert.ok(Object.hasOwn(diagnostic, 'suggestedSupportStatus'));
});

test('Step 41 permissive sandbox labels approximations and excludes the run from official statistics', () => {
  const e = make(UNSUPPORTED_INTERACTION_MODE.SANDBOX);
  const source = e.state.players.player.command[0];
  const beforeLife = e.state.players.player.life;
  e.stack.push({
    type: 'ability',
    controller: 'player',
    source,
    effect: {
      type: 'sequence',
      effects: [
        { type: 'gainLife', amount: 3 },
        { type: 'step41SandboxOnlyMissingEffect' }
      ]
    }
  });
  assert.doesNotThrow(() => e.resolution.resolveTop());
  assert.equal(e.state.players.player.life, beforeLife + 3);
  const policy = e.getUnsupportedInteractionPolicy();
  assert.equal(policy.mode, 'sandbox');
  assert.equal(policy.statisticsEligible, false);
  assert.match(policy.statisticsExclusionReasons.join(' '), /sandbox/i);
  const diagnostic = e.getUnsupportedDiagnostics().at(-1);
  assert.equal(diagnostic.outcome, 'sandbox-approximation');
  assert.equal(diagnostic.approximation.kind, 'explicit-no-op');
  const replay = JSON.parse(e.serializeReplay());
  assert.equal(replay.metadata.statisticsEligible, false);
  assert.equal(replay.unsupportedInteractions.diagnostics.length, 1);
});

test('Step 41 strict headless/official batch simulation excludes decks with support blockers', () => {
  const runner = new HeadlessSimulationRunner({ db, decks: playable.slice(0, 4), invariantChecks: true });
  const preflight = runner.preflight({ playerCount: 2, strict: true });
  assert.equal(preflight.strictReady, false);
  assert.ok(preflight.blockers.length > 0);
  assert.throws(
    () => runner.createEngine({ seed: 'step41-official-block', playerCount: 2, officialSimulation: true }),
    error => error?.code === 'UNSUPPORTED_INTERACTION'
  );
  assert.throws(
    () => runner.createEngine({ seed: 'step41-official-sandbox', playerCount: 2, officialSimulation: true, unsupportedInteractionMode: 'sandbox' }),
    /cannot run in permissive sandbox mode/i
  );
});

test('Step 41 benchmark simulations require an explicit partial-support override and record that override', () => {
  assert.throws(
    () => new GameEngine(playable[0], playable[1], db, {
      seed: 'step41-benchmark-block',
      simulationPurpose: 'performance-benchmark'
    }),
    error => error?.code === 'UNSUPPORTED_INTERACTION'
  );

  const engine = new GameEngine(playable[0], playable[1], db, {
    seed: 'step41-benchmark-override',
    simulationPurpose: 'performance-benchmark',
    allowPartialSimulationOverride: true
  });
  const policy = engine.getUnsupportedInteractionPolicy();
  assert.equal(policy.allowPartialSimulationOverride, true);
  const replay = JSON.parse(engine.serializeReplay());
  assert.equal(replay.metadata.simulationPurpose, 'performance-benchmark');
  assert.equal(replay.metadata.allowPartialSimulationOverride, true);
});
