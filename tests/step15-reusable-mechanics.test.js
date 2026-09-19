import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/engine/GameEngine.js';
import { EVENT } from '../src/engine/constants.js';
import { db, decks, putBattlefield } from './helpers.js';

function game(players = 2) {
  const selected = decks.filter(deck => deck.playable !== false).slice(0, players);
  return new GameEngine(selected[0], players === 2 ? selected[1] : selected.slice(1), db, { rng: () => 0.42 });
}

function addDefinition(engine, id, fields = {}) {
  engine.db[id] = {
    id,
    name: fields.name || id,
    typeLine: fields.typeLine || 'Creature — Test',
    manaCost: fields.manaCost || '{1}',
    manaValue: fields.manaValue ?? 1,
    power: fields.power ?? 2,
    toughness: fields.toughness ?? 2,
    colors: fields.colors || [],
    colorIdentity: fields.colorIdentity || [],
    subtypes: fields.subtypes || ['Test'],
    keywords: fields.keywords || [],
    abilities: fields.abilities || [],
    spellEffects: fields.spellEffects || [],
    oracleText: fields.oracleText || '',
    supported: true,
    ...fields
  };
  return engine.db[id];
}

test('Step 15: mechanic registry contains evergreen, Commander, casting, and specialty packages with explicit dependencies', () => {
  const e = game();
  const snapshot = e.mechanics.snapshot();
  const categories = new Set(snapshot.map(row => row.category));
  assert.ok(categories.has('evergreen'));
  assert.ok(categories.has('commander'));
  assert.ok(categories.has('casting'));
  assert.ok(categories.has('specialty'));
  for (const name of ['flying','ward','myriad','proliferate','kicker','convoke','delve','storm','manifest']) {
    const definition = snapshot.find(row => row.id === name);
    assert.ok(definition, `${name} must be registered`);
    assert.ok(definition.dependencies.length > 0, `${name} must declare subsystem dependencies`);
    assert.ok(definition.hooks.length > 0, `${name} must declare at least one reusable rules hook`);
    assert.ok(definition.conformance.length > 0, `${name} must declare conformance surfaces`);
  }
});

test('Step 15: cards sharing a mechanic resolve through the same registry definition', () => {
  const e = game();
  const wind = e.mechanics.mechanicDefinitionsFor(db['wind-drake']).find(row => row.id === 'flying');
  const nighthawk = e.mechanics.mechanicDefinitionsFor(db['vampire-nighthawk']).find(row => row.id === 'flying');
  const skydiver = e.mechanics.mechanicDefinitionsFor(db['lcc-thieving-skydiver']).find(row => row.id === 'flying');
  assert.ok(wind && nighthawk && skydiver);
  assert.strictEqual(wind, nighthawk);
  assert.strictEqual(nighthawk, skydiver);
});

test('Step 15: evergreen combat hooks centralize flying/reach, haste, vigilance, menace, strike steps, trample, and deathtouch', () => {
  const e = game();
  const flyer = putBattlefield(e, 'player', 'wind-drake', { summoningSick: true });
  const normal = putBattlefield(e, 'ai', 'grizzly-bears');
  const reach = putBattlefield(e, 'ai', 'giant-spider');
  e.state.combat.attackDefendingPlayers[flyer.instanceId] = 'ai';
  assert.equal(e.combat.canBlock(normal, flyer), false);
  assert.equal(e.combat.canBlock(reach, flyer), true);

  addDefinition(e, 'step15-haste', { keywords: ['haste'] });
  const hasty = putBattlefield(e, 'player', 'step15-haste', { summoningSick: true });
  assert.equal(e.mechanics.canIgnoreSummoningSickness(hasty), true);
  assert.ok(e.combat.legalAttackers('player').some(card => card.instanceId === hasty.instanceId));

  const vigilant = putBattlefield(e, 'player', 'vigilant-knight');
  assert.equal(e.mechanics.tapsWhenAttacking(vigilant), false);
  const menace = putBattlefield(e, 'player', 'menace-ogre');
  assert.equal(e.mechanics.requiredBlockerCount(menace), 2);

  addDefinition(e, 'step15-double', { keywords: ['double strike'] });
  const double = putBattlefield(e, 'player', 'step15-double');
  assert.equal(e.mechanics.participatesInCombatDamageStep(double, true), true);
  assert.equal(e.mechanics.participatesInCombatDamageStep(double, false), true);
  assert.equal(e.mechanics.hasTrample(putBattlefield(e, 'player', 'trampling-rhino')), true);
  assert.equal(e.mechanics.lethalDamageForBlocker(putBattlefield(e, 'player', 'vampire-nighthawk'), normal), 1);
});

test('Step 15: targeting mechanics share one hexproof/protection/ward implementation', () => {
  const e = game();
  addDefinition(e, 'step15-hex', { keywords: ['hexproof'] });
  addDefinition(e, 'step15-pro-red', { keywords: ['protection from red'] });
  addDefinition(e, 'step15-red-source', { typeLine: 'Creature — Wizard', manaCost: '{R}', colors: ['R'] });
  addDefinition(e, 'step15-ward', { keywords: ['ward {2}'] });
  const hex = putBattlefield(e, 'ai', 'step15-hex');
  const protection = putBattlefield(e, 'ai', 'step15-pro-red');
  const red = putBattlefield(e, 'player', 'step15-red-source');
  const ward = putBattlefield(e, 'ai', 'step15-ward');

  assert.throws(() => e.mechanics.validateTargeting('player', hex, red), /hexproof/i);
  assert.throws(() => e.mechanics.validateTargeting('player', protection, red), /protection from red/i);
  e.dealDamageToPermanent(protection, 2, red);
  assert.equal(protection.damageMarked, 0, 'protection prevents damage from a matching source through the prevention pipeline');
  assert.deepEqual(e.mechanics.wardCost(ward), { mana: '{2}', life: 0 });
  assert.deepEqual(e.targeting.getWardCost(ward), { mana: '{2}', life: 0 }, 'TargetingEngine delegates ward parsing to mechanic library');
});

test('Step 15: lifelink, deathtouch, and indestructible use mechanic hooks in authoritative damage/SBA paths', () => {
  const e = game();
  const source = putBattlefield(e, 'player', 'vampire-nighthawk');
  const target = putBattlefield(e, 'ai', 'grizzly-bears');
  const beforeLife = e.state.players.player.life;
  e.dealDamageToPermanent(target, 1, source);
  assert.equal(e.state.players.player.life, beforeLife + 1, 'lifelink gains life from the shared damage event');
  assert.equal(target.deathtouchMarked, true);
  e.stateBasedActions();
  assert.equal(e.findPermanent(target.instanceId), null, 'deathtouch is consumed by the shared SBA path');

  const god = putBattlefield(e, 'ai', 'indestructible-god');
  assert.equal(e.destroy(god), false);
  assert.ok(e.findPermanent(god.instanceId));
});

test('Step 15: affinity is a reusable cost-reduction hook rather than card-specific logic', () => {
  const e = game();
  for (let i = 0; i < 3; i++) putBattlefield(e, 'player', 'arcane-signet');
  const card = { instanceId: 'step15-thought-monitor', cardId: 'arch-thought-monitor', owner: 'player', controller: 'player', zone: 'hand' };
  const cost = e.costs.determineSpellCost('player', card, { zone: 'hand' });
  assert.equal(cost.stages.mechanicReduction, 3);
  assert.equal(cost.finalManaCost, '{3}{U}');
});

test('Step 15: convoke, improvise, and delve expose shared legal payment-contribution candidates', () => {
  const e = game();
  addDefinition(e, 'step15-convoke', { typeLine: 'Sorcery', oracleText: 'Convoke', manaCost: '{4}{W}' });
  addDefinition(e, 'step15-improvise', { typeLine: 'Sorcery', oracleText: 'Improvise', manaCost: '{4}{B}' });
  addDefinition(e, 'step15-delve', { typeLine: 'Sorcery', oracleText: 'Delve', manaCost: '{5}{U}' });
  const creature = putBattlefield(e, 'player', 'grizzly-bears');
  const artifact = putBattlefield(e, 'player', 'arcane-signet');
  const graveCard = e.state.players.player.library[0];
  e._moveZoneNow(graveCard, 'graveyard', 'player');

  const convoke = e.mechanics.costPaymentContributions('player', e.db['step15-convoke']);
  const improvise = e.mechanics.costPaymentContributions('player', e.db['step15-improvise']);
  const delve = e.mechanics.costPaymentContributions('player', e.db['step15-delve']);
  assert.ok(convoke.convoke.some(item => item.permanentId === creature.instanceId));
  assert.ok(improvise.improvise.includes(artifact.instanceId));
  assert.ok(delve.delve.includes(graveCard.instanceId));
});

test('Step 15: prowess is generated by the mechanic library and resolves through the normal trigger stack', () => {
  const e = game();
  addDefinition(e, 'step15-prowess', { name: 'Reusable Prowess Creature', oracleText: 'Prowess', keywords: [] });
  addDefinition(e, 'step15-instant', { name: 'Test Instant', typeLine: 'Instant', oracleText: '', power: null, toughness: null });
  const prowess = putBattlefield(e, 'player', 'step15-prowess');
  e.emit(EVENT.SPELL_CAST, { controller: 'player', card: { instanceId: 'spell-1', cardId: 'step15-instant', controller: 'player', owner: 'player', zone: 'stack' } });
  const trigger = e.state.stack.at(-1);
  assert.equal(trigger?.effect?.type, 'mechanicProwess');
  e.resolution.resolveTop();
  assert.equal(prowess.modifiers.power, 1);
  assert.equal(prowess.modifiers.toughness, 1);
});

test('Step 15: exalted is generated once per exalted source and pumps the lone attacker through the trigger engine', () => {
  const e = game();
  addDefinition(e, 'step15-exalted', { name: 'Reusable Exalted Permanent', typeLine: 'Enchantment', oracleText: 'Exalted', power: null, toughness: null });
  const source = putBattlefield(e, 'player', 'step15-exalted');
  const attacker = putBattlefield(e, 'player', 'grizzly-bears', { attacking: true });
  assert.ok(source);
  e.emit(EVENT.DECLARE_ATTACKERS, { controller: 'player', attackers: [attacker.instanceId], attackTargets: { [attacker.instanceId]: 'ai' }, defendingPlayers: ['ai'] });
  assert.equal(e.state.stack.at(-1)?.effect?.type, 'mechanicExalted');
  e.resolution.resolveTop();
  assert.equal(attacker.modifiers.power, 1);
  assert.equal(attacker.modifiers.toughness, 1);
});

test('Step 15: myriad without a bespoke card callback receives the shared attack-trigger definition', () => {
  const e = game(4);
  addDefinition(e, 'step15-myriad', { name: 'Reusable Myriad Creature', oracleText: 'Myriad', keywords: [] });
  const source = putBattlefield(e, 'player', 'step15-myriad');
  const definitions = e.triggers.registry.cardDefinitionsFor(source);
  const myriad = definitions.find(definition => definition.metadata?.mechanic === 'myriad');
  assert.ok(myriad);
  assert.equal(myriad.effect.type, 'myriad');
  assert.deepEqual(myriad.eventPattern, [EVENT.CREATURE_ATTACKED]);
});

test('Step 15: investigate and populate use reusable token primitives', () => {
  const e = game();
  const before = e.state.players.player.battlefield.length;
  e.effects.resolve({ type: 'investigate', amount: 2 }, { controller: 'player', targets: [] });
  const clues = e.state.players.player.battlefield.filter(card => e.static.hasSubtype(card, 'Clue'));
  assert.equal(clues.length, 2);

  const [soldier] = e.effects.createTokenRaw('player', { name: 'Step15 Soldier', typeLine: 'Token Creature — Soldier', subtypes: ['Soldier'], power: 2, toughness: 2 }, 1);
  e.effects.resolve({ type: 'populate', tokenId: soldier.instanceId }, { controller: 'player', targets: [] });
  const soldiers = e.state.players.player.battlefield.filter(card => card.cardId === soldier.cardId);
  assert.equal(soldiers.length, 2);
  assert.ok(e.state.players.player.battlefield.length >= before + 4);
});

test('Step 15: devotion and domain are game-state mechanic values, not card-specific calculations', () => {
  const e = game();
  addDefinition(e, 'step15-blue-devotion', { manaCost: '{U}{U}', colors: ['U'] });
  putBattlefield(e, 'player', 'step15-blue-devotion');
  putBattlefield(e, 'player', 'island');
  putBattlefield(e, 'player', 'plains');
  assert.equal(e.mechanics.devotion('player', 'U') >= 2, true);
  assert.equal(e.static.devotion('player', 'U'), e.mechanics.devotion('player', 'U'));
  assert.equal(e.mechanics.domain('player') >= 2, true);
});

test('Step 15: recurring/casting/specialty mechanics are discoverable from Oracle text without editing core engine code', () => {
  const e = game();
  const examples = [
    ['new-cascade', 'Cascade', 'cascade'],
    ['new-foretell', 'Foretell {2}', 'foretell'],
    ['new-delve', 'Delve', 'delve'],
    ['new-storm', 'Storm', 'storm'],
    ['new-disguise', 'Disguise {3}', 'disguise'],
    ['new-scry', 'Scry 2.', 'scry']
  ];
  for (const [id, oracleText, expected] of examples) {
    const definition = addDefinition(e, id, { oracleText });
    assert.ok(e.mechanics.mechanicNamesFor(definition).includes(expected), `${oracleText} should recognize ${expected}`);
  }
});
