import test from 'node:test';
import assert from 'node:assert/strict';
import { engine, putBattlefield } from './helpers.js';
import { ENGINE_EVENT } from '../src/engine/events/EventTypes.js';
import { TokenRegistry } from '../src/engine/tokens/index.js';

function tokens(e, pid = 'player', name = null) {
  return e.state.players[pid].battlefield.filter(card => card.isToken && (!name || e.db[card.cardId]?.name === name));
}

test('Step 25: common registry exposes reusable utility, Incubator, and Role definitions', () => {
  const registry = new TokenRegistry();
  for (const name of ['Treasure','Clue','Food','Blood','Map','Powerstone','Incubator','Cursed Role','Monster Role','Royal Role','Sorcerer Role','Virtuous Role','Wicked Role','Young Hero Role']) {
    const definition = registry.get(name);
    assert.ok(definition, `${name} should be registered`);
    assert.equal(definition.isTokenDefinition, true);
  }
});

test('Step 25: common token definitions have reusable base characteristics and abilities', () => {
  const e = engine();
  const [treasure] = e.tokens.create('player', 'Treasure', 1);
  const def = e.db[treasure.cardId];
  assert.equal(def.name, 'Treasure');
  assert.match(def.typeLine, /Artifact.*Treasure/);
  assert.equal(def.abilities[0].type, 'mana');
  assert.equal(treasure.tokenDefinitionId, 'token:treasure');
  assert.equal(treasure.objectKind, 'token');
});

test('Step 25: every generated token receives distinct object and instance identities', () => {
  const e = engine();
  const created = e.tokens.create('player', 'Treasure', 3);
  assert.equal(created.length, 3);
  assert.equal(new Set(created.map(card => card.instanceId)).size, 3);
  assert.equal(new Set(created.map(card => card.gameObjectId)).size, 3);
  assert.ok(created.every(card => card.cardId === 'token:treasure'));
});

test('Step 25: CREATE_TOKEN records quantity, controller, source, and token definition', () => {
  const e = engine();
  const source = putBattlefield(e, 'player', 'grizzly-bears');
  e.tokens.create('player', 'Clue', 2, { source, cause: 'step25-source' });
  const row = e.getEventLogSnapshot().filter(item => item.type === ENGINE_EVENT.CREATE_TOKEN).at(-1);
  assert.equal(row.payload.playerId, 'player');
  assert.equal(row.payload.amount, 2);
  assert.equal(row.provenance.sourceObjectId, source.instanceId);
  assert.equal(row.provenance.cause, 'step25-source');
});

test('Step 25: token doublers still transform CREATE_TOKEN before commit', () => {
  const e = engine();
  e.replacements.register({ id:'step25-double', eventTypes:ENGINE_EVENT.CREATE_TOKEN, affectedPlayer:()=> 'player', metadata:{ effect:'double' }, transform:event => ({ ...event, payload:{ ...event.payload, amount:Number(event.payload.amount || 0) * 2 } }) });
  e.tokens.create('player', 'Treasure', 2);
  assert.equal(tokens(e, 'player', 'Treasure').length, 4);
});

test('Step 25: token replacement may change the generated token type without overwriting the common registry', () => {
  const e = engine();
  e.replacements.register({
    id:'step25-type-replace', eventTypes:ENGINE_EVENT.CREATE_TOKEN, affectedPlayer:()=> 'player',
    predicate:event => event.payload.tokenDefinition?.name === 'Treasure',
    transform:event => ({ ...event, payload:{ ...event.payload, tokenDefinition:{ ...event.payload.tokenDefinition, name:'Treasure Golem', typeLine:'Token Artifact Creature — Golem', types:['Artifact','Creature'], subtypes:['Golem'], power:2, toughness:2 } } })
  });
  const [created] = e.tokens.create('player', 'Treasure', 1);
  assert.notEqual(created.cardId, 'token:treasure');
  assert.equal(e.static.isType(created, 'Creature'), true);
  assert.equal(e.static.hasSubtype(created, 'Golem'), true);
  assert.equal(e.tokens.getDefinition('Treasure').id, 'token:treasure');
});

test('Step 25: Academy Manufactor-style replacement only expands Treasure, Food, or Clue', () => {
  const e = engine();
  e.replacements.register({ id:'step25-manufactor', eventTypes:ENGINE_EVENT.CREATE_TOKEN, affectedPlayer:()=> 'player', metadata:{ effect:'manufactor' }, transform:event => {
    const name = event.payload.tokenDefinition?.name;
    if (!['Treasure','Food','Clue'].includes(name)) return event;
    return { ...event, payload:{ ...event.payload, tokenBatches:['Treasure','Food','Clue'].map(tokenName => ({ amount:event.payload.amount, tokenDefinition:e.tokens.getDefinition(tokenName) })) } };
  }});
  e.tokens.create('player', 'Blood', 1);
  assert.equal(tokens(e, 'player', 'Blood').length, 1);
  e.tokens.create('player', 'Treasure', 1);
  assert.equal(tokens(e, 'player', 'Treasure').length, 1);
  assert.equal(tokens(e, 'player', 'Food').length, 1);
  assert.equal(tokens(e, 'player', 'Clue').length, 1);
});

test('Step 25: card-local custom tokens with the same name keep distinct rules identities', () => {
  const e = engine();
  const red = e.registerTokenDefinition({ name:'Elemental', typeLine:'Token Creature — Elemental', colors:['R'], power:3, toughness:1 }, { namespace:'card-red' });
  const blue = e.registerTokenDefinition({ name:'Elemental', typeLine:'Token Creature — Elemental', colors:['U'], power:1, toughness:3 }, { namespace:'card-blue' });
  assert.notEqual(red.id, blue.id);
  const [a] = e.tokens.create('player', red.id, 1);
  const [b] = e.tokens.create('player', blue.id, 1);
  assert.equal(e.db[a.cardId].power, 3);
  assert.equal(e.db[b.cardId].toughness, 3);
});

test('Step 25: token copies come from copiable values, not temporary buffs, counters, taps, or damage', () => {
  const e = engine();
  const source = putBattlefield(e, 'player', 'grizzly-bears', { tapped:true, damageMarked:1, counters:{ '+1/+1':4 }, modifiers:{ power:5, toughness:5, keywords:['flying'] } });
  const base = e.getDerivedStats(source);
  assert.ok(base.power > Number(e.db[source.cardId].power || 0));
  const [copy] = e.createTokenCopy('player', source, { amount:1 });
  const copyStats = e.getDerivedStats(copy);
  assert.equal(copyStats.power, Number(e.db[source.cardId].power));
  assert.equal(copyStats.toughness, Number(e.db[source.cardId].toughness));
  assert.equal(copy.tapped, false);
  assert.equal(copy.damageMarked, 0);
  assert.deepEqual(copy.counters, {});
  assert.equal(copyStats.keywords.includes('flying'), false);
  assert.equal(copy.copyMetadata.isTokenCopy, true);
});

test('Step 25: copy modifications become part of generated token copiable values', () => {
  const e = engine();
  const source = putBattlefield(e, 'player', 'grizzly-bears');
  const [copy] = e.createTokenCopy('player', source, { except:{ setPower:7, setToughness:7, addTypes:['Artifact'], addKeywords:['flying'] } });
  const stats = e.getDerivedStats(copy);
  assert.equal(stats.power, 7);
  assert.equal(stats.toughness, 7);
  assert.equal(e.static.isType(copy, 'Artifact'), true);
  assert.ok(stats.keywords.includes('flying'));
});

test('Step 25: identical copied values reuse a deterministic generated token definition', () => {
  const e = engine();
  const source = putBattlefield(e, 'player', 'grizzly-bears');
  const [a] = e.createTokenCopy('player', source, { amount:1 });
  const [b] = e.createTokenCopy('player', source, { amount:1 });
  assert.equal(a.cardId, b.cardId);
  assert.notEqual(a.instanceId, b.instanceId);
});

test('Step 25: Incubator tokens can enter with counters and transform while retaining them', () => {
  const e = engine();
  const [incubator] = e.tokens.create('player', 'Incubator', 1, { entryCounters:[{ type:'+1/+1', amount:3 }] });
  assert.equal(e.counters.count(incubator, '+1/+1'), 3);
  assert.equal(e.static.isType(incubator, 'Creature'), false);
  e.events.dispatch(ENGINE_EVENT.TRANSFORM, { permanentId:incubator.instanceId }, { cause:'step25-incubator-transform' });
  assert.equal(e.static.isType(incubator, 'Creature'), true);
  assert.equal(e.static.hasSubtype(incubator, 'Phyrexian'), true);
  const stats = e.getDerivedStats(incubator);
  assert.equal(stats.power, 3);
  assert.equal(stats.toughness, 3);
});

test('Step 25: Role tokens can be created attached and grant continuous bonuses', () => {
  const e = engine();
  const host = putBattlefield(e, 'player', 'grizzly-bears');
  const before = e.getDerivedStats(host);
  const [role] = e.tokens.create('player', 'Monster Role', 1, { attachTo:host });
  assert.equal(role.attachedTo, host.instanceId);
  const after = e.getDerivedStats(host);
  assert.equal(after.power, before.power + 1);
  assert.equal(after.toughness, before.toughness + 1);
  assert.ok(after.keywords.includes('trample'));
});

test('Step 25: Role uniqueness keeps only the newest Role controlled by the same player', () => {
  const e = engine();
  const host = putBattlefield(e, 'player', 'grizzly-bears');
  const [first] = e.tokens.create('player', 'Monster Role', 1, { attachTo:host });
  const [second] = e.tokens.create('player', 'Royal Role', 1, { attachTo:host });
  e.stateBasedActions();
  assert.equal(e.findPermanent(first.instanceId), null);
  assert.ok(e.findPermanent(second.instanceId));
  assert.equal(tokens(e).filter(card => e.static.hasSubtype(card, 'Role')).length, 1);
});

test('Step 25: unattached Aura tokens are removed by attachment SBAs and then cease to exist', () => {
  const e = engine();
  const [role] = e.tokens.create('player', 'Monster Role', 1);
  const id = role.instanceId;
  e.stateBasedActions();
  assert.equal(e._queryObject(id), null);
  assert.equal(e.state.players.player.graveyard.some(card => card.instanceId === id), false);
});

test('Step 25: tokens cannot persist in hand, library, graveyard, exile, or command', () => {
  for (const zone of ['hand','library','graveyard','exile','command']) {
    const e = engine();
    const [token] = e.tokens.create('player', 'Treasure', 1);
    const id = token.instanceId;
    e.moveToZone(token, zone, 'player', { reason:`step25-${zone}` });
    e.stateBasedActions();
    assert.equal(e._queryObject(id), null, `token should cease in ${zone}`);
    assert.equal(e.state.players.player[zone].some(card => card.instanceId === id), false);
  }
});

test('Step 25: token zone changes remain observable before the token ceases to exist', () => {
  const e = engine();
  const [token] = e.tokens.create('player', 'Treasure', 1);
  const id = token.instanceId;
  e.moveToZone(token, 'graveyard', 'player', { reason:'step25-observable-zone-change' });
  const move = e.getEventLogSnapshot().filter(row => row.type === ENGINE_EVENT.MOVE_ZONE && row.provenance.cause === 'step25-observable-zone-change').at(-1);
  assert.ok(move);
  e.stateBasedActions();
  assert.equal(e._queryObject(id), null);
});

test('Step 25: common token registry includes correct artifact/enchantment families', () => {
  const e = engine();
  const powerstone = e.tokens.getDefinition('Powerstone');
  const blood = e.tokens.getDefinition('Blood');
  const map = e.tokens.getDefinition('Map');
  const role = e.tokens.getDefinition('Royal Role');
  assert.equal(powerstone.abilities[0].spendRestriction, 'powerstone');
  assert.match(blood.oracleText, /Discard a card/);
  assert.equal(map.abilities[0].tap, true);
  assert.ok(role.subtypes.includes('Aura') && role.subtypes.includes('Role'));
});

test('Step 25: registry snapshot is exposed immutably through the public engine API', () => {
  const e = engine();
  const snapshot = e.getTokenRegistrySnapshot();
  assert.ok(snapshot.length >= 14);
  assert.throws(() => { snapshot[0].name = 'Changed'; }, TypeError);
  assert.notEqual(e.getTokenRegistrySnapshot()[0].name, 'Changed');
});
