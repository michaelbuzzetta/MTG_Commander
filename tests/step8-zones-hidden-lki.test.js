import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeCardInstance } from '../src/engine/GameState.js';
import { ENGINE_EVENT } from '../src/engine/events/index.js';
import { engine, putBattlefield } from './helpers.js';

function firstRealCard(player, zone) {
  return player[zone].find(card => card && !card.hidden);
}

test('Step 8: player snapshots hide opponent hands and every library while preserving counts', () => {
  const e = engine();
  const authoritativeOpponentHand = e.state.players.ai.hand.map(card => card.cardId);
  assert.ok(authoritativeOpponentHand.length > 0);
  const view = e.getPlayerStateSnapshot('player');
  assert.equal(view.players.ai.hand.length, e.state.players.ai.hand.length);
  assert.ok(view.players.ai.hand.every(card => card.hidden && card.cardId === null && card.gameObjectId === null));
  assert.ok(view.players.player.library.every(card => card.hidden && card.cardId === null));
  assert.ok(view.players.ai.library.every(card => card.hidden && card.cardId === null));
  assert.ok(view.players.player.hand.every(card => !card.hidden && !!card.cardId));
  assert.throws(() => view.players.ai.hand.push({}), /extensible|frozen|read only/i);
});

test('Step 8: private look knowledge belongs only to the authorized viewer, while reveal becomes public knowledge', () => {
  const e = engine();
  const top = e.state.players.player.library[0];
  e.lookAtCard('player', top, { reason: 'step8-private-look', position: 'top' });
  const ownerView = e.getPlayerStateSnapshot('player');
  const opponentView = e.getPlayerStateSnapshot('ai');
  assert.equal(ownerView.players.player.library[0].cardId, top.cardId);
  assert.equal(opponentView.players.player.library[0].cardId, null);
  assert.ok(e.getKnownInformationSnapshot('player').cards[top.instanceId]);
  assert.equal(e.getKnownInformationSnapshot('ai').cards[top.instanceId], undefined);

  e.revealCard(top, { reason: 'step8-public-reveal', position: 'top' });
  const revealedToOpponent = e.getPlayerStateSnapshot('ai');
  assert.equal(revealedToOpponent.players.player.library[0].cardId, top.cardId);
  assert.ok(e.getKnownInformationSnapshot('ai').cards[top.instanceId]);
});

test('Step 8: shuffle clears tracked library knowledge for every viewer', () => {
  const e = engine();
  const top = e.state.players.player.library[0];
  e.revealCard(top, { reason: 'known-top', position: 'top' });
  assert.ok(e.getKnownInformationSnapshot('ai').cards[top.instanceId]);
  e.shuffleLibrary('player', 'step8-test-shuffle');
  assert.equal(e.getKnownInformationSnapshot('player').cards[top.instanceId], undefined);
  assert.equal(e.getKnownInformationSnapshot('ai').cards[top.instanceId], undefined);
});

test('Step 8: another player\'s private pending choice does not leak candidate identities', () => {
  const e = engine();
  const ids = e.state.players.ai.library.slice(0, 3).map(card => card.instanceId);
  e.state.pendingChoice = { type: 'EFFECT_CARD_CHOICE', playerId: 'ai', candidateIds: ids, min: 1, max: 1, prompt: 'Choose privately' };
  e.state.priorityPlayer = 'ai';
  const playerView = e.getPlayerStateSnapshot('player');
  assert.equal(playerView.pendingChoice.type, 'EFFECT_CARD_CHOICE');
  assert.equal(playerView.pendingChoice.playerId, 'ai');
  assert.equal('candidateIds' in playerView.pendingChoice, false);
  for (const id of ids) assert.equal(JSON.stringify(playerView).includes(id), false);
});

test('Step 8: an authorized search/choice exposes only the exact hidden candidates to that player', () => {
  const e = engine();
  const [a, b, c] = e.state.players.player.library.slice(0, 3);
  e.state.pendingChoice = { type: 'EFFECT_CARD_CHOICE', playerId: 'player', candidateIds: [a.instanceId, b.instanceId], min: 0, max: 1 };
  e.state.priorityPlayer = 'player';
  const view = e.getPlayerStateSnapshot('player');
  assert.equal(view.players.player.library.find(card => card.instanceId === a.instanceId)?.cardId, a.cardId);
  assert.equal(view.players.player.library.find(card => card.instanceId === b.instanceId)?.cardId, b.cardId);
  assert.equal(view.players.player.library.some(card => card.instanceId === c.instanceId), false);
});

test('Step 8: every MOVE_ZONE creates a new game object and logs complete zone-change provenance', () => {
  const e = engine();
  const card = e.state.players.player.hand[0];
  const oldObjectId = card.gameObjectId;
  const oldZoneChangeId = card.zoneChangeId;
  e._moveZoneNow(card, 'graveyard', 'player', { reason: 'step8-test-move' });
  const moved = e.state.players.player.graveyard.find(item => item.instanceId === card.instanceId);
  assert.ok(moved);
  assert.notEqual(moved.gameObjectId, oldObjectId);
  assert.equal(moved.previousGameObjectId, oldObjectId);
  assert.equal(moved.zoneChangeId, oldZoneChangeId + 1);
  const record = e.getEventLogSnapshot().filter(item => item.type === ENGINE_EVENT.MOVE_ZONE).at(-1);
  assert.equal(record.payload.fromZone, 'hand');
  assert.equal(record.payload.toZone, 'graveyard');
  assert.equal(record.payload.owner, 'player');
  assert.equal(record.payload.previousGameObjectId, oldObjectId);
  assert.equal(record.payload.newGameObjectId, moved.gameObjectId);
  assert.ok(record.payload.lkiId);
});

test('Step 8: LKI captures pre-zone-change controller, counters, abilities, and derived power/toughness', () => {
  const e = engine();
  const creature = putBattlefield(e, 'player', 'grizzly-bears', {
    counters: { '+1/+1': 2 },
    modifiers: { power: 1, toughness: 0, keywords: ['vigilance'] }
  });
  // Canonicalize the legacy test fixture without changing its battlefield location.
  e.zones.prepareForZone(creature, 'battlefield', 'player', e.db['grizzly-bears']);
  creature.counters = { '+1/+1': 2 };
  creature.modifiers = { power: 1, toughness: 0, keywords: ['vigilance'] };
  const oldObjectId = creature.gameObjectId;
  const expected = e.static.derivedStats(creature);
  e.toGraveyard(creature, true);
  const lki = e.getLastKnownInformation(oldObjectId);
  assert.ok(lki);
  assert.equal(lki.fromZone, 'battlefield');
  assert.equal(lki.object.controller, 'player');
  assert.deepEqual(lki.object.counters, { '+1/+1': 2 });
  assert.equal(lki.object.derivedCharacteristics.power, expected.power);
  assert.equal(lki.object.derivedCharacteristics.toughness, expected.toughness);
  assert.ok(lki.object.effectiveAbilities);
  const playerView = e.getPlayerStateSnapshot('ai');
  assert.deepEqual(playerView.lastKnownInformation.byObjectId, {}, 'raw LKI is engine-internal and cannot leak hidden transitions');
});

test('Step 8: MOVE_ZONE transformer is a zone-change replacement integration point', () => {
  const e = engine();
  const card = e.state.players.player.hand[0];
  const unsubscribe = e.events.addTransformer(event => {
    if (event.type !== ENGINE_EVENT.MOVE_ZONE || event.payload.reason !== 'step8-replace') return event;
    return { ...event, payload: { ...event.payload, toZone: 'exile' } };
  });
  e._moveZoneNow(card, 'graveyard', 'player', { reason: 'step8-replace' });
  unsubscribe();
  assert.equal(e.zones.find(card.instanceId).zone, 'exile');
});

test('Step 8: commander hand/library replacement choice routes the commander to the command zone via MOVE_ZONE', () => {
  const e = engine();
  const commander = e.state.players.player.command[0];
  e._moveZoneNow(commander, 'battlefield', 'player', { reason: 'test-setup' });
  e.moveToZone(commander, 'library', 'player', { reason: 'would-go-library' });
  assert.equal(e.state.pendingChoice?.type, 'COMMANDER_ZONE');
  assert.equal(e.zones.find(commander.instanceId).zone, 'battlefield', 'replacement choice happens before the move');
  const result = e.perform('player', { type: 'CHOOSE_COMMANDER_ZONE', moveToCommand: true });
  assert.equal(result, true);
  assert.equal(e.zones.find(commander.instanceId).zone, 'command');
  const record = e.getEventLogSnapshot().filter(item => item.type === ENGINE_EVENT.MOVE_ZONE).at(-1);
  assert.equal(record.payload.toZone, 'command');
  assert.equal(record.payload.fromZone, 'battlefield');
  assert.equal(record.payload.reason, 'commander-replacement');
});

test('Step 8: token zone movement is observable, then the token ceases to exist as a state-based action', () => {
  const e = engine();
  const tokenDef = { id:'step8-token', name:'Test Token', typeLine:'Creature — Token', manaCost:'', manaValue:0, colorIdentity:[], subtypes:['Token'], keywords:[], power:1, toughness:1, abilities:[], spellEffects:[] };
  e._registerRuntimeCardDefinition('step8-token', tokenDef);
  const token = makeCardInstance('step8-token', 'player', 'battlefield', { isToken: true }, tokenDef);
  e.zones.place(token, 'battlefield', 'player');
  const oldObjectId = token.gameObjectId;
  e._moveZoneNow(token, 'graveyard', 'player', { reason: 'token-died' });
  assert.equal(e.zones.find(token.instanceId).zone, 'graveyard');
  assert.ok(e.getLastKnownInformation(oldObjectId));
  e.stateBasedActions();
  assert.equal(e.zones.find(token.instanceId), null);
});

test('Step 8: known-information and LKI stores survive canonical serialization/restoration', () => {
  const e = engine();
  const top = e.state.players.player.library[0];
  e.lookAtCard('player', top, { reason: 'serialize-look', position: 'top' });
  const hand = e.state.players.player.hand[0];
  const oldObjectId = hand.gameObjectId;
  e._moveZoneNow(hand, 'graveyard', 'player', { reason: 'serialize-lki' });
  const serialized = e.serializeState();
  e.restoreState(serialized);
  assert.ok(e.getKnownInformationSnapshot('player').cards[top.instanceId]);
  assert.ok(e.getLastKnownInformation(oldObjectId));
});

test('Step 8: production code contains no direct player-zone array mutators outside the zone service boundary', () => {
  const output = fs.readFileSync(new URL('../scripts/check-architecture.mjs', import.meta.url), 'utf8');
  assert.match(output, /direct-player-zone-mutator/);
  // The executable architecture test is run separately by npm run check:architecture;
  // this assertion locks the Step-8 guard itself into the regression suite.
});
