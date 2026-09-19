import test from 'node:test';
import assert from 'node:assert/strict';
import { EVENT, PHASES } from '../src/engine/constants.js';
import { TURN_PHASE_GROUP, STEP_DEFINITION } from '../src/engine/turn/index.js';
import { engine, rawEngine, putBattlefield, setPhase } from './helpers.js';

function driveOneDecision(e) {
  const s = e.state;
  if (s.winner) return false;
  if (s.pendingChoice) {
    if (s.pendingChoice.type === 'CLEANUP_DISCARD') {
      const ids = s.players[s.pendingChoice.playerId].hand.slice(0, s.pendingChoice.count).map(card => card.instanceId);
      e.perform(s.pendingChoice.playerId, { type: 'DISCARD_CARDS', cardInstanceIds: ids });
      return true;
    }
    if (s.pendingChoice.type === 'TRIGGER_ORDER') {
      e.perform(s.pendingChoice.playerId, { type: 'ORDER_TRIGGERS', triggerIds: [...s.pendingChoice.triggerIds] });
      return true;
    }
    if (s.pendingChoice.type === 'OPTIONAL_TRIGGER') {
      e.perform(s.pendingChoice.playerId, { type: 'CHOOSE_TRIGGER', accept: true });
      return true;
    }
    throw new Error(`Unhandled test choice ${s.pendingChoice.type}`);
  }
  if (s.turnActionPending === 'DECLARE_ATTACKERS') {
    e.perform(s.activePlayer, { type: 'DECLARE_ATTACKERS', attackers: [] });
    return true;
  }
  if (s.turnActionPending === 'DECLARE_BLOCKERS') {
    e.perform(s.combat.currentDefender, { type: 'DECLARE_BLOCKERS', blockers: {} });
    return true;
  }
  if (s.priorityPlayer) {
    e.perform(s.priorityPlayer, { type: 'PASS_PRIORITY' });
    return true;
  }
  return false;
}

function driveUntil(e, predicate, max = 500) {
  for (let i = 0; i < max; i++) {
    if (predicate(e.state)) return;
    if (!driveOneDecision(e)) throw new Error(`Turn engine stalled at turn ${e.state.turn} ${e.state.phase}`);
  }
  throw new Error(`Turn engine did not reach requested state within ${max} decisions`);
}

test('Step 4: phase/step definitions model the complete normal turn and priority exceptions', () => {
  assert.deepEqual(PHASES, [
    'UNTAP','UPKEEP','DRAW','PRECOMBAT_MAIN','BEGIN_COMBAT','DECLARE_ATTACKERS',
    'DECLARE_BLOCKERS','FIRST_STRIKE_DAMAGE','COMBAT_DAMAGE','END_COMBAT',
    'POSTCOMBAT_MAIN','END_STEP','CLEANUP'
  ]);
  assert.equal(STEP_DEFINITION.UNTAP.grantsPriority, false);
  assert.equal(STEP_DEFINITION.CLEANUP.grantsPriority, false);
  assert.equal(STEP_DEFINITION.DRAW.turnBasedAction, 'DRAW');
  assert.equal(STEP_DEFINITION.DECLARE_ATTACKERS.turnBasedAction, 'DECLARE_ATTACKERS');
  assert.equal(STEP_DEFINITION.COMBAT_DAMAGE.turnBasedAction, 'COMBAT_DAMAGE');
});

test('Step 4: a no-spell turn advances through every applicable step in rules order', () => {
  const e = engine();
  driveUntil(e, s => s.turn === 2);
  const visited = e.state.history
    .filter(entry => entry.type === 'TURN_STEP_BEGIN' && entry.turn === 1)
    .map(entry => entry.step);
  assert.deepEqual(visited, [
    'UNTAP','UPKEEP','DRAW','PRECOMBAT_MAIN','BEGIN_COMBAT','DECLARE_ATTACKERS',
    'DECLARE_BLOCKERS','COMBAT_DAMAGE','END_COMBAT','POSTCOMBAT_MAIN','END_STEP','CLEANUP'
  ]);
  assert.ok(e.state.history.some(entry => entry.type === 'TURN_STEP_SKIPPED' && entry.step === 'FIRST_STRIKE_DAMAGE'));
});

test('Step 4: beginning-step triggers are observed at the exact upkeep and wait on the stack for priority', () => {
  const e = rawEngine();
  e._registerRuntimeCardDefinition('step4-upkeep-watcher', {
    id: 'step4-upkeep-watcher', name: 'Step 4 Upkeep Watcher', typeLine: 'Enchantment', manaCost: '', manaValue: 0,
    keywords: [], subtypes: [], spellEffects: [], abilities: [{
      type: 'triggered', event: EVENT.PHASE_BEGIN, condition: { controllerEvent: true, phase: 'UPKEEP' }, effect: { type: 'gainLife', amount: 1 }
    }]
  });
  putBattlefield(e, 'player', 'step4-upkeep-watcher');
  e.perform('player', { type: 'KEEP_HAND' });
  e.perform('ai', { type: 'KEEP_HAND' });
  assert.equal(e.state.phase, 'UPKEEP');
  assert.equal(e.state.priorityPlayer, 'player');
  assert.equal(e.state.stack.length, 1);
  assert.equal(e.state.stack[0].eventPayload.phase, 'UPKEEP');
});

test('Step 4: draw is a turn-based action completed before draw-step priority', () => {
  const e = engine();
  setPhase(e, 'UPKEEP', { activePlayer: 'player', priorityPlayer: 'player' });
  const before = e.state.players.player.hand.length;
  e.perform('player', { type: 'PASS_PRIORITY' });
  e.perform('ai', { type: 'PASS_PRIORITY' });
  assert.equal(e.state.phase, 'DRAW');
  assert.equal(e.state.players.player.hand.length, before + 1);
  assert.equal(e.state.priorityPlayer, 'player');
  const drawTba = e.state.history.findLast(entry => entry.type === 'TURN_BASED_ACTION' && entry.action === 'DRAW_FOR_TURN');
  assert.equal(drawTba?.phase, 'DRAW');
});

test('Step 4: extra upkeep, skipped draw and skipped combat alter the next turn sequence without UI special cases', () => {
  const e = engine();
  e.turn.addExtraUpkeeps('ai', 1);
  e.turn.skipNextDrawSteps('ai', 1);
  e.turn.skipNextCombatPhases('ai', 1);
  driveUntil(e, s => s.turn === 2 && s.activePlayer === 'ai');
  const keys = e.state.turnSequence.map(node => node.key);
  assert.deepEqual(keys, ['UNTAP','UPKEEP','UPKEEP','PRECOMBAT_MAIN','POSTCOMBAT_MAIN','END_STEP','CLEANUP']);
  assert.equal(keys.filter(key => key === 'UPKEEP').length, 2);
  assert.ok(!keys.includes('DRAW'));
  assert.ok(!e.state.turnSequence.some(node => node.phaseGroup === TURN_PHASE_GROUP.COMBAT));
});

test('Step 4: extra combat and extra main phases can be inserted into the current turn deterministically', () => {
  const e = engine();
  setPhase(e, 'PRECOMBAT_MAIN', { activePlayer: 'player', priorityPlayer: 'player' });
  e.turn.ensureState();
  e.state.turnSequence = e.state.turnSequence.length ? e.state.turnSequence : [];
  e.turn.addExtraCombatAfterCurrent({ includeMainAfter: true });
  const keys = e.state.turnSequence.map(node => node.key);
  const current = e.state.phaseIndex;
  assert.deepEqual(keys.slice(current + 1, current + 8), [
    'BEGIN_COMBAT','DECLARE_ATTACKERS','DECLARE_BLOCKERS','FIRST_STRIKE_DAMAGE','COMBAT_DAMAGE','END_COMBAT','POSTCOMBAT_MAIN'
  ]);
  assert.ok(e.state.turnSequence.slice(current + 1, current + 8).every(node => node.origin.startsWith('extra')));
});

test('Step 4: extra turns occur before normal turn order and skipped turns are consumed atomically', () => {
  const e = engine();
  e.turn.addExtraTurn('player', 1);
  driveUntil(e, s => s.turn === 2);
  assert.equal(e.state.activePlayer, 'player', 'the queued extra turn occurs immediately after the current turn');
  assert.equal(e.state.extraTurns.player, 0);

  e.turn.skipNextTurns('ai', 1);
  driveUntil(e, s => s.turn === 3);
  assert.equal(e.state.activePlayer, 'player', 'the next normal ai turn was skipped, so play returns to player');
  assert.equal(e.state.skippedTurnHistory.at(-1)?.playerId, 'ai');
});

test('Step 4: an extra turn for the next player does not consume that player’s normal scheduled turn', () => {
  const e = engine();
  e.turn.addExtraTurn('ai', 1);
  driveUntil(e, s => s.turn === 2);
  assert.equal(e.state.activePlayer, 'ai');
  assert.equal(e.state.turnKind, 'extra');
  driveUntil(e, s => s.turn === 3);
  assert.equal(e.state.activePlayer, 'ai');
  assert.equal(e.state.turnKind, 'normal');
});

test('Step 4: cleanup creates priority only when rules activity requires it and then creates a new cleanup step', () => {
  const e = engine();
  e._registerRuntimeCardDefinition('step4-cleanup-watcher', {
    id: 'step4-cleanup-watcher', name: 'Step 4 Cleanup Watcher', typeLine: 'Enchantment', manaCost: '', manaValue: 0,
    keywords: [], subtypes: [], spellEffects: [], abilities: [{ type: 'triggered', event: EVENT.CARD_DISCARDED, effect: { type: 'gainLife', amount: 1 } }]
  });
  putBattlefield(e, 'player', 'step4-cleanup-watcher');
  const ai = e.state.players.ai;
  while (ai.hand.length < 8) e.draw('ai');
  setPhase(e, 'END_STEP', { activePlayer: 'ai', priorityPlayer: 'ai' });
  e.perform('ai', { type: 'PASS_PRIORITY' });
  e.perform('player', { type: 'PASS_PRIORITY' });
  assert.equal(e.state.phase, 'CLEANUP');
  assert.equal(e.state.cleanupIteration, 1);
  e.perform('ai', { type: 'DISCARD_CARDS', cardInstanceIds: [ai.hand[0].instanceId] });
  assert.equal(e.state.cleanupPriority, true);
  assert.equal(e.state.stack.length, 1);
  e.perform('ai', { type: 'PASS_PRIORITY' });
  e.perform('player', { type: 'PASS_PRIORITY' });
  e.perform('ai', { type: 'PASS_PRIORITY' });
  e.perform('player', { type: 'PASS_PRIORITY' });
  assert.equal(e.state.turn, 2);
  assert.ok(e.state.history.some(entry => entry.type === 'CLEANUP_REPEAT' && entry.cleanupIteration === 2));
  const cleanups = e.state.history.filter(entry => entry.type === 'TURN_STEP_BEGIN' && entry.step === 'CLEANUP' && entry.turn === 1);
  assert.equal(cleanups.length, 2);
});

test('Step 4: completed turns and replay metadata record active player, exact sequence, and turn order', () => {
  const e = engine();
  driveUntil(e, s => s.turn === 2);
  const turn = e.state.turnHistory[0];
  assert.equal(turn.turn, 1);
  assert.equal(turn.activePlayer, 'player');
  assert.deepEqual(turn.turnOrder, ['player', 'ai']);
  assert.ok(turn.sequence.some(node => node.key === 'CLEANUP'));
  const replay = JSON.parse(e.serializeReplay());
  assert.equal(replay.turnHistory[0].activePlayer, 'player');
  assert.deepEqual(replay.turnHistory[0].turnOrder, ['player', 'ai']);
  assert.equal(replay.turnState.activePlayer, 'ai');
});
