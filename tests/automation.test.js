import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { engine, putBattlefield, setPhase } from './helpers.js';
import { humanAutomationDecision, meaningfulResponseActions } from '../src/utils/turnAutomation.js';

function giveInstantResponse(e) {
  const p = e.state.players.player;
  putBattlefield(e, 'player', 'mountain');
  p.hand.push({ instanceId: 'response-bolt', cardId: 'lightning-bolt', owner: 'player', controller: 'player', zone: 'hand' });
}

function putOpponentSpellOnStack(e) {
  e.state.stack.push({
    id: 'incoming-spell',
    type: 'spell',
    controller: 'ai',
    card: { instanceId: 'incoming-card', cardId: 'grizzly-bears', owner: 'ai', controller: 'ai', zone: 'stack' }
  });
}

test('AI-turn automation auto-passes empty-stack priority even when an instant is technically castable', () => {
  const e = engine();
  setPhase(e, 'PRECOMBAT_MAIN', { activePlayer: 'ai', priorityPlayer: 'player' });
  giveInstantResponse(e);
  assert.ok(meaningfulResponseActions(e).some(action => action.type === 'CAST_SPELL'));
  const decision = humanAutomationDecision(e, { autoPass: true });
  assert.equal(decision.mode, 'AUTO_PASS');
  assert.equal(decision.kind, 'routine-priority');
});

test('AI-turn automation pauses on the stack only when the human has a meaningful legal response', () => {
  const e = engine();
  setPhase(e, 'PRECOMBAT_MAIN', { activePlayer: 'ai', priorityPlayer: 'player' });
  putOpponentSpellOnStack(e);
  assert.equal(humanAutomationDecision(e, { autoPass: true }).mode, 'AUTO_PASS');

  giveInstantResponse(e);
  const decision = humanAutomationDecision(e, { autoPass: true });
  assert.equal(decision.mode, 'PAUSE');
  assert.equal(decision.kind, 'stack-response');
  assert.ok(decision.actions.some(action => action.type === 'CAST_SPELL'));
});

test('hold priority interrupts an otherwise automatic opponent turn', () => {
  const e = engine();
  setPhase(e, 'UPKEEP', { activePlayer: 'ai', priorityPlayer: 'player' });
  const decision = humanAutomationDecision(e, { autoPass: true, holdPriority: true });
  assert.equal(decision.mode, 'PAUSE');
  assert.equal(decision.kind, 'held-priority');
});

test('turn automation can be disabled to restore manual human priority during AI turns', () => {
  const e = engine();
  setPhase(e, 'UPKEEP', { activePlayer: 'ai', priorityPlayer: 'player' });
  const decision = humanAutomationDecision(e, { autoPass: false });
  assert.equal(decision.mode, 'PAUSE');
  assert.equal(decision.kind, 'manual-priority');
});

test('the next retained priority after a human response can auto-pass to resume the AI turn', () => {
  const e = engine();
  setPhase(e, 'PRECOMBAT_MAIN', { activePlayer: 'ai', priorityPlayer: 'player' });
  giveInstantResponse(e);
  putOpponentSpellOnStack(e);
  const decision = humanAutomationDecision(e, { autoPass: true, skipNextPriority: true });
  assert.equal(decision.mode, 'AUTO_PASS');
  assert.equal(decision.kind, 'resume');
});

test('being the current defender always pauses automation for blocker declaration', () => {
  const e = engine();
  setPhase(e, 'DECLARE_BLOCKERS', { activePlayer: 'ai', priorityPlayer: 'player', turnActionPending: 'DECLARE_BLOCKERS' });
  e.state.combat.currentDefender = 'player';
  const decision = humanAutomationDecision(e, { autoPass: true });
  assert.equal(decision.mode, 'PAUSE');
  assert.equal(decision.kind, 'blockers');
});

test('the human active turn stays manual while the new UI exposes AI auto-pass and hold-priority controls', () => {
  const e = engine();
  setPhase(e, 'PRECOMBAT_MAIN', { activePlayer: 'player', priorityPlayer: 'player' });
  assert.equal(humanAutomationDecision(e, { autoPass: true }).kind, 'your-turn');

  const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /Auto-pass AI turns/);
  assert.match(app, /Hold next priority/);
  assert.match(app, /Pass & Resume AI/);
  assert.match(app, /humanAutomationDecision/);
});
