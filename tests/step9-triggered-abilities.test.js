import test from 'node:test';
import assert from 'node:assert/strict';
import db from '../src/data/generated/cards.json' with { type: 'json' };
import decks from '../src/data/generated/decks.json' with { type: 'json' };
import { GameEngine } from '../src/engine/GameEngine.js';
import { EVENT } from '../src/engine/constants.js';
import { definitionFromCardAbility } from '../src/engine/triggers/TriggerDefinition.js';
import { engine, putBattlefield, setPhase } from './helpers.js';

function passToResolve(e) {
  while (e.state.stack.length && !e.state.pendingChoice) {
    const start = e.state.priorityPlayer || e.state.activePlayer;
    if (!e.state.priorityPlayer) e.state.priorityPlayer = start;
    const seen = new Set();
    while (e.state.stack.length && !e.state.pendingChoice) {
      const pid = e.state.priorityPlayer;
      if (!pid || seen.has(pid)) break;
      seen.add(pid);
      e.perform(pid, { type: 'PASS_PRIORITY' });
      if (!e.state.stack.length) break;
    }
  }
}

function fourPlayerEngine() {
  const e = new GameEngine(decks[0], [decks[1], decks[2], decks[3]], db, { rng: () => 0.42 });
  e.start();
  e.state.pregame.active = false;
  e.state.gameBegun = true;
  e.state.phase = 'END_STEP';
  e.state.phaseIndex = 11;
  e.state.priorityPlayer = 'ai2';
  return e;
}

function defineTriggered(e, id, event, effect, extra = {}) {
  e.db[id] = {
    id,
    name: id,
    typeLine: extra.typeLine || 'Enchantment',
    manaCost: '', manaValue: 0, keywords: [], subtypes: [], spellEffects: [],
    abilities: [{
      type: 'triggered',
      event,
      ...(extra.sourceZone ? { sourceZone: extra.sourceZone } : {}),
      ...(extra.condition ? { condition: extra.condition } : {}),
      ...(extra.interveningIf !== undefined ? { interveningIf: extra.interveningIf } : {}),
      ...(extra.sourceFilter ? { sourceFilter: extra.sourceFilter } : {}),
      ...(extra.affectedFilter ? { affectedFilter: extra.affectedFilter } : {}),
      ...(extra.targets ? { targets: extra.targets } : {}),
      effect
    }]
  };
}

test('Step 9: TriggerDefinitions are discovered from completed event-stream observations and do not resolve immediately', () => {
  const e = engine();
  defineTriggered(e, 'step9-life-watcher', EVENT.LIFE_GAIN, { type: 'draw', amount: 1 }, { condition: { controllerEvent: true } });
  const watcher = putBattlefield(e, 'player', 'step9-life-watcher');
  setPhase(e, 'PRECOMBAT_MAIN', { activePlayer: 'player', priorityPlayer: 'player' });

  const before = e.state.players.player.life;
  const handBefore = e.state.players.player.hand.length;
  e.changeLife('player', 1);

  assert.equal(e.state.players.player.life, before + 1);
  assert.equal(e.state.players.player.hand.length, handBefore, 'trigger is queued/stacked, not resolved during the event');
  assert.equal(e.state.stack.length, 1);
  const trigger = e.state.stack[0];
  assert.equal(trigger.type, 'trigger');
  assert.equal(trigger.sourceInstanceId, watcher.instanceId);
  assert.equal(trigger.triggerDefinitionId, 'card:step9-life-watcher:trigger:0');
  assert.equal(trigger.triggeringEvent?.type, EVENT.LIFE_GAIN);
  assert.ok(trigger.triggeringEvent?.provenance?.parentEventId, 'legacy observation is causally linked to the authoritative life event');

  passToResolve(e);
  assert.equal(e.state.players.player.hand.length, handBefore + 1);
});

test('Step 9: four-player simultaneous triggers are placed on the stack in rotated APNAP order', () => {
  const e = fourPlayerEngine();
  for (const pid of ['player', 'ai', 'ai2', 'ai3']) {
    const id = `step9-${pid}-watcher`;
    defineTriggered(e, id, EVENT.END_STEP, { type: 'gainLife', amount: 1 });
    putBattlefield(e, pid, id);
  }
  e.state.activePlayer = 'ai2';
  e.state.priorityPlayer = 'ai2';

  e.emit(EVENT.END_STEP, { controller: 'ai2' });

  assert.deepEqual(
    e.state.stack.map(item => item.controller),
    ['ai2', 'ai3', 'player', 'ai'],
    'active player first, then nonactive players in turn order starting after the active player'
  );
  assert.equal(e.state.stack.at(-1).controller, 'ai');
});

test('Step 9: each player orders only their own simultaneous triggers before the next APNAP player is processed', () => {
  const e = fourPlayerEngine();
  e.state.activePlayer = 'ai2';
  e.state.priorityPlayer = 'ai2';

  for (const [id, pid] of [
    ['step9-active-a', 'ai2'], ['step9-active-b', 'ai2'],
    ['step9-next-a', 'ai3'], ['step9-next-b', 'ai3']
  ]) {
    defineTriggered(e, id, EVENT.END_STEP, { type: 'gainLife', amount: 1 });
    putBattlefield(e, pid, id);
  }

  e.emit(EVENT.END_STEP, { controller: 'ai2' });
  assert.equal(e.state.pendingChoice?.type, 'TRIGGER_ORDER');
  assert.equal(e.state.pendingChoice?.playerId, 'ai2');
  const activeOrder = [...e.state.pendingChoice.triggerIds].reverse();
  e.perform('ai2', { type: 'ORDER_TRIGGERS', triggerIds: activeOrder });

  assert.equal(e.state.pendingChoice?.type, 'TRIGGER_ORDER');
  assert.equal(e.state.pendingChoice?.playerId, 'ai3');
  const nextOrder = [...e.state.pendingChoice.triggerIds];
  e.perform('ai3', { type: 'ORDER_TRIGGERS', triggerIds: nextOrder });

  assert.equal(e.state.pendingChoice, null);
  assert.deepEqual(e.state.stack.map(item => item.controller), ['ai2', 'ai2', 'ai3', 'ai3']);
});

test('Step 9: intervening-if conditions are checked at trigger time and again on resolution by the trigger engine', () => {
  const e = engine();
  defineTriggered(e, 'step9-intervening', EVENT.END_STEP, { type: 'gainLife', amount: 5 }, {
    condition: { sourceCounterAtLeast: { counter: 'charge', amount: 2 } }
  });
  const source = putBattlefield(e, 'player', 'step9-intervening', { counters: { charge: 1 } });
  setPhase(e, 'END_STEP', { activePlayer: 'player', priorityPlayer: 'player' });

  e.emit(EVENT.END_STEP, { controller: 'player' });
  assert.equal(e.state.stack.length, 0, 'false intervening-if prevents the ability from triggering');

  source.counters.charge = 2;
  const before = e.state.players.player.life;
  e.emit(EVENT.END_STEP, { controller: 'player' });
  assert.equal(e.state.stack.length, 1);
  assert.deepEqual(e.state.stack[0].interveningIf, { sourceCounterAtLeast: { counter: 'charge', amount: 2 } });

  source.counters.charge = 1;
  passToResolve(e);
  assert.equal(e.state.players.player.life, before, 'failed intervening-if means the triggered ability does nothing on resolution');
  assert.ok(e.state.history.some(entry => entry.type === 'TRIGGER_INTERVENING_IF_FAILED'));
});

test('Step 9: delayed triggers survive source removal, fire once, and then unregister', () => {
  const e = engine();
  const source = putBattlefield(e, 'player', 'grizzly-bears');
  const snapshot = structuredClone(source);
  const definition = e.triggers.registerDelayedTrigger({
    event: EVENT.END_STEP,
    controller: 'player',
    sourceSnapshot: snapshot,
    effect: { type: 'gainLife', amount: 3 },
    metadata: { reason: 'step9-test' }
  });

  e.toGraveyard(source, false);
  const before = e.state.players.player.life;
  e.emit(EVENT.END_STEP, { controller: 'player' });

  assert.equal(e.state.stack.length, 1);
  assert.equal(e.state.stack[0].triggerKind, 'delayed');
  assert.equal(e.state.stack[0].triggerDefinitionId, definition.definitionId);
  assert.equal(e.state.triggerRegistrations.some(item => item.definitionId === definition.definitionId), false, 'one-shot delayed trigger is removed after firing');

  passToResolve(e);
  assert.equal(e.state.players.player.life, before + 3);
  e.emit(EVENT.END_STEP, { controller: 'player' });
  assert.equal(e.state.stack.length, 0, 'the delayed trigger does not fire a second time');
});

test('Step 9: delayed trigger expiration removes an unfired registration at its declared event', () => {
  const e = engine();
  const source = putBattlefield(e, 'player', 'grizzly-bears');
  const definition = e.triggers.registerDelayedTrigger({
    event: EVENT.END_STEP,
    controller: 'player',
    sourceSnapshot: structuredClone(source),
    effect: { type: 'gainLife', amount: 3 },
    expiresAtEvent: EVENT.TURN_START
  });
  e.emit(EVENT.TURN_START, { controller: 'player', playerId: 'player', turn: e.state.turn });
  assert.equal(e.state.triggerRegistrations.some(item => item.definitionId === definition.definitionId), false);
  e.emit(EVENT.END_STEP, { controller: 'player' });
  assert.equal(e.state.stack.length, 0);
});

test('Step 9: reflexive trigger registrations use the same matcher/queue/stack machinery', () => {
  const e = engine();
  const source = putBattlefield(e, 'player', 'grizzly-bears');
  const definition = e.triggers.registerReflexiveTrigger({
    event: 'STEP9_REFLEXIVE_EVENT',
    controller: 'player',
    sourceSnapshot: structuredClone(source),
    parentAbilityId: 'parent-ability-1',
    effect: { type: 'gainLife', amount: 4 }
  });
  const before = e.state.players.player.life;

  e.emit('STEP9_REFLEXIVE_EVENT', { controller: 'player', object: source });
  assert.equal(e.state.stack.length, 1);
  assert.equal(e.state.stack[0].triggerKind, 'reflexive');
  assert.equal(e.state.stack[0].triggerDefinitionId, definition.definitionId);
  passToResolve(e);
  assert.equal(e.state.players.player.life, before + 4);
});

test('Step 9: explicitly declared nonbattlefield source zones are honored without enabling hidden-zone abilities by default', () => {
  const e = engine();
  defineTriggered(e, 'step9-graveyard-watcher', EVENT.END_STEP, { type: 'gainLife', amount: 2 }, { sourceZone: 'graveyard' });
  defineTriggered(e, 'step9-default-watcher', EVENT.END_STEP, { type: 'gainLife', amount: 7 });
  const graveWatcher = putBattlefield(e, 'player', 'step9-graveyard-watcher');
  const defaultWatcher = putBattlefield(e, 'player', 'step9-default-watcher');
  e.toGraveyard(graveWatcher, false);
  e.toGraveyard(defaultWatcher, false);

  e.emit(EVENT.END_STEP, { controller: 'player' });
  assert.equal(e.state.stack.length, 1);
  assert.equal(e.state.stack[0].sourceInstanceId, graveWatcher.instanceId);
});

test('Step 9: leave/dies triggers use Step 8 LKI and preserve the triggering source snapshot after zone change', () => {
  const e = engine();
  defineTriggered(e, 'step9-dies-source', EVENT.CREATURE_DIED, { type: 'gainLife', amount: 1 }, {
    typeLine: 'Creature — Spirit',
    condition: { sourceEvent: true }
  });
  const source = putBattlefield(e, 'player', 'step9-dies-source', { counters: { '+1/+1': 3 } });
  e.toGraveyard(source, true);
  assert.equal(e.state.stack.length, 1);
  const trigger = e.state.stack[0];
  assert.equal(trigger.sourceInstanceId, source.instanceId);
  assert.equal(trigger.source.zone, 'battlefield');
  assert.equal(trigger.source.counters['+1/+1'], 3);
  assert.ok(trigger.sourceGameObjectId);
  assert.equal(trigger.sourceGameObjectId, trigger.source.gameObjectId);
  assert.notEqual(trigger.sourceGameObjectId, source.gameObjectId, 'the trigger keeps the pre-zone-change object identity');
});

test('Step 9: temporary trigger registrations survive canonical state serialization/restoration', () => {
  const e = engine();
  const source = e.state.players.player.command[0];
  const definition = e.triggers.registerDelayedTrigger({
    event: EVENT.END_STEP,
    controller: 'player',
    sourceSnapshot: structuredClone(source),
    effect: { type: 'gainLife', amount: 1 }
  });
  const serialized = e.serializeState();
  e.state.triggerRegistrations = [];
  e.restoreState(serialized);
  assert.ok(e.state.triggerRegistrations.some(item => item.definitionId === definition.definitionId));
});

test('Step 9: TriggerDefinition source and affected filters use the shared composable filter library', () => {
  const e = engine();
  defineTriggered(e, 'step9-filtered-watcher', EVENT.ENTER_BATTLEFIELD, { type: 'gainLife', amount: 2 }, {
    typeLine: 'Enchantment',
    sourceFilter: { type: 'Enchantment' },
    affectedFilter: { and: [{ type: 'Creature' }, { controller: 'you' }] }
  });
  putBattlefield(e, 'player', 'step9-filtered-watcher');

  const land = putBattlefield(e, 'player', 'forest');
  e.emit(EVENT.ENTER_BATTLEFIELD, { controller: 'player', object: land });
  assert.equal(e.state.stack.length, 0, 'a noncreature affected object is rejected by the affected filter');

  const opposingCreature = putBattlefield(e, 'ai', 'grizzly-bears');
  e.emit(EVENT.ENTER_BATTLEFIELD, { controller: 'ai', object: opposingCreature });
  assert.equal(e.state.stack.length, 0, 'controller relation inside the affected filter is enforced');

  const ownCreature = putBattlefield(e, 'player', 'grizzly-bears');
  e.emit(EVENT.ENTER_BATTLEFIELD, { controller: 'player', object: ownCreature });
  assert.equal(e.state.stack.length, 1);
  assert.equal(e.state.stack[0].triggerDefinitionId, 'card:step9-filtered-watcher:trigger:0');
});

test('Step 9: every existing data-declared triggered ability normalizes into a TriggerDefinition', () => {
  let total = 0;
  for (const [cardId, definition] of Object.entries(db)) {
    for (const [index, ability] of (definition.abilities || []).entries()) {
      if (ability?.type !== 'triggered') continue;
      total += 1;
      const triggerDefinition = definitionFromCardAbility(cardId, ability, index);
      assert.ok(triggerDefinition, `${definition.name || cardId} trigger ${index} did not compile`);
      assert.ok(triggerDefinition.eventPattern.length > 0, `${definition.name || cardId} trigger ${index} has no event pattern`);
      assert.equal(triggerDefinition.sourceCardId, cardId);
    }
  }
  assert.ok(total >= 70, `expected the current card suite to contain many migrated triggers, found ${total}`);
});


test('Step 9: Bygone Marvels cast trigger is data-driven from the spell on the stack', () => {
  const e = engine();
  e.state.players.player.graveyard = Array.from({ length: 8 }, (_, index) => ({
    instanceId: `grave-permanent-${index}`,
    gameObjectId: `grave-object-${index}`,
    cardId: 'grizzly-bears',
    owner: 'player', controller: 'player', zone: 'graveyard', counters: {}
  }));
  const card = {
    instanceId: 'bygone-on-stack', gameObjectId: 'bygone-stack-object', zoneChangeId: 1,
    cardId: 'lcc-bygone-marvels', owner: 'player', controller: 'player', zone: 'stack', counters: {}
  };
  e.stack.push({ id: 'bygone-spell', type: 'spell', controller: 'player', card, targets: [] });
  e.emit(EVENT.SPELL_CAST, { controller: 'player', card, targets: [] });

  assert.equal(e.state.stack.length, 2);
  const trigger = e.state.stack.at(-1);
  assert.equal(trigger.type, 'trigger');
  assert.equal(trigger.sourceInstanceId, card.instanceId);
  assert.equal(trigger.triggerDefinitionId, 'card:lcc-bygone-marvels:trigger:0');
  assert.equal(trigger.effect.type, 'copySpellByInstance');
  assert.equal(trigger.effect.copies, 2);
});
