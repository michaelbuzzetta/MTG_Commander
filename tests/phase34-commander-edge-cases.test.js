import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/engine/GameEngine.js';
import { db, decks } from './helpers.js';

function playable(count = 2) { return decks.filter(d => d.playable !== false).slice(0, count); }
function engine(count = 2) { const d = playable(count); return new GameEngine(d[0], d.slice(1), db, { rng: () => 0.42 }); }

test('Phase 34: commander tax survives counter/removal cycles and is charged only for command-zone casts', () => {
  const e = engine();
  let commander = e.state.players.player.command[0];
  const id = commander.commanderIdentity;
  e.commanders.recordCast('player', commander, { fromZone: 'command' });
  assert.equal(e.commanders.taxFor('player', commander, { zone: 'command' }), 2);

  commander = e._moveZoneNow(commander, 'graveyard', 'player');
  // A cast from a non-command zone does not advance the command-zone ledger.
  e.commanders.recordCast('player', commander, { fromZone: 'graveyard' });
  assert.equal(e.getCommanderTaxLedgerSnapshot('player')[id].castsFromCommandZone, 1);

  commander = e._moveZoneNow(commander, 'command', 'player');
  e.commanders.recordCast('player', commander, { fromZone: 'command' });
  assert.equal(e.getCommanderTaxLedgerSnapshot('player')[id].tax, 4);
});

test('Phase 34: a stolen commander returns to its owner command zone, not its controller command zone', () => {
  const e = engine(3);
  let commander = e._moveZoneNow(e.state.players.player.command[0], 'battlefield', 'player');
  const identity = commander.commanderIdentity;
  e.changeController(commander.instanceId, 'ai');
  commander = e.findPermanent(commander.instanceId);
  assert.equal(commander.controller, 'ai');
  assert.equal(commander.owner, 'player');

  e.toGraveyard(commander, true);
  e.stateBasedActions();
  assert.equal(e.state.pendingChoice?.playerId, 'player');
  e._applyCommanderZoneChoice('player', true);
  const returned = e.state.players.player.command.find(c => c.commanderIdentity === identity);
  assert.ok(returned);
  assert.equal(returned.owner, 'player');
  assert.equal(returned.controller, 'player');
  assert.equal(e.state.players.ai.command.some(c => c.commanderIdentity === identity), false);
});

test('Phase 34: commander damage is keyed by commander identity across controller and zone changes', () => {
  const e = engine(3);
  let commander = e._moveZoneNow(e.state.players.player.command[0], 'battlefield', 'player');
  const identity = commander.commanderIdentity;
  e.dealDamageToPlayer('ai', 8, commander, { combat: true });

  commander = e._moveZoneNow(commander, 'graveyard', 'player');
  commander = e._moveZoneNow(commander, 'battlefield', 'player');
  e.changeController(commander.instanceId, 'ai2');
  commander = e.findPermanent(commander.instanceId);
  e.dealDamageToPlayer('ai', 13, commander, { combat: true });

  assert.equal(e.state.players.ai.commanderDamage[identity], 21);
  e.stateBasedActions();
  assert.equal(e.state.players.ai.lost, true);
});

test('Phase 34: noncombat damage from a commander never contributes to the 21-damage rule', () => {
  const e = engine();
  const commander = e._moveZoneNow(e.state.players.player.command[0], 'battlefield', 'player');
  const identity = commander.commanderIdentity;
  e.dealDamageToPlayer('ai', 20, commander, { combat: false });
  assert.equal(e.state.players.ai.commanderDamage[identity] || 0, 0);
  e.dealDamageToPlayer('ai', 5, commander, { combat: true });
  assert.equal(e.state.players.ai.commanderDamage[identity], 5);
});

test('Phase 34: graveyard/exile commander choices are post-move while hand/library choices replace the move', () => {
  const e = engine();
  let commander = e._moveZoneNow(e.state.players.player.command[0], 'battlefield', 'player');

  e.moveToZone(commander, 'library', 'player');
  assert.equal(commander.zone, 'battlefield');
  assert.equal(e.state.pendingChoice?.replacement, true);
  e._applyCommanderZoneChoice('player', true);
  commander = e.state.players.player.command.find(c => c.isCommander);
  assert.ok(commander);

  commander = e._moveZoneNow(commander, 'battlefield', 'player');
  commander = e._moveZoneNow(commander, 'exile', 'player');
  assert.equal(commander.zone, 'exile');
  assert.equal(commander.commanderZoneChoicePending, true);
  e.stateBasedActions();
  assert.equal(e.state.pendingChoice?.replacement, false);
  e._applyCommanderZoneChoice('player', false);
  assert.equal(e.state.players.player.exile.some(c => c.isCommander), true);
});

test('Phase 34: copies of commanders are not commanders and cannot deal commander damage', () => {
  const e = engine();
  const commander = e._moveZoneNow(e.state.players.player.command[0], 'battlefield', 'player');
  const identity = commander.commanderIdentity;
  const fakeCopy = structuredClone(commander);
  fakeCopy.instanceId = `${commander.instanceId}-copy`;
  fakeCopy.gameObjectId = `${commander.gameObjectId || commander.instanceId}-copy`;
  fakeCopy.isCommander = false;
  delete fakeCopy.commanderIdentity;
  e.dealDamageToPlayer('ai', 21, fakeCopy, { combat: true });
  assert.equal(e.state.players.ai.commanderDamage[identity] || 0, 0);
});
