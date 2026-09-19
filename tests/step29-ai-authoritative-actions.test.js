import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AIController, AIActionScorer } from '../src/ai/index.js';
import { GameEngine } from '../src/engine/GameEngine.js';
import { db, decks, engine, setPhase } from './helpers.js';

function seededGame(seed = 'step29-seed') {
  const playable = decks.filter(deck => deck.playable !== false);
  const game = new GameEngine(playable[0], playable[1], db, { seed });
  game.start();
  return game;
}

function actorFor(game) {
  const state = game.getStateSnapshot();
  return state.pendingChoice?.playerId
    || (state.pregame?.active ? state.pregame.currentPlayer : state.priorityPlayer);
}

function semanticAction(controller, action) {
  const out = structuredClone(action);
  const mapId = id => {
    if (id == null) return id;
    if (controller.state.players[id]) return `player:${id}`;
    const found = controller.findCardAnywhere(id);
    if (found?.card?.cardId) return `card:${found.card.cardId}`;
    const permanent = controller.engine.getPermanentSnapshot(id);
    if (permanent?.cardId) return `permanent:${permanent.cardId}`;
    return String(id).replace(/card-\d+/g, 'card-instance').replace(/object-\d+/g, 'object-instance');
  };
  for (const field of ['cardInstanceId', 'permanentId', 'hostId', 'landInstanceId', 'keepInstanceId']) {
    if (field in out) out[field] = mapId(out[field]);
  }
  for (const field of ['cardInstanceIds', 'targets', 'selections', 'attackers', 'targetIds', 'permanentIds']) {
    if (Array.isArray(out[field])) out[field] = out[field].map(mapId);
  }
  if (out.attackTargets) out.attackTargets = Object.fromEntries(Object.entries(out.attackTargets).map(([key, value]) => [mapId(key), mapId(value)]));
  if (out.blockers) out.blockers = Object.fromEntries(Object.entries(out.blockers).map(([key, values]) => [mapId(key), values.map(mapId)]));
  return out;
}

function drive(game, count = 30, { semantic = false } = {}) {
  const actions = [];
  for (let i = 0; i < count && !game.getStateSnapshot().winner; i++) {
    const actor = actorFor(game);
    assert.ok(actor, `missing actor at step ${i}`);
    const controller = new AIController(game, actor);
    const action = controller.choose();
    assert.ok(action, `${actor} failed to choose at step ${i}`);
    actions.push(semantic ? semanticAction(controller, action) : structuredClone(action));
    controller.submit(action);
  }
  return actions;
}

test('Step 29: AI knowledge view redacts opponent hidden zones and facade refuses another private player view', () => {
  const game = engine();
  const ai = new AIController(game, 'ai');
  const { state } = ai.knowledge.refresh();
  assert.ok(state.players.player.hand.length > 0);
  for (const card of state.players.player.hand) {
    assert.equal(card.hidden, true);
    assert.equal(card.cardId, null);
    assert.equal(card.gameObjectId, null);
  }
  assert.equal('state' in ai.engine, false);
  assert.equal('_engine' in ai.engine, false);
  assert.throws(() => ai.engine.getPlayerStateSnapshot('player'), /own private player view/);
});

test('Step 29: legal-action adapter rejects fabricated strategy actions before submission', () => {
  const game = engine();
  setPhase(game, 'PRECOMBAT_MAIN', { activePlayer: 'ai', priorityPlayer: 'ai' });
  const before = JSON.stringify(game.getStateSnapshot());
  const ai = new AIController(game, 'ai');
  ai._refreshView();
  const illegal = { type: 'CAST_SPELL', cardInstanceId: 'fabricated-hidden-card' };
  assert.equal(ai.legalActions.isAuthorized(illegal), false);
  assert.throws(() => ai.submit(illegal), /authoritative legal-action set/);
  assert.equal(JSON.stringify(game.getStateSnapshot()), before);
});

test('Step 29: even deliberately buggy strategy code cannot make AI submit an illegal move', () => {
  const game = engine();
  setPhase(game, 'PRECOMBAT_MAIN', { activePlayer: 'ai', priorityPlayer: 'ai' });
  const before = JSON.stringify(game.getStateSnapshot());
  const ai = new AIController(game, 'ai');
  ai.choose = () => ({ type: 'PLAY_LAND', cardInstanceId: 'not-in-hand' });
  assert.throws(() => ai.step(), /authoritative legal-action set/);
  assert.equal(JSON.stringify(game.getStateSnapshot()), before);
});

test('Step 29: action scorer is strategy-only and supports pluggable scoring/threshold interfaces', () => {
  const scorer = new AIActionScorer()
    .register('CAST_SPELL', action => action.weight * 2, action => action.minimum);
  const result = scorer.evaluate({ type: 'CAST_SPELL', weight: 7, minimum: 10 });
  assert.equal(result.value, 14);
  assert.equal(result.threshold, 10);
  assert.equal(Object.isFrozen(result), true);
});

test('Step 29: choice evaluator produces an engine-authorized scry choice', () => {
  const game = engine();
  setPhase(game, 'PRECOMBAT_MAIN', { activePlayer: 'ai', priorityPlayer: 'ai' });
  const top = game.state.players.ai.library[0];
  game.state.pendingChoice = { type: 'SCRY', playerId: 'ai', cardInstanceId: top.instanceId };
  game.state.priorityPlayer = 'ai';
  const ai = new AIController(game, 'ai');
  const action = ai.choose();
  assert.equal(action.type, 'CHOOSE_SCRY');
  assert.equal(ai.legalActions.isAuthorized(action), true);
});

test('Step 29: identical seeded games produce identical AI action sequences', () => {
  const first = seededGame('step29-deterministic');
  const second = seededGame('step29-deterministic');
  const a = drive(first, 36, { semantic: true });
  const b = drive(second, 36, { semantic: true });
  assert.deepEqual(a, b);
});

test('Step 29: AI decisions are recorded alongside authoritative replay actions', () => {
  const game = seededGame('step29-replay');
  drive(game, 24);
  const replay = JSON.parse(game.serializeReplay());
  assert.equal(replay.aiDecisions.length, replay.actions.length);
  assert.deepEqual(
    replay.aiDecisions.map(entry => entry.action?.type),
    replay.actions.map(entry => entry.action?.type)
  );
  assert.ok(replay.aiDecisions.every(entry => entry.policyVersion === 'step29-authoritative-actions-v1'));
  assert.ok(replay.aiDecisions.every(entry => Number.isInteger(entry.actionSequence) && entry.actionSequence >= 1));
});

test('Step 29: production opponent automation submits through AIController instead of bypassing its legal-action guard', () => {
  const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /aiController\.submit\(action\)/);
  assert.doesNotMatch(app, /engine\.submitAction\(actor,\s*action\)/);
});
