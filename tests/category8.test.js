import test from 'node:test';
import assert from 'node:assert/strict';
import { EVENT } from '../src/engine/constants.js';
import { makeCardInstance } from '../src/engine/GameState.js';
import { engine, putBattlefield, setPhase } from './helpers.js';

function passToResolve(e) {
  const first = e.state.priorityPlayer || e.state.activePlayer;
  e.state.priorityPlayer = first;
  e.state.passes = 0;
  e.perform(first, { type: 'PASS_PRIORITY' });
  e.perform(e.state.priorityPlayer, { type: 'PASS_PRIORITY' });
}

function setTop(e, pid, cardId) {
  const card = makeCardInstance(cardId, pid, 'library');
  e.state.players[pid].library = [card, ...e.state.players[pid].library.filter(x => x.instanceId !== card.instanceId)];
  return card;
}

function utilityTokens(e, pid) {
  return e.state.players[pid].battlefield.filter(card => card.isToken && ['Treasure', 'Food', 'Clue'].includes(e.db[card.cardId]?.name));
}

test('Category 8 BUG-035: River Herald Scout explores itself instead of the first creature controlled', () => {
  const e = engine();
  const bear = putBattlefield(e, 'player', 'grizzly-bears');
  const scout = putBattlefield(e, 'player', 'merfolk-scout');
  const revealed = setTop(e, 'player', 'grizzly-bears');

  e.emit(EVENT.ENTER_BATTLEFIELD, { controller: 'player', target: scout });
  assert.equal(e.state.stack.length, 1);
  passToResolve(e);

  assert.equal(bear.counters['+1/+1'] || 0, 0, 'an unrelated earlier creature does not explore');
  assert.equal(scout.counters['+1/+1'], 1, 'the Scout that caused the self-ETB trigger explores');
  assert.equal(e.state.pendingChoice?.type, 'EXPLORE_NONLAND');
  assert.equal(e.state.pendingChoice?.permanentId, scout.instanceId);
  assert.equal(e.state.pendingChoice?.cardInstanceId, revealed.instanceId);
});

test('Category 8 BUG-036: nonland explore explicitly chooses keep-on-top or graveyard', () => {
  const e = engine();
  const scout = putBattlefield(e, 'player', 'merfolk-scout');
  const first = setTop(e, 'player', 'grizzly-bears');

  e.effects.resolve({ type: 'explore' }, { controller: 'player', source: scout });
  assert.equal(e.state.pendingChoice?.type, 'EXPLORE_NONLAND');
  assert.deepEqual(new Set(e.getLegalActions('player').map(action => `${action.type}:${action.putInGraveyard}`)), new Set(['CHOOSE_EXPLORE:false', 'CHOOSE_EXPLORE:true']));
  e.perform('player', { type: 'CHOOSE_EXPLORE', putInGraveyard: false });
  assert.equal(e.state.players.player.library[0].instanceId, first.instanceId, 'declining the graveyard option leaves the revealed card on top');
  assert.equal(e.state.players.player.graveyard.some(card => card.instanceId === first.instanceId), false);

  const second = makeCardInstance('grizzly-bears', 'player', 'library');
  e.state.players.player.library[0] = second;
  e.effects.resolve({ type: 'explore' }, { controller: 'player', source: scout });
  e.perform('player', { type: 'CHOOSE_EXPLORE', putInGraveyard: true });
  assert.equal(e.state.players.player.library.some(card => card.instanceId === second.instanceId), false);
  assert.equal(e.state.players.player.graveyard.some(card => card.instanceId === second.instanceId), true, 'chosen nonland moves to graveyard');
});

test('Category 8 BUG-037: exploring with an empty library still adds a +1/+1 counter', () => {
  const e = engine();
  const scout = putBattlefield(e, 'player', 'merfolk-scout');
  e.state.players.player.library = [];

  e.effects.resolve({ type: 'explore' }, { controller: 'player', source: scout });

  assert.equal(scout.counters['+1/+1'], 1);
  assert.equal(e.state.pendingChoice, null);
});

test('Category 8 BUG-041: Academy Manufactor preserves quantities through token doublers in either battlefield order', () => {
  for (const order of [['academy-manufactor', 'doubling-season'], ['doubling-season', 'academy-manufactor']]) {
    const e = engine();
    for (const cardId of order) putBattlefield(e, 'player', cardId);

    e.effects.createToken('player', { name: 'Treasure', typeLine: 'Artifact — Treasure' }, 1);

    const counts = Object.fromEntries(['Treasure', 'Food', 'Clue'].map(name => [name, utilityTokens(e, 'player').filter(card => e.db[card.cardId]?.name === name).length]));
    assert.deepEqual(counts, { Treasure: 2, Food: 2, Clue: 2 }, `doubling plus Manufactor makes two of each with order ${order.join(' -> ')}`);
  }
});

test('Category 8 BUG-041: createTokenRaw honors an explicit quantity instead of collapsing it to one', () => {
  const e = engine();
  const created = e.effects.createTokenRaw('player', { name: 'Treasure' }, 3);
  assert.equal(created.length, 3);
  assert.equal(e.state.players.player.battlefield.filter(card => card.isToken && e.db[card.cardId]?.name === 'Treasure').length, 3);
});

test('Category 8 BUG-042: Treasure is a normal mana ability that taps, sacrifices, and adds a chosen color', () => {
  const e = engine();
  setPhase(e, 'PRECOMBAT_MAIN');
  e.effects.createToken('player', { name: 'Treasure' }, 1);
  const treasure = e.state.players.player.battlefield.find(card => card.isToken && e.db[card.cardId]?.name === 'Treasure');
  const ability = e.db[treasure.cardId].abilities[0];
  const manaActions = e.getLegalActions('player').filter(action => action.type === 'ACTIVATE_MANA' && action.permanentId === treasure.instanceId);

  assert.deepEqual(new Set(manaActions.map(action => action.manaColor)), new Set(['W', 'U', 'B', 'R', 'G']));
  e.perform('player', { type: 'ACTIVATE_MANA', permanentId: treasure.instanceId, ability, manaColor: 'U' });

  assert.equal(e.state.players.player.manaPool.U, 1);
  assert.equal(e.findPermanent(treasure.instanceId), null, 'Treasure is sacrificed as an activation cost');
  assert.equal(e.state.players.player.graveyard.some(card => card.instanceId === treasure.instanceId), false, 'the token ceases to exist after the state-based check');
});

test('Category 8 BUG-042: Food sacrifices for three life and Clue sacrifices to draw through normal activated abilities', () => {
  const e = engine();
  setPhase(e, 'PRECOMBAT_MAIN');
  const p = e.state.players.player;

  e.effects.createToken('player', { name: 'Food' }, 1);
  const food = p.battlefield.find(card => card.isToken && e.db[card.cardId]?.name === 'Food');
  const foodAbility = e.db[food.cardId].abilities[0];
  p.life = 30;
  p.manaPool.C = 2;
  e.perform('player', { type: 'ACTIVATE_ABILITY', permanentId: food.instanceId, ability: foodAbility, targets: [] });
  assert.equal(e.findPermanent(food.instanceId), null);
  assert.equal(p.life, 30, 'Food life gain waits for the activated ability to resolve');
  passToResolve(e);
  assert.equal(p.life, 33);

  e.state.priorityPlayer = 'player';
  e.effects.createToken('player', { name: 'Clue' }, 1);
  const clue = p.battlefield.find(card => card.isToken && e.db[card.cardId]?.name === 'Clue');
  const clueAbility = e.db[clue.cardId].abilities[0];
  p.manaPool.C = 2;
  const handBefore = p.hand.length;
  e.perform('player', { type: 'ACTIVATE_ABILITY', permanentId: clue.instanceId, ability: clueAbility, targets: [] });
  assert.equal(e.findPermanent(clue.instanceId), null);
  passToResolve(e);
  assert.equal(p.hand.length, handBefore + 1);
});
