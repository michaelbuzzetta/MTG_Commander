import test from 'node:test';
import assert from 'node:assert/strict';
import { engine, putBattlefield, setPhase } from './helpers.js';
import {
  LOOP_CLASS,
  SHORTCUT_CONDITION,
  classifyLoopCycle,
  finiteLoopShortcut,
  repeatUntilLoopShortcut,
  hashAuthoritativeState,
  SimulationSafetyBudgetError
} from '../src/engine/loops/index.js';

function loopEngine({ mana = 0, lifeCost = 0 } = {}) {
  const e = engine();
  const ability = {
    type: 'mana',
    tap: false,
    mana: { C: mana },
    ...(lifeCost ? { cost: { life: lifeCost } } : {})
  };
  const loopCardId = 'step19-loop-source';
  e.db[loopCardId] = {
    id: loopCardId,
    name: 'Step 19 Loop Source',
    typeLine: 'Artifact',
    manaCost: '{0}',
    manaValue: 0,
    colors: [],
    colorIdentity: [],
    keywords: [],
    abilities: [ability],
    spellEffects: [],
    oracleText: '',
    supported: true
  };
  const permanent = putBattlefield(e, 'player', loopCardId);
  setPhase(e, 'PRECOMBAT_MAIN', { activePlayer: 'player', priorityPlayer: 'player' });
  e.loops.seed();
  return { e, ability, permanent };
}

function activate(e, permanent, ability) {
  return e.submitAction('player', {
    type: 'ACTIVATE_MANA',
    permanentId: permanent.instanceId,
    ability
  });
}

test('Step 19: authoritative loop hash ignores diagnostic history but includes priority context', () => {
  const e = engine();
  const before = hashAuthoritativeState(e.state);
  e.state.history.push({ type: 'DIAGNOSTIC_ONLY', arbitrary: true });
  assert.equal(hashAuthoritativeState(e.state), before, 'diagnostic history must not prevent loop detection');
  const originalPriority = e.state.priorityPlayer;
  e.state.priorityPlayer = e.opponent(originalPriority);
  assert.notEqual(hashAuthoritativeState(e.state), before, 'priority is rules-relevant loop state');
});

test('Step 19: loop classifier distinguishes mandatory, optional, resource, choice, and terminating cycles', () => {
  const action = { playerId: 'player', kind: 'action', action: { type: 'X' }, actionFingerprint: 'x' };
  assert.equal(classifyLoopCycle({ exactState: true, steps: [{ ...action, mandatory: true }] }), LOOP_CLASS.MANDATORY_INFINITE);
  assert.equal(classifyLoopCycle({ exactState: true, steps: [action] }), LOOP_CLASS.OPTIONAL);
  assert.equal(classifyLoopCycle({ exactState: true, steps: [{ ...action, kind: 'choice' }] }), LOOP_CLASS.WITH_CHOICES);
  assert.equal(classifyLoopCycle({ exactState: false, steps: [action], progressDelta: { 'player.mana.C': 1 } }), LOOP_CLASS.DETERMINISTIC_RESOURCE);
  assert.equal(classifyLoopCycle({ exactState: false, steps: [action], progressDelta: { 'player.life': -1 } }), LOOP_CLASS.PROGRESS_TOWARD_TERMINATION);
});

test('Step 19: exact no-progress player loop is detected as optional and exposed as a shortcut candidate', () => {
  const { e, ability, permanent } = loopEngine({ mana: 0 });
  assert.equal(activate(e, permanent, ability).ok, true);
  const loop = e.getLoopSnapshot().loops.at(-1);
  assert.equal(loop.classification, LOOP_CLASS.OPTIONAL);
  assert.equal(loop.period, 1);
  assert.equal(loop.shortcutEligible, true);
  const legal = e.getLoopShortcutActions('player');
  assert.equal(legal.length, 1);
  assert.equal(legal[0].loopId, loop.id);
  assert.equal(legal[0].requiresIterationCount, true);
  assert.equal(legal[0].iterations, 1);
  assert.equal(e.isActionLegal('player', legal[0]), true, 'engine-advertised shortcut action must itself be legal');
});

test('Step 19: optional no-progress loops require an explicit finite stop/count', () => {
  const { e, ability, permanent } = loopEngine({ mana: 0 });
  activate(e, permanent, ability);
  const loop = e.getLoopSnapshot().loops.at(-1);

  const missingStop = e.submitAction('player', { type: 'LOOP_SHORTCUT', loopId: loop.id });
  assert.equal(missingStop.ok, false);
  assert.match(missingStop.error.message, /exactly one of iterations or until/i);

  const shortcut = e.submitAction('player', finiteLoopShortcut(loop.id, 5));
  assert.equal(shortcut.ok, true);
  assert.equal(shortcut.result.iterations, 5);
  assert.equal(shortcut.result.expandedActions, 5);
  assert.equal(e.state.players.player.manaPool.C, 0);
});

test('Step 19: repeated resource-producing actions are classified and can be shortcut by finite iterations', () => {
  const { e, ability, permanent } = loopEngine({ mana: 1 });
  assert.equal(activate(e, permanent, ability).ok, true);
  assert.equal(activate(e, permanent, ability).ok, true);
  const loop = e.getLoopSnapshot().loops.find(item => item.classification === LOOP_CLASS.DETERMINISTIC_RESOURCE);
  assert.ok(loop);
  assert.deepEqual(loop.progressDelta, { 'player.mana.C': 1 });
  assert.equal(e.state.players.player.manaPool.C, 2);

  const result = e.submitAction('player', finiteLoopShortcut(loop.id, 5));
  assert.equal(result.ok, true);
  assert.equal(e.state.players.player.manaPool.C, 7);
  assert.equal(result.result.iterations, 5);
});

test('Step 19: repeat-until shortcuts stop exactly when a validated engine condition becomes true', () => {
  const { e, ability, permanent } = loopEngine({ mana: 1 });
  activate(e, permanent, ability);
  activate(e, permanent, ability);
  const loop = e.getLoopSnapshot().loops.find(item => item.classification === LOOP_CLASS.DETERMINISTIC_RESOURCE);
  const action = repeatUntilLoopShortcut(loop.id, {
    type: SHORTCUT_CONDITION.MANA_AT_LEAST,
    playerId: 'player',
    color: 'C',
    amount: 10
  }, 20);
  const result = e.submitAction('player', action);
  assert.equal(result.ok, true);
  assert.equal(result.result.iterations, 8);
  assert.equal(e.state.players.player.manaPool.C, 10);
});

test('Step 19: repeat-until is rejected for an exact no-progress loop', () => {
  const { e, ability, permanent } = loopEngine({ mana: 0 });
  activate(e, permanent, ability);
  const loop = e.getLoopSnapshot().loops.at(-1);
  const result = e.submitAction('player', repeatUntilLoopShortcut(loop.id, {
    type: SHORTCUT_CONDITION.MANA_AT_LEAST,
    playerId: 'player',
    color: 'C',
    amount: 1
  }, 10));
  assert.equal(result.ok, false);
  assert.match(result.error.message, /no-progress loop cannot use repeat-until/i);
});

test('Step 19: repeated actions consuming a finite resource are classified as progress toward termination, not shortcut-infinite', () => {
  const { e, ability, permanent } = loopEngine({ mana: 0, lifeCost: 1 });
  activate(e, permanent, ability);
  activate(e, permanent, ability);
  const loop = e.getLoopSnapshot().loops.find(item => item.classification === LOOP_CLASS.PROGRESS_TOWARD_TERMINATION);
  assert.ok(loop);
  assert.deepEqual(loop.progressDelta, { 'player.life': -1 });
  assert.equal(loop.shortcutEligible, false);
});

test('Step 19: mandatory event recursion at an identical state is resolved as a draw instead of hanging', () => {
  const e = engine();
  e.events.register('STEP19_MANDATORY_RECURSION', {
    commit: () => {
      e.events.dispatch('STEP19_MANDATORY_RECURSION', { token: 1 }, { stabilize: false });
      return true;
    }
  });

  assert.doesNotThrow(() => e.events.dispatch('STEP19_MANDATORY_RECURSION', { token: 1 }, { stabilize: false }));
  assert.equal(e.state.winner, 'draw');
  const loop = e.getLoopSnapshot().loops.find(item => item.classification === LOOP_CLASS.MANDATORY_INFINITE);
  assert.ok(loop);
  assert.ok(e.state.history.some(row => row.type === 'MANDATORY_LOOP_DRAW'));
});

test('Step 19: recursive event safety budget halts nonrepeating runaway recursion with diagnostics', () => {
  const e = engine();
  e.safety.limits.maxEventDepth = 3;
  e.events.register('STEP19_DEEP_RECURSION', {
    commit: event => e.events.dispatch('STEP19_DEEP_RECURSION', { n: Number(event.payload.n || 0) + 1 }, { stabilize: false })
  });
  assert.throws(
    () => e.events.dispatch('STEP19_DEEP_RECURSION', { n: 0 }, { stabilize: false }),
    error => error instanceof SimulationSafetyBudgetError && error.code === 'SIMULATION_SAFETY_BUDGET_EXCEEDED' && error.diagnostic.kind === 'event-depth'
  );
  assert.equal(e.getSafetyBudgetSnapshot().lastFailure.kind, 'event-depth');
});

test('Step 19: replay stores one semantic shortcut with deterministic expansion data rather than every expanded click', () => {
  const { e, ability, permanent } = loopEngine({ mana: 1 });
  activate(e, permanent, ability);
  activate(e, permanent, ability);
  const loop = e.getLoopSnapshot().loops.find(item => item.classification === LOOP_CLASS.DETERMINISTIC_RESOURCE);
  const beforeCount = JSON.parse(e.serializeReplay()).actions.length;
  const result = e.submitAction('player', finiteLoopShortcut(loop.id, 25));
  assert.equal(result.ok, true);
  const replay = JSON.parse(e.serializeReplay());
  assert.equal(replay.actions.length, beforeCount + 1);
  const semantic = replay.actions.at(-1).action;
  assert.equal(semantic.type, 'LOOP_SHORTCUT');
  assert.equal(semantic.iterations, 25);
  assert.equal(semantic.loopSignature, loop.signature);
  assert.equal(semantic.sequence.length, 1);
  assert.equal(semantic.sequence[0].action.type, 'ACTIVATE_MANA');
  assert.ok(replay.loops.loops.some(item => item.id === loop.id));
});

test('Step 19: shortcut safety limits reject excessive requested iteration counts before mutation', () => {
  const { e, ability, permanent } = loopEngine({ mana: 1 });
  activate(e, permanent, ability);
  activate(e, permanent, ability);
  const loop = e.getLoopSnapshot().loops.find(item => item.classification === LOOP_CLASS.DETERMINISTIC_RESOURCE);
  const before = e.state.players.player.manaPool.C;
  const result = e.submitAction('player', finiteLoopShortcut(loop.id, e.safety.limits.maxShortcutIterations + 1));
  assert.equal(result.ok, false);
  assert.match(result.error.message, /iteration limit/i);
  assert.equal(e.state.players.player.manaPool.C, before);
});

test('Step 19: reset clears prior loop observations and safety diagnostics', () => {
  const { e, ability, permanent } = loopEngine({ mana: 0 });
  activate(e, permanent, ability);
  assert.equal(e.getLoopSnapshot().loops.length, 1);
  e.safety.lastFailure = { kind: 'fixture' };
  e.reset();
  assert.equal(e.getLoopSnapshot().loops.length, 0);
  assert.equal(e.getLoopSnapshot().observationCount, 1);
  assert.equal(e.getSafetyBudgetSnapshot().lastFailure, null);
});
