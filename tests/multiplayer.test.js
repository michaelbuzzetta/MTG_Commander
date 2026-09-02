import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GameEngine } from '../src/engine/GameEngine.js';
import db from '../src/data/generated/cards.json' with { type: 'json' };
import decks from '../src/data/generated/decks.json' with { type: 'json' };
import { putBattlefield, setPhase } from './helpers.js';

function multiplayerEngine(count = 4) {
  const playable = decks.filter(deck => deck.playable !== false).slice(0, count);
  const e = new GameEngine(playable[0], playable.slice(1), db, { rng: () => 0.42 });
  e.start();
  for (const id of e.state.playerOrder) e.perform(id, { type: 'KEEP_HAND' });
  return e;
}

test('multiplayer setup supports 2, 3, and 4 players and deals each player an opening hand', () => {
  for (const count of [2, 3, 4]) {
    const e = multiplayerEngine(count);
    assert.equal(e.state.playerOrder.length, count);
    assert.equal(Object.keys(e.state.players).length, count);
    for (const id of e.state.playerOrder) assert.equal(e.state.players[id].hand.length, 7);
  }
});

test('four-player priority passes around every living player before the phase advances', () => {
  const e = multiplayerEngine(4);
  setPhase(e, 'PRECOMBAT_MAIN', { activePlayer: 'player', priorityPlayer: 'player' });

  e.perform('player', { type: 'PASS_PRIORITY' });
  assert.equal(e.state.priorityPlayer, 'ai');
  e.perform('ai', { type: 'PASS_PRIORITY' });
  assert.equal(e.state.priorityPlayer, 'ai2');
  e.perform('ai2', { type: 'PASS_PRIORITY' });
  assert.equal(e.state.priorityPlayer, 'ai3');
  assert.equal(e.state.phase, 'PRECOMBAT_MAIN');
  e.perform('ai3', { type: 'PASS_PRIORITY' });
  assert.equal(e.state.phase, 'BEGIN_COMBAT');
  assert.equal(e.state.priorityPlayer, 'player');
});

test('attackers can be split among different defending players and damage reaches the correct opponents', () => {
  const e = multiplayerEngine(4);
  const a1 = putBattlefield(e, 'player', 'grizzly-bears');
  const a2 = putBattlefield(e, 'player', 'grizzly-bears');
  setPhase(e, 'DECLARE_ATTACKERS', { activePlayer: 'player', priorityPlayer: 'player', turnActionPending: 'DECLARE_ATTACKERS' });

  e.perform('player', {
    type: 'DECLARE_ATTACKERS',
    attackers: [a1.instanceId, a2.instanceId],
    attackTargets: { [a1.instanceId]: 'ai', [a2.instanceId]: 'ai2' }
  });
  assert.deepEqual(e.state.combat.attackTargets, { [a1.instanceId]: 'ai', [a2.instanceId]: 'ai2' });

  for (const id of ['player', 'ai', 'ai2', 'ai3']) e.perform(id, { type: 'PASS_PRIORITY' });
  assert.equal(e.state.phase, 'DECLARE_BLOCKERS');
  assert.equal(e.state.combat.currentDefender, 'ai');

  e.perform('ai', { type: 'DECLARE_BLOCKERS', blockers: {} });
  assert.equal(e.state.combat.currentDefender, 'ai2');
  e.perform('ai2', { type: 'DECLARE_BLOCKERS', blockers: {} });
  assert.equal(e.state.turnActionPending, null);

  for (const id of ['player', 'ai', 'ai2', 'ai3']) e.perform(id, { type: 'PASS_PRIORITY' });
  assert.equal(e.state.phase, 'COMBAT_DAMAGE');
  assert.equal(e.state.players.ai.life, 38);
  assert.equal(e.state.players.ai2.life, 38);
  assert.equal(e.state.players.ai3.life, 40);
});

test('a defender may block only attackers that are attacking that defender', () => {
  const e = multiplayerEngine(4);
  const a1 = putBattlefield(e, 'player', 'grizzly-bears');
  const a2 = putBattlefield(e, 'player', 'grizzly-bears');
  const b1 = putBattlefield(e, 'ai', 'grizzly-bears');
  const b2 = putBattlefield(e, 'ai2', 'grizzly-bears');
  setPhase(e, 'DECLARE_ATTACKERS', { activePlayer: 'player', priorityPlayer: 'player', turnActionPending: 'DECLARE_ATTACKERS' });

  e.perform('player', {
    type: 'DECLARE_ATTACKERS',
    attackers: [a1.instanceId, a2.instanceId],
    attackTargets: { [a1.instanceId]: 'ai', [a2.instanceId]: 'ai2' }
  });
  for (const id of ['player', 'ai', 'ai2', 'ai3']) e.perform(id, { type: 'PASS_PRIORITY' });

  assert.throws(() => e.perform('ai', { type: 'DECLARE_BLOCKERS', blockers: { [a2.instanceId]: [b1.instanceId] } }), /another player|nonattacker|aimed/i);
  e.perform('ai', { type: 'DECLARE_BLOCKERS', blockers: { [a1.instanceId]: [b1.instanceId] } });
  assert.equal(e.state.combat.currentDefender, 'ai2');
  assert.throws(() => e.perform('ai2', { type: 'DECLARE_BLOCKERS', blockers: { [a1.instanceId]: [b2.instanceId] } }), /another player|nonattacker|aimed/i);
  e.perform('ai2', { type: 'DECLARE_BLOCKERS', blockers: { [a2.instanceId]: [b2.instanceId] } });
});

test('eliminating one multiplayer opponent does not end the game and turn order skips that player', () => {
  const e = multiplayerEngine(4);
  e.state.players.ai.life = 0;
  e.stateBasedActions();

  assert.equal(e.state.players.ai.lost, true);
  assert.equal(e.state.winner, null);
  assert.equal(e.nextPlayer('player'), 'ai2');
  assert.deepEqual(e.livingPlayerIds(), ['player', 'ai2', 'ai3']);

  e.state.players.ai2.life = 0;
  e.state.players.ai3.life = 0;
  e.stateBasedActions();
  assert.equal(e.state.winner, 'player');
});

test('opponent player targeting includes every living opponent in multiplayer', () => {
  const e = multiplayerEngine(4);
  const source = { targets: { kind: 'player', controller: 'opponent' } };
  const ids = e.targeting.getCandidates('player', source, []).map(candidate => candidate.id).sort();
  assert.deepEqual(ids, ['ai', 'ai2', 'ai3']);

  e.state.players.ai2.lost = true;
  const remaining = e.targeting.getCandidates('player', source, []).map(candidate => candidate.id).sort();
  assert.deepEqual(remaining, ['ai', 'ai3']);
});

test('home UI exposes 2/3/4 player selection and per-opponent combat targeting', () => {
  const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /\[2,3,4\]\.map\(count/);
  assert.match(app, /attackTargets/);
  assert.match(app, /opponentEntries\.map/);
  assert.match(app, /Assign attackers here/);
  assert.match(app, /s\.combat\.currentDefender === 'player'/);
});

test('deterministic four-player AI simulation reaches a legal last-player-standing result', async () => {
  const { AIController } = await import('../src/ai/AIController.js');
  const e = multiplayerEngine(4);
  let actions = 0;
  while (!e.state.winner && actions < 2500) {
    const id = e.state.pendingChoice?.playerId || (e.state.pregame.active ? e.state.pregame.currentPlayer : e.state.priorityPlayer);
    assert.ok(id, `game stalled without an acting player on turn ${e.state.turn} ${e.state.phase}`);
    const action = new AIController(e, id).choose();
    assert.ok(action, `${id} could not choose an action on turn ${e.state.turn} ${e.state.phase}`);
    assert.equal(e.isActionLegal(id, action), true, `${id} chose an illegal ${action.type}`);
    e.perform(id, action);
    actions++;
  }
  assert.ok(e.state.winner, `four-player game did not finish after ${actions} actions`);
  assert.ok(e.state.winner === 'draw' || e.playerIds().includes(e.state.winner));
  if (e.state.winner !== 'draw') assert.equal(e.livingPlayerIds().length, 1);
});
