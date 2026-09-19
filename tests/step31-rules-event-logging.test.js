import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/engine/GameEngine.js';
import { ENGINE_EVENT } from '../src/engine/events/index.js';
import { db, decks } from './helpers.js';

const playable = decks.filter(deck => deck.playable !== false);

function make(seed = 'step31-seed') {
  const e = new GameEngine(playable[0], playable[1], db, { seed, startingPlayer: 'first', rulesVersion: 'step31-test' });
  e.start();
  return e;
}

test('Step 31 exposes player, developer, and opt-in verbose log levels', () => {
  const e = make();
  assert.ok(e.getRulesLogSnapshot({ level: 'developer' }).length > 0);
  assert.ok(e.getRulesLogSnapshot({ level: 'player' }).length > 0);
  assert.equal(e.getRulesLogSnapshot({ level: 'verbose' }).length, 0);
  e.setVerboseRulesTracing(true);
  e.log('SBA_BATCH', { actions: [] });
  assert.ok(e.getRulesLogSnapshot({ level: 'verbose' }).some(row => row.kind === 'rules-intervention'));
});

test('Step 31 records authoritative action lifecycle and rejection reasons', () => {
  const e = make();
  const wrong = e.state.playerOrder.find(id => id !== e.state.priorityPlayer);
  const response = e.submitAction(wrong, { type: 'PASS_PRIORITY' });
  assert.equal(response.ok, false);
  const dev = e.getRulesLogSnapshot({ level: 'developer' });
  assert.ok(dev.some(row => row.kind === 'action-requested'));
  assert.ok(dev.some(row => row.kind === 'action-rejected' && row.detail.stage === 'validation'));
});

test('Step 31 correlates event records with stable event/action identifiers', () => {
  const e = make();
  const pid = e.state.activePlayer;
  e.events.dispatch(ENGINE_EVENT.GAIN_LIFE, { playerId: pid, amount: 2 }, { cause: 'step31-test' });
  const eventRow = e.getRulesLogSnapshot({ level: 'developer' }).find(row => row.kind === 'event' && row.detail.type === ENGINE_EVENT.GAIN_LIFE);
  assert.ok(eventRow);
  assert.ok(eventRow.detail.eventId);
  assert.ok(eventRow.ids.eventIds.includes(eventRow.detail.eventId));
  assert.ok(eventRow.ids.playerIds.includes(pid));
});

test('Step 31 verbose legality trace explains allow/deny decisions without changing state', () => {
  const e = make(); e.setVerboseRulesTracing(true);
  const pid = e.state.activePlayer;
  const before = e.getReplayStateHash();
  const result = e.traceLegality('DRAW', pid, { count: 1 });
  assert.equal(typeof result.allowed, 'boolean');
  assert.equal(e.getReplayStateHash(), before);
  assert.ok(e.getRulesLogSnapshot({ level: 'verbose' }).some(row => row.kind === 'legality'));
});

test('Step 31 verbose layer trace identifies applied effect chain', () => {
  const e = make(); e.setVerboseRulesTracing(true);
  const pid = e.state.activePlayer;
  const target = e.state.players[pid].battlefield[0] || e.state.players[pid].command[0];
  assert.ok(target);
  const result = e.traceCharacteristics(target);
  assert.ok(result);
  assert.ok(e.getRulesLogSnapshot({ level: 'verbose' }).some(row => row.kind === 'layers'));
});

test('Step 31 diagnostic bundle contains reproduction metadata, logs, events, and replay', () => {
  const e = make(31);
  const bundle = e.getDiagnosticBundle();
  assert.equal(bundle.schema, 'mtg-commander-diagnostic-bundle');
  assert.equal(bundle.schemaVersion, 1);
  assert.equal(bundle.reproduction.rulesVersion, 'step31-test');
  assert.equal(bundle.reproduction.seed, 31);
  assert.ok(bundle.reproduction.stateHash);
  assert.ok(Array.isArray(bundle.logs.developer));
  assert.ok(Array.isArray(bundle.eventLog));
  assert.equal(bundle.replay.schema, 'mtg-commander-replay');
});

test('Step 31 replay export carries structured rules logs', () => {
  const e = make();
  const replay = JSON.parse(e.serializeReplay());
  assert.ok(replay.rulesLogs);
  assert.ok(Array.isArray(replay.rulesLogs.player));
  assert.ok(Array.isArray(replay.rulesLogs.developer));
  assert.ok(Array.isArray(replay.rulesLogs.verbose));
});

test('Step 31 logger reset begins a fresh diagnostic segment', () => {
  const e = make();
  assert.ok(e.getRulesLogSnapshot().length > 0);
  e.reset();
  const logs = e.getRulesLogSnapshot();
  assert.ok(logs.length > 0, 'new start should create fresh logs');
  assert.equal(logs[0].sequence, 1);
});
