import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/engine/GameEngine.js';
import {
  validateCommanderPair,
  validateCommanderSelection
} from '../src/engine/multiplayer/index.js';
import { db, decks, putBattlefield } from './helpers.js';

function playableDecks(count = 4) {
  return decks.filter(deck => deck.playable !== false).slice(0, count);
}

function multiplayerEngine(count = 4) {
  const selected = playableDecks(count);
  return new GameEngine(selected[0], selected.slice(1), db, { rng: () => 0.42 });
}

function pairDeck() {
  return {
    id: 'step14-background-pair',
    name: 'Step 14 Background Pair',
    format: 'Commander',
    commanders: ['arch-lae-zel-vlaakith-s-champion', 'arch-candlekeep-sage'],
    colorIdentity: ['W', 'U'],
    cards: [
      { id: 'arch-lae-zel-vlaakith-s-champion', quantity: 1 },
      { id: 'arch-candlekeep-sage', quantity: 1 }
    ]
  };
}

function commanderDef(id, name, oracleText, { typeLine = 'Legendary Creature — Human', colors = [] , commanderPairing = undefined } = {}) {
  return {
    id, name, typeLine, oracleText, colorIdentity: colors, colors,
    manaCost: '', manaValue: 0, keywords: [], abilities: [], spellEffects: [], supported: true,
    ...(commanderPairing ? { commanderPairing } : {})
  };
}

test('Step 14: commander designation has a persistent identity through control and zone changes, while copies are not commanders', () => {
  const [a, b] = playableDecks(2);
  const e = new GameEngine(a, b, db, { rng: () => 0.42 });
  let commander = e.state.players.player.command[0];
  const identity = commander.commanderIdentity;
  assert.ok(identity);

  commander = e._moveZoneNow(commander, 'battlefield', 'player');
  assert.equal(commander.commanderIdentity, identity);
  e.changeController(commander.instanceId, 'ai');
  assert.equal(commander.commanderIdentity, identity);
  commander = e._moveZoneNow(commander, 'graveyard', 'player');
  assert.equal(commander.commanderIdentity, identity);
  commander = e._moveZoneNow(commander, 'command', 'player');
  assert.equal(commander.commanderIdentity, identity);

  e.zones.detach(commander.instanceId);
  e.zones.prepareForZone(commander, 'stack', 'player', db[commander.cardId]);
  const original = e.stack.push({ id: 'step14-commander-spell', type: 'spell', controller: 'player', card: commander, targets: [] });
  const [copy] = e.effects._queueSpellCopiesNow(original, 1, 'player');
  assert.equal(copy.card.isCommander, false);
  assert.equal(copy.card.commanderIdentity, undefined);
  assert.equal(original.card.isCommander, true);
  assert.equal(original.card.commanderIdentity, identity);
});

test('Step 14: commander tax is tracked per individual commander and only counts command-zone casts', () => {
  const opponent = playableDecks(1)[0];
  const e = new GameEngine(pairDeck(), opponent, db, { rng: () => 0.42 });
  const [laezel, background] = e.state.players.player.command;

  assert.equal(e.costs.determineSpellCost('player', laezel, { zone: 'command' }).stages.commanderTax, 0);
  assert.equal(e.costs.determineSpellCost('player', background, { zone: 'command' }).stages.commanderTax, 0);

  e.commanders.recordCast('player', laezel, { fromZone: 'command' });
  assert.equal(e.costs.determineSpellCost('player', laezel, { zone: 'command' }).stages.commanderTax, 2);
  assert.equal(e.costs.determineSpellCost('player', background, { zone: 'command' }).stages.commanderTax, 0);

  e.commanders.recordCast('player', background, { fromZone: 'command' });
  e.commanders.recordCast('player', laezel, { fromZone: 'graveyard' });
  assert.equal(e.costs.determineSpellCost('player', laezel, { zone: 'command' }).stages.commanderTax, 2, 'casting from another zone does not increase tax');
  assert.equal(e.costs.determineSpellCost('player', background, { zone: 'command' }).stages.commanderTax, 2);

  e.commanders.recordCast('player', laezel, { fromZone: 'command' });
  const ledger = e.getCommanderTaxLedgerSnapshot('player');
  assert.equal(ledger[laezel.commanderIdentity].castsFromCommandZone, 2);
  assert.equal(ledger[laezel.commanderIdentity].tax, 4);
  assert.equal(ledger[background.commanderIdentity].castsFromCommandZone, 1);
  assert.equal(ledger[background.commanderIdentity].tax, 2);
});

test('Step 14: commander movement uses replacement timing for hand/library and post-move choice for graveyard/exile', () => {
  const [a, b] = playableDecks(2);
  const e = new GameEngine(a, b, db, { rng: () => 0.42 });
  let commander = e._moveZoneNow(e.state.players.player.command[0], 'battlefield', 'player');
  const identity = commander.commanderIdentity;

  e.moveToZone(commander, 'hand', 'player');
  assert.equal(commander.zone, 'battlefield', 'hand/library replacement choice happens before the move');
  assert.equal(e.state.pendingChoice?.type, 'COMMANDER_ZONE');
  assert.equal(e.state.pendingChoice?.replacement, true);
  e._applyCommanderZoneChoice('player', false);
  commander = e.state.players.player.hand.find(card => card.isCommander);
  assert.equal(commander.commanderIdentity, identity);

  commander = e._moveZoneNow(commander, 'battlefield', 'player');
  e.toGraveyard(commander, true);
  commander = e.state.players.player.graveyard.find(card => card.isCommander);
  assert.ok(commander, 'graveyard/exile choice is not a replacement; the commander moves first');
  assert.equal(commander.commanderIdentity, identity);
  e.stateBasedActions();
  assert.equal(e.state.pendingChoice?.type, 'COMMANDER_ZONE');
  assert.equal(e.state.pendingChoice?.replacement, false);
  e._applyCommanderZoneChoice('player', true);
  assert.equal(e.state.players.player.command[0].commanderIdentity, identity);
});

test('Step 14: commander damage ledger follows the designated commander across control changes', () => {
  const e = multiplayerEngine(3);
  let commander = e._moveZoneNow(e.state.players.player.command[0], 'battlefield', 'player');
  const identity = commander.commanderIdentity;

  e.changeController(commander.instanceId, 'ai');
  commander = e.findPermanent(commander.instanceId);
  e.dealDamageToPlayer('ai2', 7, commander, { combat: true });
  e.changeController(commander.instanceId, 'ai2');
  commander = e.findPermanent(commander.instanceId);
  e.dealDamageToPlayer('ai', 14, commander, { combat: true });

  const matrix = e.getCommanderDamageMatrixSnapshot();
  assert.equal(matrix.ai2[identity], 7);
  assert.equal(matrix.ai[identity], 14);
  assert.equal(matrix.player[identity] || 0, 0);
});

test('Step 14: paired-commander validator supports all required pair families and rejects unrelated pairs', () => {
  const partnerA = commanderDef('partner-a', 'Partner A', 'Partner (You can have two commanders if both have partner.)');
  const partnerB = commanderDef('partner-b', 'Partner B', 'Partner (You can have two commanders if both have partner.)');
  assert.equal(validateCommanderPair(partnerA, partnerB).mechanic, 'Partner');

  const withA = commanderDef('with-a', 'Alpha', 'Partner with Beta');
  const withB = commanderDef('with-b', 'Beta', 'Partner with Alpha');
  assert.equal(validateCommanderPair(withA, withB).mechanic, 'Partner with');

  const friendsA = commanderDef('friends-a', 'Friends A', 'Friends forever');
  const friendsB = commanderDef('friends-b', 'Friends B', 'Friends forever');
  assert.equal(validateCommanderPair(friendsA, friendsB).mechanic, 'Friends Forever');

  const backgroundPair = validateCommanderPair(db['arch-lae-zel-vlaakith-s-champion'], db['arch-candlekeep-sage']);
  assert.equal(backgroundPair.mechanic, 'Choose a Background');

  const companion = commanderDef('companion', 'Companion', "Doctor's companion");
  const doctor = commanderDef('doctor', 'The Test Doctor', '', { typeLine: 'Legendary Creature — Time Lord Doctor' });
  assert.equal(validateCommanderPair(companion, doctor).mechanic, "Doctor's companion");

  const futureA = commanderDef('future-a', 'Future A', '', { commanderPairing: { tags: ['future-pair-42'] } });
  const futureB = commanderDef('future-b', 'Future B', '', { commanderPairing: { tags: ['future-pair-42'] } });
  assert.equal(validateCommanderPair(futureA, futureB).mechanic, 'tag:future-pair-42');

  assert.equal(validateCommanderPair(partnerA, friendsA).ok, false);
});

test('Step 14: deck/game-state validation accepts a legal paired command zone and uses the union color identity', () => {
  const validation = validateCommanderSelection(pairDeck(), db);
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.colorIdentity, ['W', 'U']);
  assert.equal(validation.pairing.mechanic, 'Choose a Background');

  const e = new GameEngine(pairDeck(), playableDecks(1)[0], db, { rng: () => 0.42 });
  assert.equal(e.state.players.player.command.length, 2);
  assert.deepEqual(e.state.players.player.colorIdentity, ['W', 'U']);
  assert.equal(new Set(e.state.players.player.command.map(card => card.commanderIdentity)).size, 2);

  const invalid = { ...pairDeck(), commanders: ['arch-lae-zel-vlaakith-s-champion', 'arch-kediss-emberclaw-familiar'], colorIdentity: ['W', 'R'] };
  assert.equal(validateCommanderSelection(invalid, db).ok, false);
  assert.throws(() => new GameEngine(invalid, playableDecks(1)[0], db), /invalid commander designation/i);
});

test('Step 14: player elimination is an atomic multiplayer cleanup transaction', () => {
  const e = multiplayerEngine(4);
  const stolen = putBattlefield(e, 'player', 'lcc-benthic-biomancer');
  e.changeController(stolen.instanceId, 'ai');

  const residual = putBattlefield(e, 'player', 'lcc-cold-eyed-selkie');
  e.zones.transferBattlefieldControl(residual.instanceId, 'ai');
  residual.controller = 'ai';
  residual.controlHistory = [];

  const leavingOwnerCard = putBattlefield(e, 'ai', 'lcc-deeproot-elite');
  e.changeController(leavingOwnerCard.instanceId, 'player');

  e.stack.push({ id: 'eliminated-ability', type: 'ability', controller: 'ai', source: leavingOwnerCard, effect: { type: 'draw', amount: 1 } });
  e.state.pendingTriggers.push({ id: 'lost-trigger', controller: 'ai' }, { id: 'live-trigger', controller: 'ai2' });
  e.state.pendingChoice = { type: 'TEST', playerId: 'ai' };
  e.state.extraTurnQueue = ['ai', 'ai2'];
  e.state.extraTurns.ai = 1;
  e.state.combat.defendingPlayers = ['ai', 'ai2'];
  e.state.combat.blockerQueue = ['ai', 'ai2'];
  e.state.combat.currentDefender = 'ai';

  e.elimination.eliminate('ai', { reason: 'step14-test' });

  assert.equal(e.state.players.ai.lost, true);
  assert.equal(e.findPermanent(leavingOwnerCard.instanceId), null, 'objects owned by the eliminated player leave the game');
  assert.equal(e.findPermanent(stolen.instanceId)?.controller, 'player', 'control-changing effect ends and prior surviving controller is restored');
  assert.ok(e.state.players.player.exile.some(card => card.instanceId === residual.instanceId), 'a surviving-owned object still controlled by the departed player is exiled');
  assert.equal(e.state.stack.some(item => item.id === 'eliminated-ability'), false);
  assert.deepEqual(e.state.pendingTriggers.map(trigger => trigger.id), ['live-trigger']);
  assert.equal(e.state.pendingChoice, null);
  assert.deepEqual(e.state.extraTurnQueue, ['ai2']);
  assert.deepEqual(e.state.combat.defendingPlayers, ['ai2']);
  assert.equal(e.state.combat.currentDefender, 'ai2');
  assert.equal(e.nextPlayer('player'), 'ai2');
  assert.ok(e.state.history.some(event => event.type === 'PLAYER_ELIMINATION_TRANSACTION' && event.eliminatedPlayers.includes('ai')));
});

test('Step 14: multiplayer relations cover each opponent, each player, another player, active player, defending player, and teammates', () => {
  const e = multiplayerEngine(4);
  e.state.activePlayer = 'ai2';
  e.state.combat.defendingPlayers = ['ai', 'ai3'];
  e.state.combat.currentDefender = 'ai3';

  assert.deepEqual([...e.getMultiplayerRelationSnapshot('each opponent', 'player')].sort(), ['ai', 'ai2', 'ai3']);
  assert.deepEqual([...e.getMultiplayerRelationSnapshot('each player', 'player')].sort(), ['ai', 'ai2', 'ai3', 'player']);
  assert.deepEqual([...e.getMultiplayerRelationSnapshot('another player', 'ai')].sort(), ['ai2', 'ai3', 'player']);
  assert.deepEqual(e.getMultiplayerRelationSnapshot('active player', 'player'), ['ai2']);
  assert.deepEqual(e.getMultiplayerRelationSnapshot('defending player', 'player'), ['ai3']);

  e.state.players.player.teamId = 'team-a';
  e.state.players.ai2.teamId = 'team-a';
  assert.deepEqual(e.getMultiplayerRelationSnapshot('teammate', 'player'), ['ai2']);
  assert.deepEqual([...e.getMultiplayerRelationSnapshot('each opponent', 'player')].sort(), ['ai', 'ai3']);
});

test('Step 14: targeting uses the multiplayer relation library and excludes eliminated opponents', () => {
  const e = multiplayerEngine(4);
  const opponents = { targets: { kind: 'player', controller: 'each opponent' } };
  assert.deepEqual(e.targeting.getCandidates('player', opponents, []).map(candidate => candidate.id).sort(), ['ai', 'ai2', 'ai3']);

  e.elimination.eliminate('ai2', { reason: 'step14-target-test' });
  assert.deepEqual(e.targeting.getCandidates('player', opponents, []).map(candidate => candidate.id).sort(), ['ai', 'ai3']);

  e.state.activePlayer = 'ai3';
  const active = { targets: { kind: 'player', controller: 'active player' } };
  assert.deepEqual(e.targeting.getCandidates('player', active, []).map(candidate => candidate.id), ['ai3']);
});

test('Step 14: serialization preserves persistent commander identity, per-commander tax, and commander damage', () => {
  const e = new GameEngine(pairDeck(), playableDecks(1)[0], db, { rng: () => 0.42 });
  const [first, second] = e.state.players.player.command;
  const firstIdentity = first.commanderIdentity;
  const secondIdentity = second.commanderIdentity;

  e.commanders.recordCast('player', first, { fromZone: 'command' });
  e.commanders.recordCast('player', first, { fromZone: 'command' });
  e.commanders.recordCast('player', second, { fromZone: 'command' });
  e.commanders.recordCombatDamage('ai', first, 11);
  e.commanders.recordCombatDamage('ai', second, 5);

  const serialized = e.serializeState();
  e.restoreState(serialized);

  const identities = e.state.players.player.command.map(card => card.commanderIdentity);
  assert.deepEqual(identities, [firstIdentity, secondIdentity]);
  const ledger = e.getCommanderTaxLedgerSnapshot('player');
  assert.equal(ledger[firstIdentity].tax, 4);
  assert.equal(ledger[secondIdentity].tax, 2);
  const matrix = e.getCommanderDamageMatrixSnapshot();
  assert.equal(matrix.ai[firstIdentity], 11);
  assert.equal(matrix.ai[secondIdentity], 5);
});
