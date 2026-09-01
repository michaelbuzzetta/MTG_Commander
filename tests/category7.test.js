import test from 'node:test';
import assert from 'node:assert/strict';
import { EVENT } from '../src/engine/constants.js';
import { engine, putBattlefield } from './helpers.js';

function passToResolve(e) {
  const first = e.state.priorityPlayer || e.state.activePlayer;
  e.state.priorityPlayer = first;
  e.state.passes = 0;
  e.perform(first, { type: 'PASS_PRIORITY' });
  e.perform(e.state.priorityPlayer, { type: 'PASS_PRIORITY' });
}

test('Category 7 BUG-030: self-ETB triggers are tied to the permanent that actually entered', () => {
  const e = engine();
  const scout = putBattlefield(e, 'player', 'merfolk-scout');
  const unrelated = putBattlefield(e, 'player', 'grizzly-bears');

  e.emit(EVENT.ENTER_BATTLEFIELD, { controller: 'player', target: unrelated });
  assert.equal(e.state.stack.length, 0, 'River Herald Scout does not trigger for an unrelated permanent');

  e.emit(EVENT.ENTER_BATTLEFIELD, { controller: 'player', target: scout });
  assert.equal(e.state.stack.length, 1);
  assert.equal(e.state.stack[0].sourceInstanceId, scout.instanceId);
});

test('Category 7 BUG-030: Pest Summoner does not recursively retrigger from the tokens it creates', () => {
  const e = engine();
  const summoner = putBattlefield(e, 'player', 'pest-summoner');
  e.emit(EVENT.ENTER_BATTLEFIELD, { controller: 'player', target: summoner });
  assert.equal(e.state.stack.length, 1);

  passToResolve(e);

  assert.equal(e.state.stack.length, 0, 'created Pest tokens did not recursively create new Summoner triggers');
  assert.equal(e.state.players.player.battlefield.filter(card => card.isToken && e.db[card.cardId]?.name === 'Pest').length, 2);
});

test('Category 7 BUG-031: dies triggers use last-known information after their source leaves the battlefield', () => {
  const e = engine();
  e.db['lki-creature'] = {
    id: 'lki-creature', name: 'Last Known Witness', typeLine: 'Creature — Spirit', power: 1, toughness: 1,
    keywords: [], spellEffects: [], abilities: [{
      type: 'triggered', event: EVENT.CREATURE_DIED, condition: { sourceEvent: true }, effect: { type: 'gainLife', amount: 1 }
    }]
  };
  const creature = putBattlefield(e, 'player', 'lki-creature');

  e.toGraveyard(creature, true);

  assert.equal(e.findPermanent(creature.instanceId), null);
  assert.equal(e.state.stack.length, 1);
  assert.equal(e.state.stack[0].sourceInstanceId, creature.instanceId);
  assert.equal(e.state.stack[0].source.cardId, 'lki-creature');
});

test('Category 7 BUG-032: optional triggers can be declined or accepted through a decision state', () => {
  const e = engine();
  e.db['optional-shrine'] = {
    id: 'optional-shrine', name: 'Optional Shrine', typeLine: 'Enchantment', keywords: [], spellEffects: [],
    abilities: [{ type: 'triggered', event: EVENT.END_STEP, optional: true, effect: { type: 'draw', amount: 1 } }]
  };
  putBattlefield(e, 'player', 'optional-shrine');

  e.emit(EVENT.END_STEP, { controller: 'player' });
  assert.equal(e.state.pendingChoice?.type, 'OPTIONAL_TRIGGER');
  assert.deepEqual(new Set(e.getLegalActions('player').map(action => `${action.type}:${action.accept}`)), new Set(['CHOOSE_TRIGGER:true', 'CHOOSE_TRIGGER:false']));
  e.perform('player', { type: 'CHOOSE_TRIGGER', triggerId: e.state.pendingChoice.triggerId, accept: false });
  assert.equal(e.state.stack.length, 0);

  e.emit(EVENT.END_STEP, { controller: 'player' });
  const triggerId = e.state.pendingChoice.triggerId;
  e.perform('player', { type: 'CHOOSE_TRIGGER', triggerId, accept: true });
  assert.equal(e.state.stack.length, 1);
  assert.equal(e.state.stack[0].id, triggerId);
});

test('Category 7 BUG-032: simultaneous triggers use APNAP and controller-selected ordering', () => {
  const e = engine();
  for (const [id, name] of [['p-one', 'Player One'], ['p-two', 'Player Two'], ['a-one', 'AI One'], ['a-two', 'AI Two']]) {
    e.db[id] = {
      id, name, typeLine: 'Enchantment', keywords: [], spellEffects: [],
      abilities: [{ type: 'triggered', event: EVENT.END_STEP, effect: { type: 'gainLife', amount: 1 } }]
    };
  }
  const p1 = putBattlefield(e, 'player', 'p-one');
  const p2 = putBattlefield(e, 'player', 'p-two');
  const a1 = putBattlefield(e, 'ai', 'a-one');
  const a2 = putBattlefield(e, 'ai', 'a-two');

  e.emit(EVENT.END_STEP, { controller: 'player' });
  assert.equal(e.state.pendingChoice?.type, 'TRIGGER_ORDER');
  assert.equal(e.state.pendingChoice?.playerId, 'player');
  const playerBySource = new Map(e.state.pendingTriggers.filter(t => t.controller === 'player').map(t => [t.sourceInstanceId, t.id]));
  e.perform('player', { type: 'ORDER_TRIGGERS', triggerIds: [playerBySource.get(p2.instanceId), playerBySource.get(p1.instanceId)] });

  assert.equal(e.state.pendingChoice?.type, 'TRIGGER_ORDER');
  assert.equal(e.state.pendingChoice?.playerId, 'ai');
  const aiBySource = new Map(e.state.pendingTriggers.filter(t => t.controller === 'ai').map(t => [t.sourceInstanceId, t.id]));
  e.perform('ai', { type: 'ORDER_TRIGGERS', triggerIds: [aiBySource.get(a1.instanceId), aiBySource.get(a2.instanceId)] });

  assert.deepEqual(e.state.stack.map(item => item.controller), ['player', 'player', 'ai', 'ai']);
  assert.deepEqual(e.state.stack.map(item => item.sourceInstanceId), [p2.instanceId, p1.instanceId, a1.instanceId, a2.instanceId]);
  assert.equal(e.state.stack.at(-1).controller, 'ai', 'nonactive-player triggers are on top after APNAP placement');
});

test('Category 7 BUG-033: Merfolk Mistbinder buffs only other Merfolk its controller controls', () => {
  const e = engine();
  const mistbinder = putBattlefield(e, 'player', 'merfolk-mistbinder');
  const ownMerfolk = putBattlefield(e, 'player', 'merfolk-scout');
  const enemyMerfolk = putBattlefield(e, 'ai', 'merfolk-scout');

  assert.deepEqual(e.static.derivedStats(mistbinder), { power: 2, toughness: 2, keywords: [] });
  assert.equal(e.static.derivedStats(ownMerfolk).power, 2);
  assert.equal(e.static.derivedStats(ownMerfolk).toughness, 3);
  assert.equal(e.static.derivedStats(enemyMerfolk).power, 1);
  assert.equal(e.static.derivedStats(enemyMerfolk).toughness, 2);
});

test('Category 7 BUG-034: proliferate affects only the controller-selected eligible objects and players', () => {
  const e = engine();
  const own = putBattlefield(e, 'player', 'grizzly-bears', { counters: { '+1/+1': 1 } });
  const enemy = putBattlefield(e, 'ai', 'grizzly-bears', { counters: { '+1/+1': 2 } });
  e.state.players.ai.counters.poison = 1;

  e.effects.resolve({ type: 'proliferate' }, { controller: 'player' });

  assert.equal(e.state.pendingChoice?.type, 'PROLIFERATE');
  assert.deepEqual(new Set(e.state.pendingChoice.eligibleIds), new Set([own.instanceId, enemy.instanceId, 'ai']));
  e.perform('player', { type: 'CHOOSE_PROLIFERATE', targetIds: [own.instanceId, 'ai'] });

  assert.equal(own.counters['+1/+1'], 2);
  assert.equal(enemy.counters['+1/+1'], 2, 'unchosen opposing permanent is unchanged');
  assert.equal(e.state.players.ai.counters.poison, 2);
});

test('Category 7 BUG-043: counter replacements filter correctly and the affected controller chooses their order', () => {
  const e = engine();
  putBattlefield(e, 'player', 'hardened-scales');
  putBattlefield(e, 'player', 'branching-evolution');
  const own = putBattlefield(e, 'player', 'grizzly-bears');
  const enemy = putBattlefield(e, 'ai', 'grizzly-bears');

  e.effects.addCounters('ai', enemy, '+1/+1', 1);
  assert.equal(enemy.counters['+1/+1'], 1, 'your replacement effects do not modify an opponent creature');
  assert.equal(e.state.pendingChoice, null);

  e.effects.addCounters('player', own, 'charge', 1);
  assert.equal(own.counters.charge, 1, 'Hardened Scales and Branching Evolution ignore non +1/+1 counters');
  assert.equal(e.state.pendingChoice, null);

  e.effects.addCounters('player', own, '+1/+1', 1);
  assert.equal(e.state.pendingChoice?.type, 'REPLACEMENT_ORDER');
  assert.equal(e.state.pendingChoice?.playerId, 'player');
  const byEffect = new Map(e.state.pendingChoice.replacements.map(replacement => [replacement.effect, replacement.id]));
  e.perform('player', { type: 'ORDER_REPLACEMENTS', replacementIds: [byEffect.get('double'), byEffect.get('addOne')] });
  assert.equal(own.counters['+1/+1'], 3, 'double then add-one yields three counters');

  const second = putBattlefield(e, 'player', 'grizzly-bears');
  e.effects.addCounters('player', second, '+1/+1', 1);
  const secondByEffect = new Map(e.state.pendingChoice.replacements.map(replacement => [replacement.effect, replacement.id]));
  e.perform('player', { type: 'ORDER_REPLACEMENTS', replacementIds: [secondByEffect.get('addOne'), secondByEffect.get('double')] });
  assert.equal(second.counters['+1/+1'], 4, 'add-one then double yields four counters');
});
