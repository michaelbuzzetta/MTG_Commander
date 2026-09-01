import test from 'node:test';
import assert from 'node:assert/strict';
import { EVENT } from '../src/engine/constants.js';
import { makeCardInstance } from '../src/engine/GameState.js';
import { engine, putBattlefield, setPhase, db } from './helpers.js';

function passToResolve(e) {
  const first = e.state.priorityPlayer || e.state.activePlayer;
  e.state.priorityPlayer = first;
  e.state.passes = 0;
  e.perform(first, { type: 'PASS_PRIORITY' });
  e.perform(e.state.priorityPlayer, { type: 'PASS_PRIORITY' });
}

function cardInZone(cardId, owner, zone) {
  return makeCardInstance(cardId, owner, zone);
}

function addToHand(e, pid, cardId) {
  const card = cardInZone(cardId, pid, 'hand');
  e.state.players[pid].hand.push(card);
  return card;
}

function setLibrary(e, pid, cardIds) {
  const cards = cardIds.map(cardId => cardInZone(cardId, pid, 'library'));
  e.state.players[pid].library = cards;
  return cards;
}

function countTokens(e, pid, name) {
  return e.state.players[pid].battlefield.filter(card => card.isToken && e.db[card.cardId]?.name === name).length;
}

test('Category 9 BUG-038: Hakbal lets its controller order Merfolk explores and each explore uses that chosen creature', () => {
  const e = engine();
  const hakbal = putBattlefield(e, 'player', 'hakbal');
  const scout = putBattlefield(e, 'player', 'merfolk-scout');
  setLibrary(e, 'player', ['grizzly-bears', 'forest', 'island']);

  e.emit(EVENT.BEGIN_COMBAT, { controller: 'player' });
  assert.equal(e.state.stack.length, 1);
  passToResolve(e);

  assert.equal(e.state.pendingChoice?.type, 'EXPLORE_ORDER');
  assert.deepEqual(new Set(e.state.pendingChoice.permanentIds), new Set([hakbal.instanceId, scout.instanceId]));

  e.perform('player', { type: 'ORDER_EXPLORES', permanentIds: [scout.instanceId, hakbal.instanceId] });
  assert.equal(e.state.pendingChoice?.type, 'EXPLORE_NONLAND');
  assert.equal(e.state.pendingChoice.permanentId, scout.instanceId, 'the first chosen Merfolk explores first');
  assert.equal(scout.counters['+1/+1'], 1);
  assert.equal(hakbal.counters['+1/+1'] || 0, 0);

  e.perform('player', { type: 'CHOOSE_EXPLORE', putInGraveyard: true });
  assert.equal(e.state.pendingChoice, null);
  assert.ok(e.state.players.player.hand.some(card => card.cardId === 'forest'), 'the second ordered Merfolk then explores the land into hand');
});

test('Category 9 BUG-038: Hakbal attack trigger offers land-to-battlefield or draw', () => {
  const e = engine();
  const hakbal = putBattlefield(e, 'player', 'hakbal');
  const land = addToHand(e, 'player', 'forest');

  e.emit(EVENT.DECLARE_ATTACKERS, { controller: 'player', attackers: [hakbal.instanceId] });
  assert.equal(e.state.stack.length, 1);
  passToResolve(e);
  assert.equal(e.state.pendingChoice?.type, 'HAKBAL_ATTACK');
  assert.ok(e.state.pendingChoice.landInstanceIds.includes(land.instanceId));
  assert.ok(e.getLegalActions('player').some(action => action.type === 'CHOOSE_HAKBAL_ATTACK' && action.landInstanceId === null), 'declining the land option is represented explicitly');

  e.perform('player', { type: 'CHOOSE_HAKBAL_ATTACK', landInstanceId: land.instanceId });
  const entered = e.findPermanent(land.instanceId);
  assert.ok(entered);
  assert.equal(entered.tapped, false);
  assert.equal(e.state.players.player.hand.some(card => card.instanceId === land.instanceId), false);

  const knownDraw = setLibrary(e, 'player', ['island'])[0];
  e.emit(EVENT.DECLARE_ATTACKERS, { controller: 'player', attackers: [hakbal.instanceId] });
  passToResolve(e);
  const handBefore = e.state.players.player.hand.length;
  e.perform('player', { type: 'CHOOSE_HAKBAL_ATTACK', landInstanceId: null });
  assert.equal(e.state.players.player.hand.length, handBefore + 1);
  assert.ok(e.state.players.player.hand.some(card => card.instanceId === knownDraw.instanceId));
});

test('Category 9 BUG-039/040: Cultivate chooses up to two basics, uses distinct destinations, shuffles, and land ETB triggers Evolution Sage', () => {
  const e = engine();
  putBattlefield(e, 'player', 'evolution-sage');
  const [forest, island, other] = setLibrary(e, 'player', ['forest', 'island', 'grizzly-bears']);

  e.effects.resolve({ type: 'cultivate' }, { controller: 'player' });
  assert.equal(e.state.pendingChoice?.type, 'CULTIVATE_SEARCH');
  assert.deepEqual(new Set(e.state.pendingChoice.eligibleIds), new Set([forest.instanceId, island.instanceId]));

  e.perform('player', { type: 'CHOOSE_CULTIVATE', cardInstanceIds: [forest.instanceId, island.instanceId] });
  const forestPermanent = e.findPermanent(forest.instanceId);
  assert.ok(forestPermanent);
  assert.equal(forestPermanent.tapped, true, 'the first selected basic enters tapped');
  assert.ok(e.state.players.player.hand.some(card => card.instanceId === island.instanceId), 'the second selected basic goes to hand');
  assert.deepEqual(e.state.players.player.library.map(card => card.instanceId), [other.instanceId], 'searched cards are gone and the remaining library is shuffled');
  assert.equal(e.state.stack.length, 1, 'the land ENTER_BATTLEFIELD event triggers Evolution Sage');
});

test('Category 9 BUG-040: Evolution Sage keys landfall to ENTER_BATTLEFIELD rather than only LAND_PLAYED', () => {
  const e = engine();
  putBattlefield(e, 'player', 'evolution-sage');
  const land = putBattlefield(e, 'player', 'forest');

  e.emit(EVENT.LAND_PLAYED, { controller: 'player', target: land });
  assert.equal(e.state.stack.length, 0, 'the obsolete land-play action alone is not the landfall trigger');

  e.emit(EVENT.ENTER_BATTLEFIELD, { controller: 'player', target: land });
  assert.equal(e.state.stack.length, 1, 'any qualifying land entry triggers Evolution Sage');
  passToResolve(e);
  assert.equal(e.state.pendingChoice?.type, 'PROLIFERATE');
});

test('Category 9 BUG-044: Prosperous Pirates has the correct identity and creates two Treasures on its own ETB', () => {
  const e = engine();
  assert.equal(e.db['treasure-maker'].name, 'Prosperous Pirates');
  assert.match(e.db['treasure-maker'].oracleText, /create two Treasure tokens/i);
  const pirates = putBattlefield(e, 'player', 'treasure-maker');

  e.emit(EVENT.ENTER_BATTLEFIELD, { controller: 'player', target: pirates });
  assert.equal(e.state.stack.length, 1);
  passToResolve(e);
  assert.equal(countTokens(e, 'player', 'Treasure'), 2);
});

test('Category 9 BUG-045: Healing Salve exposes both modes and resolves the chosen life-gain mode', () => {
  const e = engine();
  setPhase(e, 'PRECOMBAT_MAIN');
  const p = e.state.players.player;
  const salve = addToHand(e, 'player', 'healing-salve');
  p.manaPool.W = 1;

  const salveActions = e.getLegalActions('player').filter(action => action.cardInstanceId === salve.instanceId);
  assert.deepEqual(new Set(salveActions.map(action => action.mode)), new Set(['gain-life', 'prevent-damage']));
  const gain = salveActions.find(action => action.mode === 'gain-life' && action.targets?.[0] === 'player');
  assert.ok(gain);

  const before = p.life;
  e.perform('player', gain);
  assert.equal(e.state.stack.at(-1).mode, 'gain-life');
  passToResolve(e);
  assert.equal(p.life, before + 3);
});

test('Category 9 BUG-045: Healing Salve prevention mode prevents the next three damage to its chosen target', () => {
  const e = engine();
  setPhase(e, 'PRECOMBAT_MAIN');
  const p = e.state.players.player;
  const creature = putBattlefield(e, 'ai', 'grizzly-bears');
  const salve = addToHand(e, 'player', 'healing-salve');
  p.manaPool.W = 1;

  const prevent = e.getLegalActions('player').find(action => action.cardInstanceId === salve.instanceId && action.mode === 'prevent-damage' && action.targets?.[0] === creature.instanceId);
  assert.ok(prevent, 'the prevention mode can target a creature');
  e.perform('player', prevent);
  passToResolve(e);

  assert.equal(creature.damagePrevention, 3);
  const damage = e.dealDamageToPermanent(creature, 5, null);
  assert.deepEqual({ amount: damage.amount, prevented: damage.prevented }, { amount: 2, prevented: 3 });
  assert.equal(creature.damageMarked, 2);
  assert.equal(creature.damagePrevention, 0);
});

test('Category 9 BUG-046: Blech life-gain counters are restricted to the specified creature types', () => {
  const e = engine('blech', 'explorers');
  const blech = putBattlefield(e, 'player', 'blech');
  const bear = putBattlefield(e, 'player', 'grizzly-bears');
  const filter = e.db.blech.abilities[0].effect.filter;
  assert.deepEqual(new Set(filter.subtypes), new Set(['Pest', 'Bat', 'Insect', 'Snake', 'Spider']));

  e.changeLife('player', 2);
  assert.equal(e.state.stack.length, 1);
  passToResolve(e);
  assert.equal(blech.counters['+1/+1'], 1, 'Blech itself is a Pest and qualifies');
  assert.equal(bear.counters['+1/+1'] || 0, 0, 'unlisted creature types do not get counters');
});

test('Category 9 BUG-047: Esika makes any color and grants vigilance plus the same mana ability only to other legendary creatures', () => {
  const e = engine();
  setPhase(e, 'PRECOMBAT_MAIN');
  const esika = putBattlefield(e, 'player', 'esika');
  const sisay = putBattlefield(e, 'player', 'sisay');
  const bear = putBattlefield(e, 'player', 'grizzly-bears');

  assert.ok(e.static.derivedStats(sisay).keywords.map(x => x.toLowerCase()).includes('vigilance'));
  assert.equal(e.static.derivedStats(bear).keywords.map(x => x.toLowerCase()).includes('vigilance'), false);

  const sisayMana = e.getLegalActions('player').filter(action => action.type === 'ACTIVATE_MANA' && action.permanentId === sisay.instanceId);
  assert.deepEqual(new Set(sisayMana.map(action => action.manaColor)), new Set(['W', 'U', 'B', 'R', 'G']));
  const red = sisayMana.find(action => action.manaColor === 'R');
  e.perform('player', red);
  assert.equal(e.state.players.player.manaPool.R, 1);
  assert.equal(sisay.tapped, true);

  e.state.priorityPlayer = 'player';
  const esikaMana = e.getLegalActions('player').filter(action => action.type === 'ACTIVATE_MANA' && action.permanentId === esika.instanceId);
  assert.deepEqual(new Set(esikaMana.map(action => action.manaColor)), new Set(['W', 'U', 'B', 'R', 'G']));
  assert.equal(e.static.effectiveAbilities(bear).some(ability => ability.type === 'mana' && ability.grantedBy === 'esika'), false);

  assert.equal(e.db.esika.alternateFace?.name, 'The Prismatic Bridge');
  assert.equal(e.db.esika.alternateFace?.supported, false, 'unsupported MDFC casting is explicit rather than silently omitted');
  assert.match(e.db.esika.alternateFace?.unsupportedReason || '', /not implemented/i);
});

test('Category 9 BUG-048: Sisay gets +1/+1 for all five colors among other legendary permanents', () => {
  const e = engine();
  const sisay = putBattlefield(e, 'player', 'sisay');
  putBattlefield(e, 'player', 'aang'); // W/U/R/G
  putBattlefield(e, 'player', 'erebos'); // B

  const stats = e.static.derivedStats(sisay);
  assert.equal(stats.power, 7);
  assert.equal(stats.toughness, 7);
});

test('Category 9 BUG-048: Sisay WUBRG ability searches a qualifying legendary permanent directly onto the battlefield', () => {
  const e = engine();
  setPhase(e, 'PRECOMBAT_MAIN');
  const p = e.state.players.player;
  const sisay = putBattlefield(e, 'player', 'sisay');
  putBattlefield(e, 'player', 'aang');
  putBattlefield(e, 'player', 'erebos');
  const [thassa, tooExpensive] = setLibrary(e, 'player', ['thassa', 'keranos']);
  for (const color of ['W', 'U', 'B', 'R', 'G']) p.manaPool[color] = 1;

  const activation = e.getLegalActions('player').find(action => action.type === 'ACTIVATE_ABILITY' && action.permanentId === sisay.instanceId);
  assert.ok(activation);
  e.perform('player', activation);
  assert.equal(Object.values(p.manaPool).reduce((sum, n) => sum + n, 0), 0);
  passToResolve(e);

  assert.equal(e.state.pendingChoice?.type, 'SISAY_TUTOR');
  assert.ok(e.state.pendingChoice.eligibleIds.includes(thassa.instanceId));
  assert.ok(e.state.pendingChoice.eligibleIds.includes(tooExpensive.instanceId), 'Keranos MV 5 is below a 7-power Sisay');
  e.perform('player', { type: 'CHOOSE_SISAY_TUTOR', cardInstanceId: thassa.instanceId });
  assert.ok(e.findPermanent(thassa.instanceId));
  assert.equal(p.library.some(card => card.instanceId === thassa.instanceId), false);
});

test('Category 9 BUG-049: Thassa devotion changes creature status and its upkeep scry works while it is not a creature', () => {
  const e = engine();
  const thassa = putBattlefield(e, 'player', 'thassa');
  const [top, next] = setLibrary(e, 'player', ['grizzly-bears', 'forest']);

  assert.equal(e.static.devotion('player', ['U']), 1);
  assert.equal(e.static.isType(thassa, 'Creature'), false);
  assert.equal(e.combat.legalAttackers('player').some(card => card.instanceId === thassa.instanceId), false);

  e.emit(EVENT.PHASE_BEGIN, { controller: 'player', phase: 'UPKEEP' });
  assert.equal(e.state.stack.length, 1);
  passToResolve(e);
  assert.equal(e.state.pendingChoice?.type, 'SCRY');
  assert.equal(e.state.pendingChoice.cardInstanceId, top.instanceId);
  e.perform('player', { type: 'CHOOSE_SCRY', putOnBottom: true });
  assert.equal(e.state.players.player.library[0].instanceId, next.instanceId);

  for (let i = 0; i < 4; i++) putBattlefield(e, 'player', 'merfolk-scout');
  assert.equal(e.static.devotion('player', ['U']), 5);
  assert.equal(e.static.isType(thassa, 'Creature'), true);
  assert.ok(e.combat.legalAttackers('player').some(card => card.instanceId === thassa.instanceId));
});

test('Category 9 BUG-049: Thassa activated ability makes the chosen creature unblockable for the turn', () => {
  const e = engine();
  setPhase(e, 'PRECOMBAT_MAIN');
  const p = e.state.players.player;
  const thassa = putBattlefield(e, 'player', 'thassa');
  const scout = putBattlefield(e, 'player', 'merfolk-scout');
  const blocker = putBattlefield(e, 'ai', 'grizzly-bears');
  p.manaPool.U = 2;

  const action = e.getLegalActions('player').find(candidate => candidate.type === 'ACTIVATE_ABILITY' && candidate.permanentId === thassa.instanceId && candidate.targets?.[0] === scout.instanceId);
  assert.ok(action);
  e.perform('player', action);
  passToResolve(e);
  assert.ok(scout.modifiers.keywords.includes('unblockable'));
  assert.equal(e.combat.canBlock(blocker, scout), false);
});

test('Category 9 BUG-049: Erebos prevents opponents from gaining life and its paid activated ability draws a card', () => {
  const e = engine();
  putBattlefield(e, 'ai', 'erebos');
  const beforePlayer = e.state.players.player.life;
  const beforeAI = e.state.players.ai.life;
  assert.equal(e.changeLife('player', 3), 0);
  assert.equal(e.state.players.player.life, beforePlayer);
  assert.equal(e.changeLife('ai', 3), 3);
  assert.equal(e.state.players.ai.life, beforeAI + 3);

  const e2 = engine();
  setPhase(e2, 'PRECOMBAT_MAIN');
  const p = e2.state.players.player;
  const erebos = putBattlefield(e2, 'player', 'erebos');
  const drawn = setLibrary(e2, 'player', ['forest'])[0];
  p.manaPool.B = 2;
  const handBefore = p.hand.length;
  const ability = e2.getLegalActions('player').find(action => action.type === 'ACTIVATE_ABILITY' && action.permanentId === erebos.instanceId);
  assert.ok(ability);
  e2.perform('player', ability);
  assert.equal(p.life, 38, 'two life is paid as an activation cost');
  passToResolve(e2);
  assert.equal(p.hand.length, handBefore + 1);
  assert.ok(p.hand.some(card => card.instanceId === drawn.instanceId));
});

test('Category 9 BUG-049: Keranos first-draw land branch draws another card without retriggering', () => {
  const e = engine();
  putBattlefield(e, 'player', 'keranos');
  const [land, second] = setLibrary(e, 'player', ['forest', 'grizzly-bears']);
  e.state.activePlayer = 'player';
  e.state.cardsDrawnThisTurn.player = 0;
  const handBefore = e.state.players.player.hand.length;

  e.draw('player', 1);
  assert.ok(e.state.players.player.hand.some(card => card.instanceId === land.instanceId));
  assert.equal(e.state.stack.length, 1);
  passToResolve(e);
  assert.equal(e.state.players.player.hand.length, handBefore + 2);
  assert.ok(e.state.players.player.hand.some(card => card.instanceId === second.instanceId));
  assert.equal(e.state.stack.length, 0, 'the extra draw is not treated as the first draw again');
});

test('Category 9 BUG-049: Keranos first-draw nonland branch asks for any target and deals three to the selected target', () => {
  const e = engine();
  putBattlefield(e, 'player', 'keranos');
  setLibrary(e, 'player', ['grizzly-bears', 'forest']);
  e.state.activePlayer = 'player';
  e.state.cardsDrawnThisTurn.player = 0;

  e.draw('player', 1);
  assert.equal(e.state.pendingChoice?.type, 'TRIGGER_TARGET');
  assert.ok(e.state.pendingChoice.candidateIds.includes('ai'));
  e.perform('player', { type: 'CHOOSE_TRIGGER_TARGET', targetIds: ['ai'] });
  assert.equal(e.state.stack.length, 1);
  const before = e.state.players.ai.life;
  passToResolve(e);
  assert.equal(e.state.players.ai.life, before - 3);
});

test('Category 9 card records carry rules text for every audited individual card', () => {
  for (const id of ['hakbal', 'cultivate', 'evolution-sage', 'treasure-maker', 'healing-salve', 'blech', 'esika', 'sisay', 'thassa', 'keranos', 'erebos']) {
    assert.ok(typeof db[id]?.oracleText === 'string' && db[id].oracleText.trim().length > 0, `${id} has rules text`);
  }
});
