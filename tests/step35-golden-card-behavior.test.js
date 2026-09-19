import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import manifest from './golden/step35-golden-cards.json' with { type: 'json' };
import supportPayload from '../src/data/generated/card-support.json' with { type: 'json' };
import sourceCards from '../src/data/source/cards.json' with { type: 'json' };
import { ENGINE_EVENT } from '../src/engine/events/index.js';
import { CardGoldenHarness } from './golden/CardGoldenHarness.js';

function fingerprint(value = '') {
  return crypto.createHash('sha256').update(String(value).replace(/\r\n/g, '\n').trim()).digest('hex').slice(0, 16);
}

function derived(e, permanent) { return e.getDerivedStats(permanent); }

const CASES = Object.freeze({

  'esika-front-mana-and-grant': ({ cardId }) => {
    const h = new CardGoldenHarness();
    const esika = h.permanent(cardId);
    const sisay = h.permanent('sisay');
    const bear = h.permanent('grizzly-bears');

    const esikaAbility = h.definition(cardId).abilities.find(ability => ability.type === 'mana');
    h.engine.activateMana('player', esika.instanceId, esikaAbility, 'R');
    assert.equal(esika.tapped, true);
    assert.equal(h.engine.state.players.player.manaPool.R, 1);

    const sisayStats = derived(h.engine, sisay);
    const bearStats = derived(h.engine, bear);
    assert.ok(sisayStats.keywords.map(value => String(value).toLowerCase()).includes('vigilance'));
    assert.equal(bearStats.keywords.map(value => String(value).toLowerCase()).includes('vigilance'), false);
    const granted = h.engine.static.effectiveAbilities(sisay).find(ability => ability.type === 'mana' && ability.grantedBy === 'esika');
    assert.ok(granted, 'Esika grants the five-color mana ability to other legendary creatures');
    assert.deepEqual(new Set(granted.colors), new Set(['W', 'U', 'B', 'R', 'G']));
  },

  'mdfc-esika-and-bridge': ({ cardId }) => {
    const h = new CardGoldenHarness();
    h.giveAbundantMana('player');
    const card = h.handCard(cardId);
    const actions = h.engine.getLegalActions('player').filter(action => action.cardInstanceId === card.instanceId && action.type === 'CAST_SPELL');
    assert.deepEqual(new Set(actions.map(action => action.castFaceIndex)), new Set([0, 1]));
    const bridgeCast = actions.find(action => action.castFaceIndex === 1);
    h.engine.perform('player', bridgeCast);
    h.resolveTopStack();
    const bridge = h.engine.findPermanent(card.instanceId);
    assert.ok(bridge);
    assert.equal(bridge.faceState.currentFaceIndex, 1);

    const first = h.card('forest', 'player', 'library');
    const hit = h.card('grizzly-bears', 'player', 'library');
    h.engine.zones.moveWithinZone('player', 'library', hit.instanceId, 0);
    h.engine.zones.moveWithinZone('player', 'library', first.instanceId, 0);
    h.engine.emit('PHASE_BEGIN', { controller: 'player', phase: 'UPKEEP' });
    h.resolveTopStack();
    assert.equal(h.zoneOf(hit), 'battlefield');
    assert.equal(h.zoneOf(first), 'library');
    assert.equal(h.engine.knownInformation.isKnown('ai', first), false);
  },

  'cast-characteristic-permanent': ({ cardId }) => {
    const h = new CardGoldenHarness();
    const def = h.definition(cardId);
    const card = h.castAndResolve(cardId);
    assert.equal(h.zoneOf(card), 'battlefield');
    const permanent = h.engine.findPermanent(card.instanceId);
    assert.ok(permanent, 'resolved permanent must exist on the battlefield');
    if (/Creature/i.test(def.typeLine || '')) {
      assert.equal(derived(h.engine, permanent).power, Number(def.power));
      assert.equal(derived(h.engine, permanent).toughness, Number(def.toughness));
    }
    h.assertEventSequence([ENGINE_EVENT.CAST, ENGINE_EVENT.MOVE_ZONE, 'SPELL_RESOLVED']);
  },

  'cast-destroy-artifact-or-enchantment': ({ cardId }) => {
    const h = new CardGoldenHarness();
    const target = h.permanent('sol-ring', 'ai');
    const spell = h.castAndResolve(cardId, { targets: [target.instanceId] });
    assert.equal(h.zoneOf(target), 'graveyard');
    assert.equal(h.zoneOf(spell), 'graveyard');
    h.assertEventSequence([ENGINE_EVENT.CAST, ENGINE_EVENT.DESTROY, ENGINE_EVENT.MOVE_ZONE, 'SPELL_RESOLVED']);
  },

  'search-basic-to-battlefield-tapped': ({ cardId }) => {
    const h = new CardGoldenHarness();
    const before = h.engine.state.players.player.battlefield.length;
    const spell = h.castAndResolve(cardId);
    assert.equal(h.zoneOf(spell), 'graveyard');
    const lands = h.engine.state.players.player.battlefield.slice(before);
    assert.equal(lands.length, 1, 'spell should move exactly one basic land from the library');
    assert.equal(lands[0].tapped, true, 'searched land must enter tapped');
    assert.match(h.definition(lands[0].cardId).typeLine || '', /Basic Land/i);
    h.assertEventSequence([ENGINE_EVENT.CAST, ENGINE_EVENT.SEARCH, ENGINE_EVENT.SHUFFLE, 'SPELL_RESOLVED']);
  },
  'basic-mana': ({ cardId }) => {
    const expected = { plains: 'W', island: 'U', swamp: 'B', mountain: 'R', forest: 'G' }[cardId];
    const h = new CardGoldenHarness();
    const land = h.permanent(cardId);
    const ability = h.definition(cardId).abilities[0];
    h.engine.activateMana('player', land.instanceId, ability);
    assert.equal(land.tapped, true);
    assert.equal(h.engine.state.players.player.manaPool[expected], 1);
  },

  'commander-color-mana': ({ cardId }) => {
    const h = new CardGoldenHarness();
    const source = h.permanent(cardId);
    const ability = h.definition(cardId).abilities[0];
    h.engine.activateMana('player', source.instanceId, ability, 'G');
    assert.equal(source.tapped, true);
    assert.equal(h.engine.state.players.player.manaPool.G, 1);
  },

  'fixed-colorless-mana': ({ cardId }) => {
    const h = new CardGoldenHarness();
    const source = h.permanent(cardId);
    h.engine.activateMana('player', source.instanceId, h.definition(cardId).abilities[0]);
    assert.equal(source.tapped, true);
    assert.equal(h.engine.state.players.player.manaPool.C, 2);
  },

  'cast-vanilla-permanent': ({ cardId }) => {
    const h = new CardGoldenHarness();
    const card = h.castAndResolve(cardId, { mana: { G: 2 } });
    assert.equal(h.zoneOf(card), 'battlefield');
    const permanent = h.engine.findPermanent(card.instanceId);
    assert.equal(derived(h.engine, permanent).power, 2);
    assert.equal(derived(h.engine, permanent).toughness, 2);
    h.assertEventSequence([ENGINE_EVENT.CAST, ENGINE_EVENT.MOVE_ZONE, 'SPELL_RESOLVED']);
  },

  'cast-draw-two': ({ cardId }) => {
    const h = new CardGoldenHarness();
    const beforeLibrary = h.engine.state.players.player.library.length;
    const beforeHand = h.engine.state.players.player.hand.length;
    const card = h.castAndResolve(cardId, { mana: { U: 3 } });
    assert.equal(h.zoneOf(card), 'graveyard');
    assert.equal(h.engine.state.players.player.library.length, beforeLibrary - 2);
    // One test card entered hand, then was cast (-1), then two cards were drawn.
    assert.equal(h.engine.state.players.player.hand.length, beforeHand + 2);
    h.assertEventSequence([ENGINE_EVENT.CAST, ENGINE_EVENT.DRAW_CARD, ENGINE_EVENT.DRAW_CARD, ENGINE_EVENT.MOVE_ZONE, 'SPELL_RESOLVED']);
  },

  'cast-deal-three': ({ cardId }) => {
    const h = new CardGoldenHarness();
    const before = h.engine.state.players.ai.life;
    const card = h.castAndResolve(cardId, { targets: ['ai'], mana: { R: 1 } });
    assert.equal(h.engine.state.players.ai.life, before - 3);
    assert.equal(h.zoneOf(card), 'graveyard');
    h.assertEventSequence([ENGINE_EVENT.CAST, ENGINE_EVENT.DEAL_DAMAGE, ENGINE_EVENT.MOVE_ZONE, 'SPELL_RESOLVED']);
  },

  'cast-destroy-creature': ({ cardId }) => {
    const h = new CardGoldenHarness();
    const target = h.permanent('grizzly-bears', 'ai');
    const spell = h.castAndResolve(cardId, { targets: [target.instanceId], mana: { B: 3 } });
    assert.equal(h.zoneOf(target), 'graveyard');
    assert.equal(h.zoneOf(spell), 'graveyard');
    h.assertEventSequence([ENGINE_EVENT.CAST, ENGINE_EVENT.DESTROY, ENGINE_EVENT.MOVE_ZONE, 'SPELL_RESOLVED']);
  },

  'plus-one-counter-add-one': ({ cardId }) => {
    const h = new CardGoldenHarness();
    h.permanent(cardId);
    const creature = h.permanent('grizzly-bears');
    const placed = h.engine.addCounters(creature, '+1/+1', 2, { playerId: 'player', cause: 'step35-golden' });
    assert.equal(placed, 3);
    assert.equal(creature.counters['+1/+1'], 3);
    assert.equal(h.engine.getEventLogSnapshot().some(event => event.type === ENGINE_EVENT.ADD_COUNTER && event.replacementTrace?.length), true);
  },

  'plus-one-counter-double': ({ cardId }) => {
    const h = new CardGoldenHarness();
    h.permanent(cardId);
    const creature = h.permanent('grizzly-bears');
    const placed = h.engine.addCounters(creature, '+1/+1', 2, { playerId: 'player', cause: 'step35-golden' });
    assert.equal(placed, 4);
    assert.equal(creature.counters['+1/+1'], 4);
  },

  'counter-double': ({ cardId }) => {
    const h = new CardGoldenHarness();
    h.permanent(cardId);
    const creature = h.permanent('grizzly-bears');
    h.engine.addCounters(creature, '+1/+1', 2, { playerId: 'player', cause: 'step35-golden' });
    assert.equal(creature.counters['+1/+1'], 4);
  },

  'token-double': ({ cardId }) => {
    const h = new CardGoldenHarness();
    h.permanent(cardId);
    const before = h.engine.state.players.player.battlefield.length;
    h.engine.effects.createToken('player', { name: 'Pest', typeLine: 'Creature — Pest', power: 1, toughness: 1, subtypes: ['Pest'] }, 1);
    assert.equal(h.engine.state.players.player.battlefield.length - before, 2);
    assert.equal(h.engine.getEventLogSnapshot().some(event => event.type === ENGINE_EVENT.CREATE_TOKEN && event.replacementTrace?.length), true);
  },

  'utility-token-triplicate': ({ cardId }) => {
    const h = new CardGoldenHarness();
    h.permanent(cardId);
    const before = h.countBattlefieldByName('player', ['Treasure', 'Food', 'Clue']);
    h.engine.effects.createToken('player', { name: 'Treasure', typeLine: 'Artifact — Treasure' }, 1);
    const after = h.countBattlefieldByName('player', ['Treasure', 'Food', 'Clue']);
    assert.deepEqual({
      Treasure: after.Treasure - before.Treasure,
      Food: after.Food - before.Food,
      Clue: after.Clue - before.Clue
    }, { Treasure: 1, Food: 1, Clue: 1 });
  },

  'landfall-proliferate': ({ cardId }) => {
    const h = new CardGoldenHarness();
    h.permanent(cardId);
    const creature = h.permanent('grizzly-bears');
    h.setCounters(creature, '+1/+1', 1);
    const land = h.handCard('forest');
    h.engine.state.players.player.landPlaysRemaining = 1;
    h.engine.playLand('player', land.instanceId);
    assert.equal(h.zoneOf(land), 'battlefield');
    assert.equal(h.engine.state.stack.length, 1, 'land entering should queue the landfall trigger');
    h.resolveTopStack();
    assert.equal(h.engine.state.pendingChoice?.type, 'PROLIFERATE');
    h.engine.perform('player', { type: 'CHOOSE_PROLIFERATE', targetIds: [creature.instanceId] });
    assert.equal(creature.counters['+1/+1'], 2);
    h.assertEventSequence([ENGINE_EVENT.MOVE_ZONE, 'ENTER_BATTLEFIELD']);
  },

  'other-merfolk-plus-one': ({ cardId }) => {
    const h = new CardGoldenHarness();
    const mistbinder = h.permanent(cardId);
    const other = h.permanent('hakbal');
    assert.equal(derived(h.engine, mistbinder).power, 2, 'Mistbinder does not buff itself');
    assert.equal(derived(h.engine, other).power, Number(h.definition('hakbal').power) + 1);
    assert.equal(derived(h.engine, other).toughness, Number(h.definition('hakbal').toughness) + 1);
  },

  'indestructible-survives-destroy': ({ cardId }) => {
    const h = new CardGoldenHarness();
    const permanent = h.permanent(cardId);
    assert.equal(h.engine.destroy(permanent), false);
    assert.equal(h.zoneOf(permanent), 'battlefield');
  },

  'reach-blocks-flying': ({ cardId }) => {
    const h = new CardGoldenHarness();
    const attacker = h.permanent('wind-drake', 'player');
    const blocker = h.permanent(cardId, 'ai');
    attacker.attacking = true;
    h.engine.state.combat.attackers = [attacker.instanceId];
    h.engine.state.combat.attackTargets[attacker.instanceId] = 'ai';
    h.engine.state.combat.attackDefendingPlayers[attacker.instanceId] = 'ai';
    assert.equal(h.engine.combat.canBlock(blocker, attacker), true);
  },

  'flying-block-restriction': ({ cardId }) => {
    const h = new CardGoldenHarness();
    const attacker = h.permanent(cardId, 'player');
    const ground = h.permanent('grizzly-bears', 'ai');
    const reach = h.permanent('giant-spider', 'ai');
    attacker.attacking = true;
    h.engine.state.combat.attackers = [attacker.instanceId];
    h.engine.state.combat.attackTargets[attacker.instanceId] = 'ai';
    h.engine.state.combat.attackDefendingPlayers[attacker.instanceId] = 'ai';
    assert.equal(h.engine.combat.canBlock(ground, attacker), false);
    assert.equal(h.engine.combat.canBlock(reach, attacker), true);
  },

  'menace-requires-two-blockers': ({ cardId }) => {
    const h = new CardGoldenHarness();
    const attacker = h.permanent(cardId, 'player');
    assert.equal(h.engine.mechanics.requiredBlockerCount(attacker), 2);
  },

  'trample-over-blocker': ({ cardId }) => {
    const h = new CardGoldenHarness();
    const attacker = h.permanent(cardId, 'player');
    const blocker = h.permanent('grizzly-bears', 'ai');
    assert.equal(h.engine.mechanics.hasTrample(attacker), true);
    assert.equal(h.engine.mechanics.lethalDamageForBlocker(attacker, blocker), 2);
    assert.equal(derived(h.engine, attacker).power - h.engine.mechanics.lethalDamageForBlocker(attacker, blocker), 2);
  },

  'vigilance-does-not-tap-attacking': ({ cardId }) => {
    const h = new CardGoldenHarness();
    const creature = h.permanent(cardId);
    assert.equal(h.engine.mechanics.tapsWhenAttacking(creature), false);
  },

  'deathtouch-lifelink-damage': ({ cardId }) => {
    const h = new CardGoldenHarness();
    const source = h.permanent(cardId, 'player');
    const target = h.permanent('trampling-rhino', 'ai');
    h.engine.state.players.player.life = 30;
    const dealt = h.engine.dealDamageToPermanent(target, 2, source);
    assert.equal(dealt.amount, 2);
    assert.equal(h.engine.state.players.player.life, 32, 'lifelink gains life equal to actual damage dealt');
    h.engine.stateBasedActions();
    assert.equal(h.zoneOf(target), 'graveyard', 'deathtouch damage destroys a creature with nonlethal marked damage');
  }
});

const supportById = Object.fromEntries(supportPayload.cards.map(row => [row.cardId, row]));
const fullySupported = supportPayload.cards.filter(row => row.supportStatus === 'fully_supported');

test('Step 35 gate: golden manifest exactly covers every fully supported card and locks Oracle/rules metadata', () => {
  assert.deepEqual(Object.keys(manifest.cards).sort(), fullySupported.map(row => row.cardId).sort());
  assert.equal(manifest.engineRulesVersion, 'mtg-cr-2026-08-07');
  for (const row of fullySupported) {
    const contract = manifest.cards[row.cardId];
    assert.ok(contract.cases.length > 0, `${row.cardId} requires at least one golden case`);
    assert.equal(contract.name, row.name);
    assert.equal(contract.oracleIdentity, row.oracleIdentity);
    assert.equal(contract.supportRulesVersion, row.lastValidatedRulesVersion);
    assert.equal(contract.oracleTextFingerprint, fingerprint(sourceCards[row.cardId]?.oracleText || ''), `${row.cardId} Oracle text changed; review behavior before updating the golden fixture`);
  }
});

test('Step 35 gate: every declared golden case maps to an executable behavior contract', () => {
  for (const [cardId, contract] of Object.entries(manifest.cards)) {
    assert.equal(supportById[cardId]?.supportStatus, 'fully_supported');
    for (const row of contract.cases) assert.equal(typeof CASES[row.id], 'function', `${cardId} references unknown golden case ${row.id}`);
  }
});

for (const [cardId, contract] of Object.entries(manifest.cards)) {
  for (const caseRow of contract.cases) {
    test(`Step 35 golden — ${contract.name}: ${caseRow.id}`, () => {
      CASES[caseRow.id]({ cardId, contract, caseRow });
    });
  }
}
