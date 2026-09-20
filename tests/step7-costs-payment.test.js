import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCardInstance } from '../src/engine/GameState.js';
import { parseManaSymbols, expandManaCostAlternatives } from '../src/engine/costs/index.js';
import { engine, putBattlefield, setPhase } from './helpers.js';

function registerCard(e, id, definition = {}) {
  const card = {
    id, name: id, typeLine: 'Creature — Human', manaCost: '{1}', manaValue: 1,
    colorIdentity: [], subtypes: ['Human'], keywords: [], power: 1, toughness: 1,
    abilities: [], spellEffects: [], oracleText: 'Step 7 test card.', supported: true,
    ...definition
  };
  e._registerRuntimeCardDefinition(id, card);
  return card;
}

test('Step 7: mana-symbol parser recognizes colored, generic, hybrid, monohybrid, phyrexian, snow, and variables', () => {
  const parsed = parseManaSymbols('{2}{W}{U/B}{2/G}{R/P}{S}{X}');
  assert.deepEqual(parsed.map(x => x.kind), ['generic','colored','hybrid','monohybrid','phyrexian','snow','variable']);
  assert.equal(parsed[0].amount, 2);
  assert.deepEqual(parsed[2].colors, ['U','B']);
  assert.equal(parsed[3].color, 'G');
  assert.equal(parsed[4].color, 'R');
  assert.equal(parsed[6].variable, 'X');
});

test('Step 7: advanced symbols expand into legal deterministic payment alternatives', () => {
  const alternatives = expandManaCostAlternatives('{W/U}{2/G}{B/P}{X}{S}', { variables: { X: 3 } });
  assert.equal(alternatives.length, 8);
  assert.ok(alternatives.some(x => x.exact.W === 1 && x.exact.G === 1 && x.exact.B === 1 && x.generic === 3 && x.snow === 1 && x.life === 0));
  assert.ok(alternatives.some(x => x.exact.U === 1 && x.generic === 5 && x.snow === 1 && x.life === 2));
});

test('Step 7: spell cost pipeline applies commander tax/increases before reductions and locks the result', () => {
  const e = engine();
  registerCard(e, 'step7-cost-card', { manaCost: '{2}{G}', manaValue: 3 });
  const card = makeCardInstance('step7-cost-card', 'player', 'command', { isCommander: true }, e.db['step7-cost-card']);
  e.state.players.player.commanderTax = 4;
  const locked = e.costs.determineSpellCost('player', card, { zone: 'command', costIncreases: [2], costReductions: [1] });
  assert.equal(locked.baseManaCost, '{2}{G}');
  assert.equal(locked.stages.commanderTax, 4);
  assert.equal(locked.stages.increases, 6);
  assert.equal(locked.stages.reductions, 1);
  assert.equal(locked.finalManaCost, '{7}{G}');
  assert.equal(Object.isFrozen(locked), true);
});

test('Step 7: restricted mana cannot pay an illegal spell but can pay a matching creature-type spell', () => {
  const e = engine();
  registerCard(e, 'step7-human', { manaCost: '{W}', manaValue: 1, typeLine: 'Creature — Human', subtypes: ['Human'] });
  registerCard(e, 'step7-elf', { manaCost: '{W}', manaValue: 1, typeLine: 'Creature — Elf', subtypes: ['Elf'] });
  const human = makeCardInstance('step7-human', 'player', 'hand', {}, e.db['step7-human']);
  const elf = makeCardInstance('step7-elf', 'player', 'hand', {}, e.db['step7-elf']);
  const player = e.state.players.player;
  player.manaPool = { W:0,U:0,B:0,R:0,G:0,C:0 };
  player.restrictedMana = [{ id: 'r1', color: 'W', amount: 1, restriction: 'chosenCreatureTypeSpell', chosenType: 'Human' }];
  const humanCost = e.costs.determineSpellCost('player', human, { zone: 'hand' });
  const elfCost = e.costs.determineSpellCost('player', elf, { zone: 'hand' });
  assert.ok(e.payments.planner.plan('player', humanCost, { context: { kind: 'cast', card: human } }));
  assert.equal(e.payments.planner.plan('player', elfCost, { context: { kind: 'cast', card: elf } }), null);
});

test('Step 7: phyrexian mana can be paid with mana or life without mutating state during planning', () => {
  const e = engine();
  const player = e.state.players.player;
  player.life = 10;
  player.manaPool = { W:0,U:0,B:0,R:0,G:0,C:0 };
  const before = structuredClone(player);
  const locked = Object.freeze({ finalManaCost: '{U/P}', variables: {}, nonManaCosts: [] });
  const plan = e.payments.planner.plan('player', locked, { context: { kind: 'cast', card: null } });
  assert.equal(plan.lifePayment, 2);
  assert.deepEqual(player, before);
});

test('Step 7: reusable non-mana costs validate before mutation', () => {
  const e = engine();
  const source = putBattlefield(e, 'player', 'grizzly-bears');
  const invalid = putBattlefield(e, 'ai', 'grizzly-bears');
  const before = structuredClone(e.state);
  const locked = Object.freeze({
    finalManaCost: '', variables: {},
    nonManaCosts: [
      { type: 'tap', permanentId: source.instanceId },
      { type: 'sacrifice', permanentId: invalid.instanceId }
    ]
  });
  assert.throws(() => e.payments.payLockedCost('player', locked, { context: { kind: 'ability', source } }), /sacrifice/i);
  assert.deepEqual(e.state, before);
});

test('Step 7: a commit-time payment failure rolls the entire transaction back', () => {
  const e = engine();
  const source = putBattlefield(e, 'player', 'grizzly-bears');
  const before = structuredClone(e.state);
  const locked = Object.freeze({ finalManaCost: '{G}', variables: {}, nonManaCosts: [{ type: 'tap', permanentId: source.instanceId }] });
  const originalPlan = e.payments.planner.plan.bind(e.payments.planner);
  e.payments.planner.plan = () => ({
    lockedCost: locked,
    activations: [{ permanentId: 'missing-source', ability: {}, mana: { G: 1 }, requiresTap: true }],
    assignments: [], lifePayment: 0
  });
  assert.throws(() => e.payments.payLockedCost('player', locked, { context: { kind: 'ability', source } }), /disappeared/i);
  e.payments.planner.plan = originalPlan;
  assert.deepEqual(e.state, before);
});

test('Step 7: cancelled/affordability checks do not consume mana or tap sources', () => {
  const e = engine();
  const forest = putBattlefield(e, 'player', 'forest');
  const player = e.state.players.player;
  const before = structuredClone(player);
  const locked = Object.freeze({ finalManaCost: '{G}', variables: {}, nonManaCosts: [] });
  assert.equal(e.payments.canPayLockedCost('player', locked, { context: { kind: 'cast', card: makeCardInstance('grizzly-bears','player','hand',{},e.db['grizzly-bears']) } }), true);
  assert.deepEqual(player, before);
  assert.equal(forest.tapped, false);
});

test('Step 7: activated-ability cost construction includes tap, life, sacrifice, counter, and selected-object costs', () => {
  const e = engine();
  const source = putBattlefield(e, 'player', 'grizzly-bears', { counters: { charge: 2 } });
  const helper = putBattlefield(e, 'player', 'forest');
  const ability = {
    cost: { mana: '{1}', life: 2, sacrificeSelf: true, removeCounterSelf: { counter: 'charge', amount: 1 } },
    selection: { tap: true }
  };
  const locked = e.costs.determineAbilityCost('player', source, ability, { selections: [helper.instanceId], defaultTap: true });
  assert.equal(locked.finalManaCost, '{1}');
  assert.deepEqual(locked.nonManaCosts.map(x => x.type), ['tap','payLife','sacrifice','removeCounter','tap']);
});

test('Step 7: normal spell casting uses the locked payment plan and commits payment before stack insertion', () => {
  const e = engine();
  registerCard(e, 'step7-cast', { typeLine: 'Instant', manaCost: '{G}', manaValue: 1, spellEffects: [{ type: 'gainLife', amount: 1 }] });
  const card = makeCardInstance('step7-cast', 'player', 'hand', {}, e.db['step7-cast']);
  e.zones.place(card, 'hand', 'player');
  const forest = putBattlefield(e, 'player', 'forest');
  setPhase(e, 'UPKEEP', { activePlayer: 'ai', priorityPlayer: 'player' });
  e.perform('player', { type: 'CAST_SPELL', cardInstanceId: card.instanceId, targets: [] });
  assert.equal(forest.tapped, true);
  assert.equal(e.state.stack.length, 1);
  assert.equal(e.state.stack[0].card.instanceId, card.instanceId);
  assert.ok(e.state.stack[0].lockedCost);
  assert.ok(e.state.stack[0].paymentPlan);
});

test('Phase 12: selection-backed sacrifice is locked as a non-mana cost', () => {
  const e = engine();
  const source = putBattlefield(e, 'player', 'grizzly-bears');
  const helper = putBattlefield(e, 'player', 'grizzly-bears');
  const locked = e.costs.determineAbilityCost('player', source, { cost:{ sacrificeSelection:true }, selection:{ count:1, type:'Creature', other:true, tap:false } }, { selections:[helper.instanceId] });
  assert.deepEqual(locked.nonManaCosts, [{ type:'sacrifice', permanentId:helper.instanceId }]);
});
