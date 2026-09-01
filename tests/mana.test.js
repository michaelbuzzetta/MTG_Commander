import test from 'node:test';
import assert from 'node:assert/strict';
import { engine, db, putBattlefield, setPhase } from './helpers.js';
import { ManaEngine } from '../src/engine/ManaEngine.js';

const totalMana = pool => Object.values(pool).reduce((sum, n) => sum + n, 0);

test('Category 3: mana pools empty for both players at every normal phase transition', () => {
  const e = engine();
  const player = e.state.players.player;
  const ai = e.state.players.ai;
  setPhase(e, 'UPKEEP', { activePlayer: 'player', priorityPlayer: 'player' });
  player.manaPool.U = 2;
  ai.manaPool.R = 3;

  e.perform('player', { type: 'PASS_PRIORITY' });
  e.perform('ai', { type: 'PASS_PRIORITY' });

  assert.equal(e.state.phase, 'DRAW');
  assert.equal(totalMana(player.manaPool), 0);
  assert.equal(totalMana(ai.manaPool), 0);
});

test('Category 3: summoning-sick creature mana abilities are neither offered nor counted by auto-tap', () => {
  const e = engine();
  const player = e.state.players.player;
  player.battlefield = [];
  const esika = putBattlefield(e, 'player', 'esika', { summoningSick: true, controlledSinceTurn: e.state.turn });
  const ability = db.esika.abilities[0];
  setPhase(e, 'PRECOMBAT_MAIN', { activePlayer: 'player', priorityPlayer: 'player' });

  assert.ok(!e.getLegalActions('player').some(a => a.type === 'ACTIVATE_MANA' && a.permanentId === esika.instanceId));
  assert.equal(ManaEngine.canAfford(player, e.db, '{1}'), false);
  assert.throws(() => e.activateMana('player', esika.instanceId, ability), /Summoning-sick creature/);
  assert.equal(esika.tapped, false);
});

test('Category 3: a control change makes a creature unable to pay a tap cost until its new controller has begun a later turn', () => {
  const e = engine();
  e.state.players.player.battlefield = [];
  e.state.players.ai.battlefield = [];
  const esika = putBattlefield(e, 'player', 'esika', { summoningSick: false, controlledSinceTurn: 0 });
  const turn = e.state.turn;

  e.changeController(esika.instanceId, 'ai');

  assert.equal(esika.controller, 'ai');
  assert.equal(esika.summoningSick, true);
  assert.equal(esika.controlledSinceTurn, turn);
  assert.equal(ManaEngine.canAfford(e.state.players.ai, e.db, '{1}'), false);
});

test('Category 3: any-color sources expose and enforce an explicit color choice', () => {
  const e = engine();
  const player = e.state.players.player;
  player.battlefield = [];
  player.colorIdentity = ['G', 'U'];
  const tower = putBattlefield(e, 'player', 'command-tower');
  const ability = db['command-tower'].abilities[0];
  setPhase(e, 'PRECOMBAT_MAIN', { activePlayer: 'player', priorityPlayer: 'player' });

  const actions = e.getLegalActions('player').filter(a => a.type === 'ACTIVATE_MANA' && a.permanentId === tower.instanceId);
  assert.deepEqual(actions.map(a => a.manaColor).sort(), ['G', 'U']);
  assert.throws(() => e.perform('player', { type: 'ACTIVATE_MANA', permanentId: tower.instanceId, ability }), /color choice is required/);
  assert.throws(() => e.perform('player', { type: 'ACTIVATE_MANA', permanentId: tower.instanceId, ability, manaColor: 'W' }), /Illegal mana color choice/);

  e.perform('player', { type: 'ACTIVATE_MANA', permanentId: tower.instanceId, ability, manaColor: 'U' });
  assert.equal(player.manaPool.U, 1);
  assert.equal(player.manaPool.G, 0);
  assert.equal(tower.tapped, true);
});

test('Category 3: payment solver preserves flexible sources for colors only they can provide', () => {
  const e = engine();
  const player = e.state.players.player;
  player.battlefield = [];
  player.manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  player.colorIdentity = ['W', 'U'];

  // Deliberately put the flexible source first to reproduce BUG-008's old iteration-order failure.
  const tower = putBattlefield(e, 'player', 'command-tower');
  const plains = putBattlefield(e, 'player', 'plains');
  const plan = ManaEngine.solvePayment(player, e.db, '{W}{U}');

  assert.ok(plan);
  assert.equal(plan.activations.length, 2);
  assert.equal(plan.activations.find(x => x.permanentId === tower.instanceId)?.manaColor, 'U');
  assert.deepEqual(plan.activations.find(x => x.permanentId === plains.instanceId)?.mana, { W: 1 });
  assert.equal(ManaEngine.canAfford(player, e.db, '{W}{U}'), true);

  assert.equal(ManaEngine.autoTapAndPay(player, e.db, '{W}{U}'), true);
  assert.equal(tower.tapped, true);
  assert.equal(plains.tapped, true);
  assert.equal(totalMana(player.manaPool), 0);
});

test('Category 3: affordability and auto-tap share the same deterministic solver for generic and colorless mana', () => {
  const e = engine();
  const player = e.state.players.player;
  player.battlefield = [];
  player.manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  const ring = putBattlefield(e, 'player', 'sol-ring');
  const island = putBattlefield(e, 'player', 'island');

  const plan = ManaEngine.solvePayment(player, e.db, '{1}{C}');
  assert.ok(plan);
  assert.equal(plan.activations.length, 1);
  assert.equal(plan.activations[0].permanentId, ring.instanceId);
  assert.equal(ManaEngine.canAfford(player, e.db, '{1}{C}'), true);
  assert.equal(ManaEngine.autoTapAndPay(player, e.db, '{1}{C}'), true);
  assert.equal(ring.tapped, true);
  assert.equal(island.tapped, false);
  assert.equal(totalMana(player.manaPool), 0);
});
