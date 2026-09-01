import test from 'node:test';
import assert from 'node:assert/strict';
import { engine, putBattlefield, rawEngine, setPhase } from './helpers.js';

test('Category 5 BUG-021: legend rule pauses for the controller to choose one permanent to keep', () => {
  const e = engine();
  const first = putBattlefield(e, 'player', 'hakbal');
  const second = putBattlefield(e, 'player', 'hakbal', { counters: { '+1/+1': 2 } });

  e.stateBasedActions();

  assert.equal(e.state.pendingChoice?.type, 'LEGEND_RULE');
  assert.deepEqual(new Set(e.state.pendingChoice.permanentIds), new Set([first.instanceId, second.instanceId]));
  assert.equal(e.state.players.player.battlefield.filter(card => card.cardId === 'hakbal').length, 2);

  e.perform('player', { type: 'CHOOSE_LEGEND', keepInstanceId: second.instanceId });
  assert.equal(e.findPermanent(first.instanceId), null);
  assert.equal(e.findPermanent(second.instanceId)?.instanceId, second.instanceId);
  assert.ok(e.state.players.player.graveyard.some(card => card.instanceId === first.instanceId));
});

test('Category 5 BUG-022: a zone change clears counters and all battlefield-only state', () => {
  const e = engine();
  const creature = putBattlefield(e, 'player', 'grizzly-bears', {
    tapped: true,
    summoningSick: true,
    counters: { '+1/+1': 3 },
    damageMarked: 1,
    deathtouchMarked: true,
    attacking: true,
    blocking: 'attacker-id',
    modifiers: { power: 2, toughness: -1, keywords: ['flying'] }
  });

  const moved = e.toGraveyard(creature);

  assert.equal(moved.zone, 'graveyard');
  assert.equal(moved.tapped, false);
  assert.equal(moved.summoningSick, false);
  assert.deepEqual(moved.counters, {});
  assert.equal(moved.damageMarked, 0);
  assert.equal(moved.deathtouchMarked, false);
  assert.equal(moved.attacking, false);
  assert.equal(moved.blocking, null);
  assert.deepEqual(moved.modifiers, { power: 0, toughness: 0, keywords: [] });
  assert.equal(moved.createdTurn, null);
  assert.equal(moved.controlledSinceTurn, null);
});

test('Category 5 BUG-023: a dead token triggers dies events, then ceases to exist at the next SBA check', () => {
  const e = engine();
  putBattlefield(e, 'player', 'smaug');
  e.effects.createToken('player', { name: 'Pest', typeLine: 'Creature — Pest', power: 1, toughness: 1 }, 1);
  const token = e.state.players.player.battlefield.find(card => card.isToken && card.cardId === 'token:Pest');

  e.toGraveyard(token, true);

  assert.ok(e.state.players.player.graveyard.some(card => card.instanceId === token.instanceId));
  assert.ok(e.state.history.some(event => event.type === 'CREATURE_DIED' && event.target.instanceId === token.instanceId));
  assert.ok(e.state.stack.some(item => item.type === 'trigger'), 'dies trigger was captured before token cleanup');

  e.stateBasedActions();
  assert.equal(e.state.players.player.graveyard.some(card => card.instanceId === token.instanceId), false);
});

test('Category 5 BUG-024: a commander may remain in graveyard or later move from exile to command', () => {
  const e = engine();
  const player = e.state.players.player;
  const commander = player.command.shift();
  commander.zone = 'battlefield';
  commander.controller = 'player';
  player.battlefield.push(commander);

  e.destroy(commander);
  assert.ok(player.graveyard.includes(commander));
  e.stateBasedActions();
  e.perform('player', { type: 'CHOOSE_COMMANDER_ZONE', moveToCommand: false });
  assert.ok(player.graveyard.includes(commander));
  assert.equal(commander.commanderZoneChoicePending, undefined);

  e.exile(commander);
  e.stateBasedActions();
  assert.equal(e.state.pendingChoice?.fromZone, 'exile');
  e.perform('player', { type: 'CHOOSE_COMMANDER_ZONE', moveToCommand: true });
  assert.ok(player.command.includes(commander));
});

test('Category 5 BUG-024: hand/library commander moves offer the replacement choice before moving', () => {
  const e = engine();
  const player = e.state.players.player;
  const commander = player.command[0];

  e.moveToZone(commander, 'hand', 'player');

  assert.ok(player.command.includes(commander), 'commander has not moved before its replacement choice');
  assert.equal(e.state.pendingChoice?.replacement, true);
  e.perform('player', { type: 'CHOOSE_COMMANDER_ZONE', moveToCommand: false });
  assert.ok(player.hand.includes(commander));
});

test('Category 5 BUG-025: only combat damage from a commander increments its damage total', () => {
  const e = engine();
  const commander = putBattlefield(e, 'player', 'hakbal', { isCommander: true });

  e.dealDamageToPlayer('ai', 5, commander);
  assert.deepEqual(e.state.players.ai.commanderDamage, {});

  e.dealDamageToPlayer('ai', 7, commander, { combat: true });
  assert.equal(e.state.players.ai.commanderDamage[commander.instanceId], 7);
});

test('Category 5 BUG-026: SBAs finish after ability resolution before priority is granted', () => {
  const e = engine();
  const creature = putBattlefield(e, 'player', 'grizzly-bears');
  setPhase(e, 'PRECOMBAT_MAIN');
  e.state.stack.push({
    id: 'zero-toughness-ability',
    type: 'ability',
    controller: 'player',
    source: creature,
    effect: { type: 'pump', filter: { notSelf: 'unused' }, toughness: -2 }
  });

  e.perform('player', { type: 'PASS_PRIORITY' });
  e.perform('ai', { type: 'PASS_PRIORITY' });

  assert.equal(e.findPermanent(creature.instanceId), null);
  assert.equal(e.state.priorityPlayer, 'player');
});

test('Category 5 BUG-027: advertised lifecycle and zone events are emitted with useful payloads', () => {
  const e = rawEngine();
  assert.ok(e.state.history.some(event => event.type === 'GAME_START' && event.controller === 'player'));
  e.perform('player', { type: 'KEEP_HAND' });
  e.perform('ai', { type: 'KEEP_HAND' });
  assert.ok(e.state.history.some(event => event.type === 'TURN_START' && event.turn === 1 && event.playerId === 'player'));

  const creature = putBattlefield(e, 'player', 'grizzly-bears');
  e.toGraveyard(creature, true);
  const leave = e.state.history.find(event => event.type === 'LEAVE_BATTLEFIELD' && event.object?.instanceId === creature.instanceId);
  assert.equal(leave.fromZone, 'battlefield');
  assert.equal(leave.toZone, 'graveyard');
  assert.equal(leave.controller, 'player');
  assert.equal(leave.owner, 'player');
});

test('Category 5 BUG-027: combat damage events identify their damage assignments', () => {
  const e = engine();
  const attacker = putBattlefield(e, 'player', 'grizzly-bears');
  setPhase(e, 'DECLARE_ATTACKERS', { turnActionPending: 'DECLARE_ATTACKERS' });
  e.perform('player', { type: 'DECLARE_ATTACKERS', attackers: [attacker.instanceId] });
  e.perform('player', { type: 'PASS_PRIORITY' });
  e.perform('ai', { type: 'PASS_PRIORITY' });
  e.perform('ai', { type: 'DECLARE_BLOCKERS', blockers: {} });
  e.perform('player', { type: 'PASS_PRIORITY' });
  e.perform('ai', { type: 'PASS_PRIORITY' });

  const event = e.state.history.find(entry => entry.type === 'COMBAT_DAMAGE');
  assert.equal(event.combat, true);
  assert.equal(event.damageEvents.length, 1);
  assert.equal(event.damageEvents[0].source.instanceId, attacker.instanceId);
  assert.equal(event.damageEvents[0].targetPlayer, 'ai');
});
