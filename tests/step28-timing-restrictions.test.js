import test from 'node:test';
import assert from 'node:assert/strict';
import { engine, setPhase } from './helpers.js';
import { makeCardInstance } from '../src/engine/GameState.js';
import { TimingError } from '../src/engine/timing/index.js';

function definition(id, extra = {}) {
  return {
    id,
    name: id,
    typeLine: 'Instant',
    manaCost: '{0}',
    manaValue: 0,
    colors: [],
    colorIdentity: [],
    subtypes: [],
    keywords: [],
    abilities: [],
    spellEffects: [],
    oracleText: '',
    supported: true,
    ...extra
  };
}

function addCard(e, pid, id, zone = 'hand', extraDefinition = {}, extraCard = {}) {
  e._registerRuntimeCardDefinition(id, definition(id, extraDefinition));
  const card = makeCardInstance(id, pid, zone, extraCard, e.db[id]);
  e.zones.place(card, zone, pid);
  return card;
}

function addPermanent(e, pid, id, abilities, extraDefinition = {}) {
  return addCard(e, pid, id, 'battlefield', {
    typeLine: 'Artifact',
    abilities,
    ...extraDefinition
  }, { summoningSick: false });
}

function manaAbility(timing = null) {
  return {
    type: 'mana',
    tap: false,
    mana: { C: 0 },
    ...(timing ? { timing } : {})
  };
}

test('Step 28: default spell timing distinguishes instant and sorcery windows authoritatively', () => {
  const e = engine();
  const instant = addCard(e, 'player', 'step28-instant', 'hand', { typeLine: 'Instant' });
  const sorcery = addCard(e, 'player', 'step28-sorcery', 'hand', { typeLine: 'Sorcery' });

  setPhase(e, 'UPKEEP', { activePlayer: 'player', priorityPlayer: 'player' });
  assert.equal(e.isActionLegal('player', { type: 'CAST_SPELL', cardInstanceId: instant.instanceId }), true);
  assert.equal(e.isActionLegal('player', { type: 'CAST_SPELL', cardInstanceId: sorcery.instanceId }), false);

  setPhase(e, 'PRECOMBAT_MAIN', { activePlayer: 'player', priorityPlayer: 'player' });
  assert.equal(e.isActionLegal('player', { type: 'CAST_SPELL', cardInstanceId: sorcery.instanceId }), true);
  const stackSource = addPermanent(e, 'ai', 'step28-stack-source-a', []);
  e.stack.push({ type: 'ability', controller: 'ai', source: stackSource, effect: { type: 'gainLife', amount: 1 }, targets: [] });
  assert.equal(e.isActionLegal('player', { type: 'CAST_SPELL', cardInstanceId: sorcery.instanceId }), false, 'nonempty stack closes sorcery timing');
});

test('Step 28: no cast or activation is legal without priority through the public action path', () => {
  const e = engine();
  const instant = addCard(e, 'player', 'step28-priority-instant', 'hand', { typeLine: 'Instant' });
  const ability = manaAbility();
  const source = addPermanent(e, 'player', 'step28-priority-rock', [ability]);
  setPhase(e, 'UPKEEP', { activePlayer: 'player', priorityPlayer: 'ai' });

  assert.equal(e.isActionLegal('player', { type: 'CAST_SPELL', cardInstanceId: instant.instanceId }), false);
  assert.equal(e.isActionLegal('player', { type: 'ACTIVATE_MANA', permanentId: source.instanceId, ability }), false);
  assert.throws(() => e.timing.validateAction('player', { type: 'CAST_SPELL', cardInstanceId: instant.instanceId }), error => error instanceof TimingError && error.code === 'ILLEGAL_TIMING');
});

test('Step 28: flash-style permissions relax default sorcery timing but preserve priority requirements', () => {
  const e = engine();
  const sorcery = addCard(e, 'player', 'step28-flashed-sorcery', 'graveyard', { typeLine: 'Sorcery' });
  setPhase(e, 'UPKEEP', { activePlayer: 'ai', priorityPlayer: 'player' });
  e.registerLegalityRule({
    id: 'step28-grave-flash', kind: 'permission', operation: 'CAST', appliesTo: 'player', fromZone: 'graveyard', timing: 'flash'
  });
  const action = { type: 'CAST_SPELL', cardInstanceId: sorcery.instanceId, castOption: 'rule-permission' };
  assert.equal(e.isActionLegal('player', action), true);
  e.state.priorityPlayer = 'ai';
  assert.equal(e.isActionLegal('player', action), false);
});

test('Step 28: activated abilities default to instant timing while sorcery-speed abilities use the shared predicate', () => {
  const e = engine();
  const instantAbility = { type: 'activated', cost: {}, effect: { type: 'gainLife', amount: 1 } };
  const sorceryAbility = { type: 'activated', cost: {}, sorcerySpeed: true, effect: { type: 'gainLife', amount: 1 } };
  const source = addPermanent(e, 'player', 'step28-ability-source', [instantAbility, sorceryAbility]);

  setPhase(e, 'UPKEEP', { activePlayer: 'player', priorityPlayer: 'player' });
  assert.equal(e.isActionLegal('player', { type: 'ACTIVATE_ABILITY', permanentId: source.instanceId, ability: instantAbility, targets: [] }), true);
  assert.equal(e.isActionLegal('player', { type: 'ACTIVATE_ABILITY', permanentId: source.instanceId, ability: sorceryAbility, targets: [] }), false);

  setPhase(e, 'POSTCOMBAT_MAIN', { activePlayer: 'player', priorityPlayer: 'player' });
  assert.equal(e.isActionLegal('player', { type: 'ACTIVATE_ABILITY', permanentId: source.instanceId, ability: sorceryAbility, targets: [] }), true);
});

test('Step 28: special actions use their own windows — foretell works during your upkeep but not an opponent turn', () => {
  const e = engine();
  const foretold = addCard(e, 'player', 'step28-foretell', 'hand', { typeLine: 'Sorcery', foretellCost: '{U}' });
  e.state.players.player.manaPool.C = 2;
  const action = { type: 'FORETELL_CARD', cardInstanceId: foretold.instanceId };

  setPhase(e, 'UPKEEP', { activePlayer: 'player', priorityPlayer: 'player' });
  e.state.players.player.manaPool.C = 2;
  assert.equal(e.isActionLegal('player', action), true, 'foretell is a special action, not sorcery timing');
  assert.equal(e.submitAction('player', action).ok, true);
  assert.equal(e.state.stack.length, 0, 'foretell special action never uses the stack');
  assert.equal(e.zones.find(foretold.instanceId).zone, 'exile');

  const second = addCard(e, 'player', 'step28-foretell-two', 'hand', { typeLine: 'Sorcery', foretellCost: '{U}' });
  setPhase(e, 'UPKEEP', { activePlayer: 'ai', priorityPlayer: 'player' });
  e.state.players.player.manaPool.C = 2;
  assert.equal(e.isActionLegal('player', { type: 'FORETELL_CARD', cardInstanceId: second.instanceId }), false);
});

test('Step 28: land play remains a special action restricted to active-player main phase with an empty stack', () => {
  const e = engine();
  const land = addCard(e, 'player', 'step28-land', 'hand', { typeLine: 'Land', manaCost: '' });
  const action = { type: 'PLAY_LAND', cardInstanceId: land.instanceId };
  setPhase(e, 'UPKEEP', { activePlayer: 'player', priorityPlayer: 'player' });
  assert.equal(e.isActionLegal('player', action), false);
  setPhase(e, 'PRECOMBAT_MAIN', { activePlayer: 'player', priorityPlayer: 'player' });
  assert.equal(e.isActionLegal('player', action), true);
  const stackSource = addPermanent(e, 'ai', 'step28-stack-source-b', []);
  e.stack.push({ type: 'ability', controller: 'ai', source: stackSource, effect: { type: 'gainLife', amount: 1 }, targets: [] });
  assert.equal(e.isActionLegal('player', action), false);
});

test('Step 28: timing predicates support combat-only, exact-step, before-step and after-step restrictions', () => {
  const e = engine();
  const combat = manaAbility({ combatOnly: true });
  const upkeep = manaAbility({ phases: ['UPKEEP'] });
  const beforeAttackers = manaAbility({ beforeStep: 'DECLARE_ATTACKERS' });
  const afterAttackers = manaAbility({ afterStep: 'DECLARE_ATTACKERS' });
  const source = addPermanent(e, 'player', 'step28-window-source', [combat, upkeep, beforeAttackers, afterAttackers]);
  const legal = ability => e.isActionLegal('player', { type: 'ACTIVATE_MANA', permanentId: source.instanceId, ability });

  setPhase(e, 'UPKEEP', { activePlayer: 'player', priorityPlayer: 'player' });
  assert.equal(legal(combat), false);
  assert.equal(legal(upkeep), true);
  assert.equal(legal(beforeAttackers), true);
  assert.equal(legal(afterAttackers), false);

  setPhase(e, 'BEGIN_COMBAT', { activePlayer: 'player', priorityPlayer: 'player' });
  assert.equal(legal(combat), true);
  assert.equal(legal(beforeAttackers), true);
  setPhase(e, 'DECLARE_BLOCKERS', { activePlayer: 'player', priorityPlayer: 'player' });
  assert.equal(legal(beforeAttackers), false);
  assert.equal(legal(afterAttackers), true);
});

test('Step 28: once-per-turn usage is tracked per game object and resets on the next turn number', () => {
  const e = engine();
  const ability = manaAbility({ oncePerTurn: true });
  const source = addPermanent(e, 'player', 'step28-once-turn', [ability]);
  const action = { type: 'ACTIVATE_MANA', permanentId: source.instanceId, ability };
  setPhase(e, 'PRECOMBAT_MAIN', { activePlayer: 'player', priorityPlayer: 'player' });

  assert.equal(e.submitAction('player', action).ok, true);
  assert.equal(e.isActionLegal('player', action), false);
  assert.equal(e.getTimingSnapshot().usage.filter(row => row.usageKey.includes(source.gameObjectId)).length, 1);

  e.state.turn += 1;
  e.state.priorityPlayer = 'player';
  assert.equal(e.isActionLegal('player', action), true);
});

test('Step 28: once-per-combat usage resets for a later extra combat in the same turn', () => {
  const e = engine();
  const ability = manaAbility({ oncePerCombat: true });
  const source = addPermanent(e, 'player', 'step28-once-combat', [ability]);
  const action = { type: 'ACTIVATE_MANA', permanentId: source.instanceId, ability };
  setPhase(e, 'BEGIN_COMBAT', { activePlayer: 'player', priorityPlayer: 'player' });

  assert.equal(e.submitAction('player', action).ok, true);
  assert.equal(e.isActionLegal('player', action), false);

  setPhase(e, 'POSTCOMBAT_MAIN', { activePlayer: 'player', priorityPlayer: 'player' });
  e.turn.addExtraCombatAfterCurrent();
  e.state.phaseIndex += 1;
  e.state.phase = e.state.turnSequence[e.state.phaseIndex].key;
  e.state.turnStepId = e.state.turnSequence[e.state.phaseIndex].id;
  e.state.turnPhaseGroup = e.state.turnSequence[e.state.phaseIndex].phaseGroup;
  e.state.priorityPlayer = 'player';
  assert.equal(e.state.phase, 'BEGIN_COMBAT');
  assert.equal(e.isActionLegal('player', action), true, 'new combat has a distinct usage scope');
});

test('Step 28: not-used-since-step restrictions reset at the declared turn boundary', () => {
  const e = engine();
  const ability = manaAbility({ notUsedSinceStep: 'BEGIN_COMBAT' });
  const source = addPermanent(e, 'player', 'step28-since-step', [ability]);
  const action = { type: 'ACTIVATE_MANA', permanentId: source.instanceId, ability };

  setPhase(e, 'PRECOMBAT_MAIN', { activePlayer: 'player', priorityPlayer: 'player' });
  assert.equal(e.submitAction('player', action).ok, true);

  setPhase(e, 'BEGIN_COMBAT', { activePlayer: 'player', priorityPlayer: 'player' });
  assert.equal(e.isActionLegal('player', action), true, 'a use before the reset step does not consume the later window');
  assert.equal(e.submitAction('player', action).ok, true);

  setPhase(e, 'DECLARE_BLOCKERS', { activePlayer: 'player', priorityPlayer: 'player' });
  assert.equal(e.isActionLegal('player', action), false, 'a use since beginning of combat blocks a later use');
});

test('Step 28: custom script timing conditions are evaluated by the shared script condition runtime', () => {
  const e = engine();
  const ability = manaAbility({ condition: { controllerLifeAtMost: 10 }, message: 'Life must be 10 or less.' });
  const source = addPermanent(e, 'player', 'step28-condition-source', [ability]);
  const action = { type: 'ACTIVATE_MANA', permanentId: source.instanceId, ability };
  setPhase(e, 'UPKEEP', { activePlayer: 'player', priorityPlayer: 'player' });

  assert.equal(e.isActionLegal('player', action), false);
  e.state.players.player.life = 10;
  assert.equal(e.isActionLegal('player', action), true);
});

test('Step 28: legal-action generation exposes only timing-legal cards and abilities', () => {
  const e = engine();
  const instant = addCard(e, 'player', 'step28-list-instant', 'hand', { typeLine: 'Instant' });
  const sorcery = addCard(e, 'player', 'step28-list-sorcery', 'hand', { typeLine: 'Sorcery' });
  const once = manaAbility({ oncePerTurn: true });
  const source = addPermanent(e, 'player', 'step28-list-rock', [once]);
  setPhase(e, 'UPKEEP', { activePlayer: 'player', priorityPlayer: 'player' });

  let actions = e.getLegalActions('player');
  assert.ok(actions.some(action => action.cardInstanceId === instant.instanceId));
  assert.ok(!actions.some(action => action.cardInstanceId === sorcery.instanceId));
  assert.ok(actions.some(action => action.type === 'ACTIVATE_MANA' && action.permanentId === source.instanceId));
  e.submitAction('player', { type: 'ACTIVATE_MANA', permanentId: source.instanceId, ability: once });
  actions = e.getLegalActions('player');
  assert.ok(!actions.some(action => action.type === 'ACTIVATE_MANA' && action.permanentId === source.instanceId));
});

test('Step 28: timing usage survives canonical state serialization and restore', () => {
  const e = engine();
  const ability = manaAbility({ oncePerTurn: true });
  const source = addPermanent(e, 'player', 'step28-serialized-usage', [ability]);
  const action = { type: 'ACTIVATE_MANA', permanentId: source.instanceId, ability };
  setPhase(e, 'PRECOMBAT_MAIN', { activePlayer: 'player', priorityPlayer: 'player' });
  assert.equal(e.submitAction('player', action).ok, true);
  const saved = e.serializeState();
  e.restoreState(saved);
  assert.equal(e.getTimingSnapshot().usage.length > 0, true);
  assert.equal(e.isActionLegal('player', action), false, 'restored state keeps same-turn usage restriction');
});

test('Step 28: declarative card scripts preserve and validate rich timing data for abilities and modes', () => {
  const e = engine();
  const compiled = e.compileCardScript(definition('step28-scripted', {
    typeLine: 'Sorcery',
    script: {
      version: 1,
      abilities: [{
        kind: 'activated',
        cost: {},
        timing: { speed: 'instant', onlyDuringCombat: true, oncePerCombat: true },
        effect: { op: 'gainLife', amount: 1 }
      }],
      modes: [{
        id: 'grave-mode',
        timing: 'instant',
        effect: { op: 'gainLife', amount: 1 }
      }]
    }
  }));
  assert.deepEqual(compiled.abilities[0].timing, { speed: 'instant', onlyDuringCombat: true, oncePerCombat: true });
  assert.equal(compiled.modes[0].timing, 'instant');

  const invalid = definition('step28-bad-timing', {
    script: { version: 1, abilities: [{ kind: 'activated', cost: {}, timing: { speed: 'warp-speed' }, effect: { op: 'gainLife', amount: 1 } }] }
  });
  assert.throws(() => e.compileCardScript(invalid), /unknown timing speed/i);
});
