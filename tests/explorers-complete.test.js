import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeCardInstance } from '../src/engine/GameState.js';
import { AIController } from '../src/ai/AIController.js';
import { db, decks, engine, putBattlefield, setPhase } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function putZone(e, pid, cardId, zone, extra = {}) {
  const card = Object.assign(makeCardInstance(cardId, pid, zone), extra);
  e.state.players[pid][zone].push(card);
  return card;
}

function giveMana(e, pid, mana = {}) {
  Object.assign(e.state.players[pid].manaPool, { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, ...mana });
}

function passToResolve(e) {
  const first = e.state.priorityPlayer;
  e.perform(first, { type: 'PASS_PRIORITY' });
  e.perform(e.state.priorityPlayer, { type: 'PASS_PRIORITY' });
}

function bridgeAbility(e) {
  return e.db['lcc-mosswort-bridge'].abilities.find(ability => ability.type === 'activated');
}

function prepareBridge(e, hiddenCardId, { activePlayer = 'player', phase = 'BEGIN_COMBAT' } = {}) {
  setPhase(e, phase, { activePlayer, priorityPlayer: 'player' });
  const bridge = putBattlefield(e, 'player', 'lcc-mosswort-bridge');
  // A synthetic 10/10 is enough to satisfy the Bridge condition without creating unrelated triggers.
  e.db['test-ten-power'] = {
    id: 'test-ten-power', name: 'Test Ten Power', typeLine: 'Creature', manaCost: '', manaValue: 0,
    power: 10, toughness: 10, subtypes: [], keywords: [], abilities: [], spellEffects: [], colorIdentity: []
  };
  putBattlefield(e, 'player', 'test-ten-power');
  const hidden = putZone(e, 'player', hiddenCardId, 'exile', { faceDown: true, exiledBy: bridge.instanceId });
  giveMana(e, 'player', { G: 1 });
  e.perform('player', { type: 'ACTIVATE_ABILITY', permanentId: bridge.instanceId, ability: bridgeAbility(e), targets: [] });
  return { bridge, hidden };
}

test('Explorers complete: Mosswort Bridge offers the hidden card during ability resolution instead of moving it to hand', () => {
  const e = engine();
  const { hidden } = prepareBridge(e, 'sol-ring');
  passToResolve(e);

  assert.equal(e.state.pendingChoice?.type, 'HIDEAWAY_PLAY');
  assert.equal(e.state.pendingChoice?.cardInstanceId, hidden.instanceId);
  assert.ok(e.state.players.player.exile.some(card => card.instanceId === hidden.instanceId));
  assert.ok(!e.state.players.player.hand.some(card => card.instanceId === hidden.instanceId));
  assert.equal(hidden.faceDown, true);

  const actions = e.getLegalActions('player');
  const cast = actions.find(action => action.type === 'CAST_SPELL' && action.cardInstanceId === hidden.instanceId);
  assert.ok(cast, 'the hidden nonland card should be castable directly from exile');
  assert.equal(cast.castOption, 'hideaway');
  assert.ok(actions.some(action => action.type === 'DECLINE_HIDEAWAY_PLAY'));
});

test('Explorers complete: Mosswort Bridge casts a hidden nonland without paying its mana cost and never routes it through hand', () => {
  const e = engine();
  const { hidden } = prepareBridge(e, 'sol-ring');
  passToResolve(e);
  assert.deepEqual(e.state.players.player.manaPool, { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });

  const cast = e.getLegalActions('player').find(action => action.type === 'CAST_SPELL' && action.cardInstanceId === hidden.instanceId);
  assert.ok(cast);
  e.perform('player', cast);
  assert.equal(e.state.pendingChoice, null);
  assert.ok(e.state.stack.some(item => item.card?.instanceId === hidden.instanceId));
  assert.ok(!e.state.players.player.exile.some(card => card.instanceId === hidden.instanceId));
  assert.ok(!e.state.players.player.hand.some(card => card.instanceId === hidden.instanceId));

  passToResolve(e);
  assert.ok(e.findPermanent(hidden.instanceId), 'Sol Ring should resolve to the battlefield');
});

test('Explorers complete: a Mosswort Bridge ability still offers its hidden card if Bridge leaves before the ability resolves', () => {
  const e = engine();
  const { bridge, hidden } = prepareBridge(e, 'sol-ring');
  e.destroy(bridge);
  assert.equal(e.findPermanent(bridge.instanceId), null);
  passToResolve(e);
  assert.equal(e.state.pendingChoice?.type, 'HIDEAWAY_PLAY');
  assert.equal(e.state.pendingChoice?.cardInstanceId, hidden.instanceId);
});

test('Explorers complete: Mosswort Bridge can play a hidden land during resolution on your turn outside a main phase', () => {
  const e = engine();
  const { hidden } = prepareBridge(e, 'forest', { activePlayer: 'player', phase: 'BEGIN_COMBAT' });
  assert.equal(e.state.players.player.landPlaysRemaining, 1);
  passToResolve(e);

  const action = e.getLegalActions('player').find(candidate => candidate.type === 'PLAY_HIDEAWAY_LAND');
  assert.ok(action, 'hidden land should be playable on your turn with a land play remaining');
  e.perform('player', action);

  assert.equal(e.findPermanent(hidden.instanceId)?.cardId, 'forest');
  assert.equal(e.state.players.player.landPlaysRemaining, 0);
  assert.ok(!e.state.players.player.hand.some(card => card.instanceId === hidden.instanceId));
  assert.ok(!e.state.players.player.exile.some(card => card.instanceId === hidden.instanceId));
});

test('Explorers complete: Mosswort Bridge does not let a hidden land bypass turn or land-play limits', () => {
  {
    const e = engine();
    prepareBridge(e, 'forest', { activePlayer: 'ai', phase: 'BEGIN_COMBAT' });
    passToResolve(e);
    const actions = e.getLegalActions('player');
    assert.ok(!actions.some(action => action.type === 'PLAY_HIDEAWAY_LAND'));
    assert.ok(actions.some(action => action.type === 'DECLINE_HIDEAWAY_PLAY'));
  }
  {
    const e = engine();
    prepareBridge(e, 'forest', { activePlayer: 'player', phase: 'END_STEP' });
    e.state.players.player.landPlaysRemaining = 0;
    passToResolve(e);
    const actions = e.getLegalActions('player');
    assert.ok(!actions.some(action => action.type === 'PLAY_HIDEAWAY_LAND'));
    assert.ok(actions.some(action => action.type === 'DECLINE_HIDEAWAY_PLAY'));
  }
});

test('Explorers complete: Mosswort free-casting an X spell fixes X at zero while optional kicker remains separately payable', () => {
  const e = engine();
  setPhase(e, 'PRECOMBAT_MAIN');
  const curse = putZone(e, 'player', 'lcc-curse-of-the-swine', 'exile', { faceDown: true, exiledBy: 'bridge-x' });
  e.state.pendingChoice = { type: 'HIDEAWAY_PLAY', playerId: 'player', sourceId: 'bridge-x', cardInstanceId: curse.instanceId, resume: 'PRIORITY' };
  e.state.priorityPlayer = 'player';
  const curseActions = e.getLegalActions('player').filter(action => action.type === 'CAST_SPELL' && action.cardInstanceId === curse.instanceId);
  assert.ok(curseActions.some(action => action.mode === 'x-0'));
  assert.ok(curseActions.every(action => action.mode === 'x-0'), 'X in the mana cost must be zero when casting without paying that cost');

  e.state.pendingChoice = null;
  e.state.players.player.exile = [];
  const skydiver = putZone(e, 'player', 'lcc-thieving-skydiver', 'exile', { faceDown: true, exiledBy: 'bridge-kicker' });
  e.state.pendingChoice = { type: 'HIDEAWAY_PLAY', playerId: 'player', sourceId: 'bridge-kicker', cardInstanceId: skydiver.instanceId, resume: 'PRIORITY' };
  e.state.priorityPlayer = 'player';
  giveMana(e, 'player', { C: 3 });
  const skyActions = e.getLegalActions('player').filter(action => action.cardInstanceId === skydiver.instanceId);
  assert.ok(skyActions.some(action => action.mode === 'normal'), 'casting without kicker remains available');
  assert.ok(!skyActions.some(action => action.mode === 'kicker-0'), 'Thieving Skydiver explicitly forbids kicker X=0');
  assert.ok(skyActions.some(action => action.mode === 'kicker-3'), 'kicker is an additional cost and remains payable during a free cast');
});

test('Explorers complete: Quandrix Command may choose the same creature for two independent target clauses', () => {
  const e = engine();
  setPhase(e, 'PRECOMBAT_MAIN');
  const command = putZone(e, 'player', 'lcc-quandrix-command', 'hand');
  const creature = putBattlefield(e, 'player', 'merfolk-mistbinder');
  giveMana(e, 'player', { U: 1, G: 1, C: 1 });

  const duplicateAction = e.getLegalActions('player').find(action =>
    action.type === 'CAST_SPELL' && action.cardInstanceId === command.instanceId && action.mode === 'pair-2'
    && action.targets?.[0] === creature.instanceId && action.targets?.[1] === creature.instanceId
  );
  assert.ok(duplicateAction, 'the same creature is a legal target for the two separately worded modes');
  assert.doesNotThrow(() => e.perform('player', duplicateAction));
  assert.deepEqual(e.state.stack.find(item => item.card?.instanceId === command.instanceId)?.targets, [creature.instanceId, creature.instanceId]);
});

test('Explorers complete: repeated slots belonging to one target clause still require distinct cards', () => {
  const e = engine();
  const source = {
    targets: [
      { kind: 'player' },
      { kind: 'card', zone: 'graveyard', ownerFromTargetIndex: 0, optional: true }
    ],
    minTargets: 1,
    maxTargets: 4
  };
  const grave = putZone(e, 'player', 'sol-ring', 'graveyard');
  assert.throws(
    () => e.targeting.validateTargets('player', source, ['player', grave.instanceId, grave.instanceId]),
    /single target clause/i
  );
  assert.doesNotThrow(() => e.targeting.validateTargets('player', source, ['player', grave.instanceId]));
});



test('Explorers complete: foretell cannot be cast on the turn it is foretold and becomes available on a later turn', () => {
  const e = engine();
  setPhase(e, 'PRECOMBAT_MAIN');
  const ravenform = putZone(e, 'player', 'lcc-ravenform', 'hand');
  const target = putBattlefield(e, 'ai', 'merfolk-mistbinder');
  giveMana(e, 'player', { C: 2 });

  const foretell = e.getLegalActions('player').find(action => action.type === 'FORETELL_CARD' && action.cardInstanceId === ravenform.instanceId);
  assert.ok(foretell, 'Ravenform should be foretellable for {2} from hand');
  e.perform('player', foretell);
  assert.equal(ravenform.zone, 'exile');
  assert.equal(ravenform.foretold, true);
  assert.equal(ravenform.faceDown, true);
  assert.equal(ravenform.foretoldTurn, e.state.turn);

  giveMana(e, 'player', { U: 1 });
  assert.ok(!e.getLegalActions('player').some(action => action.type === 'CAST_SPELL' && action.cardInstanceId === ravenform.instanceId), 'a foretold card is not castable on the same turn');

  e.state.turn += 1;
  setPhase(e, 'PRECOMBAT_MAIN', { activePlayer: 'player', priorityPlayer: 'player' });
  giveMana(e, 'player', { U: 1 });
  const cast = e.getLegalActions('player').find(action => action.type === 'CAST_SPELL'
    && action.cardInstanceId === ravenform.instanceId
    && action.castOption === 'foretold'
    && action.targets?.includes(target.instanceId));
  assert.ok(cast, 'Ravenform should be castable for its foretell cost on a later turn');
  e.perform('player', cast);
  assert.ok(e.state.stack.some(item => item.card?.instanceId === ravenform.instanceId));
  assert.equal('faceDown' in ravenform, false);
  assert.equal(ravenform.foretold, false);
  assert.equal('foretoldTurn' in ravenform, false);
});

test('Explorers complete: Ripples of Potential separately lets its controller choose which proliferated permanents phase out', () => {
  const e = engine();
  setPhase(e, 'PRECOMBAT_MAIN');
  const ripples = putZone(e, 'player', 'lcc-ripples-of-potential', 'hand');
  const keep = putBattlefield(e, 'player', 'merfolk-mistbinder', { counters: { '+1/+1': 1 } });
  const phase = putBattlefield(e, 'player', 'lcc-benthic-biomancer', { counters: { '+1/+1': 1 } });
  const enemy = putBattlefield(e, 'ai', 'merfolk-mistbinder', { counters: { '+1/+1': 1 } });
  giveMana(e, 'player', { U: 1, C: 1 });

  const cast = e.getLegalActions('player').find(action => action.type === 'CAST_SPELL' && action.cardInstanceId === ripples.instanceId);
  assert.ok(cast);
  e.perform('player', cast);
  passToResolve(e);
  assert.equal(e.state.pendingChoice?.type, 'PROLIFERATE');

  e.perform('player', { type: 'CHOOSE_PROLIFERATE', targetIds: [keep.instanceId, phase.instanceId, enemy.instanceId] });
  assert.equal(keep.counters['+1/+1'], 2);
  assert.equal(phase.counters['+1/+1'], 2);
  assert.equal(enemy.counters['+1/+1'], 2);
  assert.equal(e.state.pendingChoice?.type, 'PHASE_OUT_PROLIFERATED');
  assert.deepEqual(new Set(e.state.pendingChoice.eligibleIds), new Set([keep.instanceId, phase.instanceId]));

  e.perform('player', { type: 'CHOOSE_PHASE_OUT_PROLIFERATED', permanentIds: [phase.instanceId] });
  assert.equal(phase.phasedOut, true);
  assert.notEqual(keep.phasedOut, true);
  assert.notEqual(enemy.phasedOut, true);
  assert.equal(e.state.pendingChoice, null);
  assert.ok(e.state.players.player.graveyard.some(card => card.instanceId === ripples.instanceId), 'Ripples should finish resolving after the phase-out choice');
});

test('Explorers complete: the UI exposes all newly required hideaway and duplicate-copy target decisions', () => {
  const app = fs.readFileSync(path.join(ROOT, 'src/App.jsx'), 'utf8');
  assert.match(app, /HIDEAWAY_PLAY/);
  assert.match(app, /Cast Hidden Card/);
  assert.match(app, /Play Hidden Land/);
  assert.match(app, /Do Not Play It/);
  assert.match(app, /appendCopyTarget/);
  assert.match(app, /Undo Last/);
  assert.match(app, /PHASE_OUT_PROLIFERATED/);
  assert.match(app, /Confirm Phase-Out Selection/);
  assert.match(app, /Ripples of Potential/);
});

test('Explorers complete: every official precon card is implemented by data or a reusable engine primitive', () => {
  const deck = decks.find(candidate => candidate.id === 'explorers');
  assert.ok(deck?.playable);
  assert.equal(deck.cards.reduce((sum, entry) => sum + entry.quantity, 0), 100);
  for (const entry of deck.cards) {
    const card = db[entry.id];
    assert.ok(card, `missing ${entry.id}`);
    assert.notEqual(card.supported, false, `${card.name} is marked unsupported`);
    assert.ok(card.typeLine, `${card.name} has no type line`);
    assert.ok(Array.isArray(card.colorIdentity), `${card.name} has no color identity`);
    if (/Creature/i.test(card.typeLine)) {
      assert.notEqual(card.power, null, `${card.name} has no power`);
      assert.notEqual(card.toughness, null, `${card.name} has no toughness`);
    }
    // Any rules-bearing card must have at least one engine-facing representation.
    if (card.oracleText && !/Basic Land/i.test(card.typeLine)) {
      const structuralKeys = Object.keys(card).filter(key => ![
        'id','name','typeLine','manaCost','manaValue','power','toughness','subtypes','keywords','abilities','spellEffects',
        'producedMana','colorIdentity','supported','oracleText','image'
      ].includes(key));
      const represented = (card.abilities?.length || 0) + (card.spellEffects?.length || 0) + (card.keywords?.length || 0) + structuralKeys.length;
      assert.ok(represented > 0, `${card.name} has Oracle text but no engine representation`);
    }
  }
});

test('Explorers complete: AI has a legal response for every surfaced choice in a short mirror-match simulation', () => {
  const e = engine('explorers', 'explorers');
  let steps = 0;
  while (!e.state.winner && steps < 400) {
    const pid = e.state.pendingChoice?.playerId || e.state.priorityPlayer || e.state.pregame?.currentPlayer;
    if (!pid) break;
    const legal = e.getLegalActions(pid);
    assert.ok(legal.length > 0, `no legal actions for ${pid} at step ${steps}, choice=${e.state.pendingChoice?.type || 'none'}, phase=${e.state.phase}`);
    let action;
    if (e.state.turnActionPending === 'DECLARE_ATTACKERS') action = { type: 'DECLARE_ATTACKERS', attackers: [] };
    else if (e.state.turnActionPending === 'DECLARE_BLOCKERS') action = { type: 'DECLARE_BLOCKERS', blockers: {} };
    else action = new AIController(e, pid).choose() || legal[0];
    assert.ok(action, `AI returned no action at step ${steps}`);
    assert.ok(e.isActionLegal(pid, action), `AI chose illegal ${action.type} at step ${steps}`);
    e.perform(pid, action);
    steps++;
  }
  assert.ok(steps >= 100, `simulation stopped too early after ${steps} actions`);
});

test('Explorers complete: resolution-time may abilities do not ask whether to put the trigger on the stack', () => {
  // Emperor Mihail II: the trigger always stacks; the {1} payment is chosen on resolution.
  {
    const e = engine();
    setPhase(e, 'PRECOMBAT_MAIN');
    putBattlefield(e, 'player', 'lcc-emperor-mihail-ii');
    const realmwalker = putZone(e, 'player', 'lcc-realmwalker', 'hand');
    giveMana(e, 'player', { G: 1, C: 3 });
    const cast = e.getLegalActions('player').find(action => action.type === 'CAST_SPELL' && action.cardInstanceId === realmwalker.instanceId);
    assert.ok(cast, 'Changeling Realmwalker should count as a Merfolk spell for Emperor Mihail II');
    e.perform('player', cast);
    assert.notEqual(e.state.pendingChoice?.type, 'OPTIONAL_TRIGGER');
    assert.equal(e.state.stack.at(-1)?.type, 'trigger');
    passToResolve(e);
    assert.equal(e.state.pendingChoice?.type, 'OPTIONAL_MANA_PAYMENT');
    assert.equal(e.state.pendingChoice?.sourceName, 'Emperor Mihail II');
    const before = e.state.players.player.battlefield.filter(card => card.cardId === 'token:Merfolk').length;
    e.perform('player', { type: 'CHOOSE_OPTIONAL_MANA_PAYMENT', pay: true });
    const after = e.state.players.player.battlefield.filter(card => card.cardId === 'token:Merfolk').length;
    assert.equal(after, before + 1);
  }

  // Surgespanner: target is selected as the trigger is stacked; payment is chosen only on resolution.
  {
    const e = engine();
    setPhase(e, 'PRECOMBAT_MAIN');
    const surgespanner = putBattlefield(e, 'player', 'lcc-surgespanner');
    const enemy = putBattlefield(e, 'ai', 'merfolk-mistbinder');
    giveMana(e, 'player', { U: 1, C: 1 });
    e.tapPermanent(surgespanner);
    assert.notEqual(e.state.pendingChoice?.type, 'OPTIONAL_TRIGGER');
    assert.equal(e.state.pendingChoice?.type, 'TRIGGER_TARGET');
    e.perform('player', { type: 'CHOOSE_TRIGGER_TARGET', targetIds: [enemy.instanceId] });
    passToResolve(e);
    assert.equal(e.state.pendingChoice?.type, 'OPTIONAL_MANA_PAYMENT');
    e.perform('player', { type: 'CHOOSE_OPTIONAL_MANA_PAYMENT', pay: true });
    assert.equal(e.findPermanent(enemy.instanceId), null);
    assert.ok(e.state.players.ai.hand.some(card => card.instanceId === enemy.instanceId));
  }
});

test('Explorers complete: Merrow Reejerey chooses tap, untap, or no change when its trigger resolves', () => {
  const e = engine();
  setPhase(e, 'PRECOMBAT_MAIN');
  putBattlefield(e, 'player', 'lcc-merrow-reejerey');
  const target = putBattlefield(e, 'ai', 'merfolk-mistbinder');
  const spell = putZone(e, 'player', 'lcc-realmwalker', 'hand');
  giveMana(e, 'player', { G: 1, C: 2 });
  const cast = e.getLegalActions('player').find(action => action.type === 'CAST_SPELL' && action.cardInstanceId === spell.instanceId);
  assert.ok(cast);
  e.perform('player', cast);
  assert.notEqual(e.state.pendingChoice?.type, 'OPTIONAL_TRIGGER');
  assert.equal(e.state.pendingChoice?.type, 'TRIGGER_TARGET');
  e.perform('player', { type: 'CHOOSE_TRIGGER_TARGET', targetIds: [target.instanceId] });
  passToResolve(e);
  assert.equal(e.state.pendingChoice?.type, 'TAP_OR_UNTAP');
  assert.equal(e.state.pendingChoice?.targetId, target.instanceId);
  e.perform('player', { type: 'CHOOSE_TAP_OR_UNTAP', choice: 'tap' });
  assert.equal(target.tapped, true);
});

test('Explorers complete: Nicanzil and Graft make their may choices on resolution', () => {
  // Nicanzil: the trigger stacks unconditionally and the land-card choice itself is optional.
  {
    const e = engine();
    setPhase(e, 'PRECOMBAT_MAIN');
    putBattlefield(e, 'player', 'lcc-nicanzil-current-conductor');
    const explorer = putBattlefield(e, 'player', 'merfolk-mistbinder');
    const land = putZone(e, 'player', 'forest', 'hand');
    e.emit('EXPLORED', { controller: 'player', target: explorer, object: explorer, revealedLand: true, revealedCard: { cardId: 'island' } });
    assert.notEqual(e.state.pendingChoice?.type, 'OPTIONAL_TRIGGER');
    assert.equal(e.state.stack.at(-1)?.type, 'trigger');
    passToResolve(e);
    assert.equal(e.state.pendingChoice?.type, 'EFFECT_CARD_CHOICE');
    assert.ok(e.state.pendingChoice.candidateIds.includes(land.instanceId));
    e.perform('player', { type: 'CHOOSE_EFFECT_CARDS', cardInstanceIds: [land.instanceId] });
    assert.equal(e.findPermanent(land.instanceId)?.tapped, true);
  }

  // Graft: the ETB trigger always stacks; moving the counter is optional on resolution.
  {
    const e = engine();
    setPhase(e, 'PRECOMBAT_MAIN');
    const reborn = putBattlefield(e, 'player', 'lcc-llanowar-reborn', { counters: { '+1/+1': 1 } });
    const creature = putBattlefield(e, 'player', 'merfolk-mistbinder');
    e.emit('ENTER_BATTLEFIELD', { controller: 'player', target: creature, object: creature });
    assert.notEqual(e.state.pendingChoice?.type, 'OPTIONAL_TRIGGER');
    assert.equal(e.state.stack.at(-1)?.type, 'trigger');
    passToResolve(e);
    assert.equal(e.state.pendingChoice?.type, 'OPTIONAL_EFFECT');
    e.perform('player', { type: 'CHOOSE_OPTIONAL_EFFECT', accept: true });
    assert.equal(Number(reborn.counters['+1/+1'] || 0), 0);
    assert.equal(Number(creature.counters['+1/+1'] || 0), 1);
  }
});

test('Explorers complete: Changeling is recognized by tribal costs, triggers, and battlefield subtype checks', () => {
  const e = engine();
  setPhase(e, 'PRECOMBAT_MAIN');
  const realmwalker = putZone(e, 'player', 'lcc-realmwalker', 'hand');
  const banneret = putBattlefield(e, 'player', 'lcc-stonybrook-banneret');
  assert.ok(banneret);

  // Realmwalker costs {2}{G}; Stonybrook Banneret must reduce it because Changeling makes it a Merfolk.
  giveMana(e, 'player', { G: 1, C: 1 });
  const cast = e.getLegalActions('player').find(action => action.type === 'CAST_SPELL' && action.cardInstanceId === realmwalker.instanceId);
  assert.ok(cast, 'Realmwalker should receive Merfolk cost reduction while in hand');

  const permanent = putBattlefield(e, 'player', 'lcc-realmwalker', { chosenType: 'Wizard' });
  assert.equal(e.static.hasSubtype(permanent, 'Merfolk'), true);
  assert.equal(e.static.hasSubtype(permanent, 'Wizard'), true);
});

test('Explorers complete: Hakbal puts lands onto the battlefield through their full as-enters and ETB processing', () => {
  // Secluded Courtyard must still ask for a creature type and must not consume a land play.
  {
    const e = engine();
    setPhase(e, 'DECLARE_ATTACKERS');
    const courtyard = putZone(e, 'player', 'lcc-secluded-courtyard', 'hand');
    const landPlays = e.state.players.player.landPlaysRemaining;
    e.state.pendingChoice = { type: 'HAKBAL_ATTACK', playerId: 'player', landInstanceIds: [courtyard.instanceId], resume: 'PRIORITY' };
    e.state.priorityPlayer = 'player';
    e.perform('player', { type: 'CHOOSE_HAKBAL_ATTACK', landInstanceId: courtyard.instanceId });
    assert.equal(e.state.pendingChoice?.type, 'CREATURE_TYPE');
    assert.ok(e.state.players.player.hand.some(card => card.instanceId === courtyard.instanceId), 'as-enters choice happens before the land moves');
    e.perform('player', { type: 'CHOOSE_CREATURE_TYPE', creatureType: 'Merfolk' });
    const entered = e.findPermanent(courtyard.instanceId);
    assert.ok(entered);
    assert.equal(entered.chosenType, 'Merfolk');
    assert.equal(e.state.players.player.landPlaysRemaining, landPlays, 'Hakbal puts a land rather than playing it');
  }

  // Simic Growth Chamber must enter tapped and run its ETB return-a-land effect.
  {
    const e = engine();
    setPhase(e, 'DECLARE_ATTACKERS');
    const chamber = putZone(e, 'player', 'lcc-simic-growth-chamber', 'hand');
    e.state.pendingChoice = { type: 'HAKBAL_ATTACK', playerId: 'player', landInstanceIds: [chamber.instanceId], resume: 'PRIORITY' };
    e.state.priorityPlayer = 'player';
    e.perform('player', { type: 'CHOOSE_HAKBAL_ATTACK', landInstanceId: chamber.instanceId });
    const entered = e.findPermanent(chamber.instanceId);
    assert.ok(entered);
    assert.equal(entered.tapped, true);
    assert.equal(e.state.pendingChoice?.type, 'EFFECT_CARD_CHOICE');
    assert.ok(e.state.pendingChoice.candidateIds.includes(chamber.instanceId));
  }
});

test('Explorers complete: UI exposes resolution-time optional mana, tap/untap, and optional-effect decisions', () => {
  const app = fs.readFileSync(path.join(ROOT, 'src/App.jsx'), 'utf8');
  assert.match(app, /OPTIONAL_MANA_PAYMENT/);
  assert.match(app, /CHOOSE_OPTIONAL_MANA_PAYMENT/);
  assert.match(app, /TAP_OR_UNTAP/);
  assert.match(app, /CHOOSE_TAP_OR_UNTAP/);
  assert.match(app, /OPTIONAL_EFFECT/);
  assert.match(app, /CHOOSE_OPTIONAL_EFFECT/);
  assert.match(app, /Do Not Pay/);
  assert.match(app, /Do Nothing/);
  assert.match(app, /Use Effect/);
});

test('Explorers complete: intervening-if triggers are checked both when they would trigger and again on resolution', () => {
  // Zegana, Utopian Speaker should not even trigger unless another creature already has a +1/+1 counter.
  {
    const e = engine();
    setPhase(e, 'PRECOMBAT_MAIN');
    const zegana = putBattlefield(e, 'player', 'lcc-zegana-utopian-speaker');
    e.emit('ENTER_BATTLEFIELD', { controller: 'player', target: zegana, object: zegana });
    assert.ok(!e.state.stack.some(item => item.sourceInstanceId === zegana.instanceId), 'Zegana must not trigger when its intervening-if is false');
  }
  {
    const e = engine();
    setPhase(e, 'PRECOMBAT_MAIN');
    const other = putBattlefield(e, 'player', 'merfolk-mistbinder', { counters: { '+1/+1': 1 } });
    const zegana = putBattlefield(e, 'player', 'lcc-zegana-utopian-speaker');
    const before = e.state.players.player.hand.length;
    e.emit('ENTER_BATTLEFIELD', { controller: 'player', target: zegana, object: zegana });
    assert.ok(e.state.stack.some(item => item.sourceInstanceId === zegana.instanceId), 'Zegana should trigger when another creature has a counter');
    e.destroy(other);
    passToResolve(e);
    assert.equal(e.state.players.player.hand.length, before, 'Zegana must recheck its intervening-if on resolution');
  }

  // Simic Ascendancy should trigger at upkeep only if it already has at least twenty growth counters.
  {
    const e = engine();
    setPhase(e, 'UPKEEP');
    const ascendancy = putBattlefield(e, 'player', 'lcc-simic-ascendancy', { counters: { growth: 19 } });
    e.emit('PHASE_BEGIN', { controller: 'player', phase: 'UPKEEP' });
    assert.ok(!e.state.stack.some(item => item.sourceInstanceId === ascendancy.instanceId), 'Ascendancy must not trigger below twenty counters');
  }
  {
    const e = engine();
    setPhase(e, 'UPKEEP');
    const ascendancy = putBattlefield(e, 'player', 'lcc-simic-ascendancy', { counters: { growth: 20 } });
    e.emit('PHASE_BEGIN', { controller: 'player', phase: 'UPKEEP' });
    assert.ok(e.state.stack.some(item => item.sourceInstanceId === ascendancy.instanceId), 'Ascendancy should trigger at twenty counters');
    ascendancy.counters.growth = 19;
    passToResolve(e);
    assert.equal(e.state.winner, null, 'Ascendancy must recheck twenty growth counters on resolution');
  }
});

test('Explorers complete: counter triggers listen to the correct counter type and Simic Ascendancy cannot self-loop', () => {
  // Simic Ascendancy should react once to +1/+1 counters on a creature, then ignore the growth counters it adds to itself.
  {
    const e = engine();
    setPhase(e, 'PRECOMBAT_MAIN');
    const ascendancy = putBattlefield(e, 'player', 'lcc-simic-ascendancy');
    const creature = putBattlefield(e, 'player', 'merfolk-mistbinder');
    e.effects.addCounters('player', creature, '+1/+1', 3);
    assert.equal(e.state.stack.filter(item => item.sourceInstanceId === ascendancy.instanceId).length, 1);
    passToResolve(e);
    assert.equal(Number(ascendancy.counters.growth || 0), 3);
    assert.equal(e.state.stack.filter(item => item.sourceInstanceId === ascendancy.instanceId).length, 0, 'growth counters must not retrigger Ascendancy');
    assert.equal(e.state.pendingTriggers.filter(item => item.sourceInstanceId === ascendancy.instanceId).length, 0);
  }

  // Benthic Biomancer only triggers for +1/+1 counters, not arbitrary named counters.
  {
    const e = engine();
    setPhase(e, 'PRECOMBAT_MAIN');
    const biomancer = putBattlefield(e, 'player', 'lcc-benthic-biomancer');
    e.effects.addCounters('player', biomancer, 'shield', 1);
    assert.ok(!e.state.stack.some(item => item.sourceInstanceId === biomancer.instanceId));
    e.effects.addCounters('player', biomancer, '+1/+1', 1);
    assert.ok(e.state.stack.some(item => item.sourceInstanceId === biomancer.instanceId));
  }
});
