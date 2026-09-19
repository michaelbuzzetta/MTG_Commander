import test from 'node:test';
import assert from 'node:assert/strict';
import { ENGINE_EVENT } from '../src/engine/events/index.js';
import { LAYER } from '../src/engine/continuous/index.js';
import { primitiveEngine, battlefieldCard, zoneOf } from './fixtures/primitive-fixtures.js';
import { db, decks, putBattlefield } from './helpers.js';
import { GameEngine } from '../src/engine/GameEngine.js';
import { EVENT } from '../src/engine/constants.js';

export const STEP34_INTERACTION_MATRIX = Object.freeze([
  'hexproof×targeting',
  'protection×damage',
  'protection×attachments',
  'indestructible×destroy',
  'replacement×commander-movement',
  'token-doubling×replacement',
  'counter-doubling×replacement',
  'trample×deathtouch',
  'first-strike×double-strike',
  'copy×layers',
  'ability-removal×static-effects',
  'control-change×attachments',
  'control-change×commander-ownership',
  'multiplayer×simultaneous-triggers',
  'multiplayer×player-elimination'
]);

function eventTypes(e) {
  return (e.getEventLog?.() || e.events?.getLog?.() || []).map(record => record.type);
}

test('Step 34 matrix declares every high-risk pair required by the workflow', () => {
  assert.equal(STEP34_INTERACTION_MATRIX.length, 15);
  for (const required of [
    'hexproof×targeting','protection×damage','protection×attachments','indestructible×destroy',
    'replacement×commander-movement','token-doubling×replacement','counter-doubling×replacement',
    'trample×deathtouch','first-strike×double-strike','copy×layers','ability-removal×static-effects',
    'control-change×attachments','control-change×commander-ownership','multiplayer×simultaneous-triggers','multiplayer×player-elimination'
  ]) assert.ok(STEP34_INTERACTION_MATRIX.includes(required), `missing ${required}`);
});

test('Step 34 — hexproof × targeting: opponent targeting is rejected while controller targeting remains legal', () => {
  const e = primitiveEngine();
  const target = battlefieldCard(e, 'ai', { id: 's34-hexproof', keywords: ['hexproof'] });
  const hostile = battlefieldCard(e, 'player', { id: 's34-hostile-source', typeLine: 'Creature — Wizard' });
  const friendly = battlefieldCard(e, 'ai', { id: 's34-friendly-source', typeLine: 'Creature — Wizard' });
  const spec = { kind: 'permanent', type: 'Creature' };
  assert.equal(e.targeting.isLegalTarget('player', target.instanceId, spec, { sourceObject: hostile }), false);
  assert.equal(e.targeting.isLegalTarget('ai', target.instanceId, spec, { sourceObject: friendly }), true);
});

test('Step 34 — protection × damage/attachments: matching protection prevents damage and makes attachment illegal', () => {
  const e = primitiveEngine();
  const redSource = battlefieldCard(e, 'player', { id: 's34-red-source', manaCost: '{R}', colors: ['R'], colorIdentity: ['R'] });
  const protectedCreature = battlefieldCard(e, 'ai', { id: 's34-protected', keywords: ['protection from red'], toughness: 5 });
  const aura = battlefieldCard(e, 'player', {
    id: 's34-red-aura', manaCost: '{R}', colors: ['R'], colorIdentity: ['R'], typeLine: 'Enchantment — Aura',
    oracleText: 'Enchant creature', subtypes: ['Aura']
  });
  const beforeDamage = protectedCreature.damageMarked;
  const result = e.dealDamageToPermanent(protectedCreature, 3, redSource);
  assert.equal(result.amount, 0);
  assert.equal(protectedCreature.damageMarked, beforeDamage);
  assert.equal(e.attachments.isLegalHost(aura, protectedCreature, { targeted: true, actorPlayerId: 'player' }), false);
});

test('Step 34 — indestructible × destroy: destroy fails but sacrifice still moves the same permanent', () => {
  const e = primitiveEngine();
  const god = battlefieldCard(e, 'player', { id: 's34-indestructible', keywords: ['indestructible'] });
  assert.equal(e.destroy(god), false);
  assert.equal(zoneOf(e, god), 'battlefield');
  e.sacrifice(god);
  assert.equal(zoneOf(e, god), 'graveyard');
});

test('Step 34 — replacement × commander movement: hand move pauses before mutation while graveyard move occurs before commander SBA choice', () => {
  const e = primitiveEngine();
  let commander = e.state.players.player.command[0];
  commander = e._moveZoneNow(commander, 'battlefield', 'player');
  const identity = commander.commanderIdentity;

  e.moveToZone(commander, 'hand', 'player');
  assert.equal(zoneOf(e, commander), 'battlefield');
  assert.equal(e.state.pendingChoice?.type, 'COMMANDER_ZONE');
  assert.equal(e.state.pendingChoice?.replacement, true);
  e._applyCommanderZoneChoice('player', false);
  commander = e.state.players.player.hand.find(card => card.isCommander);
  assert.equal(commander.commanderIdentity, identity);

  commander = e._moveZoneNow(commander, 'battlefield', 'player');
  e.toGraveyard(commander, true);
  assert.equal(e.state.players.player.graveyard.some(card => card.commanderIdentity === identity), true);
  e.stateBasedActions();
  assert.equal(e.state.pendingChoice?.replacement, false);
  e._applyCommanderZoneChoice('player', true);
  assert.equal(e.state.players.player.command.some(card => card.commanderIdentity === identity), true);
});

test('Step 34 — token/counter doubling × replacement: replacement pipeline doubles both event families exactly once', () => {
  const e = primitiveEngine();
  const creature = battlefieldCard(e, 'player', { id: 's34-counter-target' });
  e.replacements.register({
    id: 's34-double-tokens', eventTypes: ENGINE_EVENT.CREATE_TOKEN,
    affectedPlayer: () => 'player', predicate: event => event.payload.playerId === 'player',
    transform: event => ({ ...event, payload: { ...event.payload, amount: Number(event.payload.amount) * 2 } })
  });
  e.replacements.register({
    id: 's34-double-counters', eventTypes: ENGINE_EVENT.ADD_COUNTER,
    affectedPlayer: () => 'player', predicate: event => event.payload.objectId === creature.instanceId,
    transform: event => ({ ...event, payload: { ...event.payload, amount: Number(event.payload.amount) * 2 } })
  });
  const tokens = e.tokens.create('player', 'token:treasure', 2, { cause: 's34-token-double' });
  const counters = e.addCounters(creature, '+1/+1', 2, { playerId: 'player' });
  assert.equal(tokens.length, 4);
  assert.equal(counters, 4);
  assert.equal(e.counters.count(creature, '+1/+1'), 4);
});

test('Step 34 — trample × deathtouch: one damage is lethal assignment to a normal blocker and remainder can trample', () => {
  const e = primitiveEngine();
  const attacker = battlefieldCard(e, 'player', { id: 's34-trample-deathtouch', power: 5, toughness: 5, keywords: ['trample','deathtouch'] });
  const blocker = battlefieldCard(e, 'ai', { id: 's34-blocker', power: 2, toughness: 4 });
  assert.equal(e.mechanics.lethalDamageForBlocker(attacker, blocker), 1, 'deathtouch makes one point lethal for assignment');
  assert.equal(e.mechanics.hasTrample(attacker), true);
  assert.equal(e.static.derivedStats(attacker).power - e.mechanics.lethalDamageForBlocker(attacker, blocker), 4, 'four damage remains available to trample over');
});

test('Step 34 — first strike × double strike: double striker participates in both damage steps; first striker only the first', () => {
  const e = primitiveEngine();
  const first = battlefieldCard(e, 'player', { id: 's34-first', power: 2, toughness: 2, keywords: ['first strike'] });
  const double = battlefieldCard(e, 'player', { id: 's34-double', power: 2, toughness: 2, keywords: ['double strike'] });
  assert.equal(e.mechanics.participatesInCombatDamageStep(first, true), true);
  assert.equal(e.mechanics.participatesInCombatDamageStep(first, false), false);
  assert.equal(e.mechanics.participatesInCombatDamageStep(double, true), true);
  assert.equal(e.mechanics.participatesInCombatDamageStep(double, false), true);
  e.state.combat.attackers = [first.instanceId, double.instanceId];
  assert.equal(e.combat.needsFirstStrikeStep(), true);
});

test('Step 34 — copy × layers: copy gets copiable base values while later continuous effects still derive on top', () => {
  const e = primitiveEngine();
  const source = battlefieldCard(e, 'player', { id: 's34-copy-source', power: 4, toughness: 4, keywords: ['flying'] });
  const target = battlefieldCard(e, 'player', { id: 's34-copy-target', power: 1, toughness: 1 });
  e.copy.applyPermanentCopy(target, source);
  e.continuous.register({
    id: 's34-copy-layer-buff', layer: LAYER.PT_MODIFY, duration: 'custom',
    filter: ({ target: candidate }) => candidate.instanceId === target.instanceId,
    transform: { powerDelta: 2, toughnessDelta: 1 }
  });
  assert.equal(e.copy.getCopiableValues(target).power, 4);
  assert.equal(e.getDerivedStats(target).power, 6);
  assert.equal(e.getDerivedStats(target).toughness, 5);
});

test('Step 34 — ability removal × static/derived characteristics: removing abilities strips keywords without corrupting base definition', () => {
  const e = primitiveEngine();
  const source = battlefieldCard(e, 'player', { id: 's34-ability-source', keywords: ['flying','indestructible'] });
  assert.deepEqual(new Set(e.getDerivedStats(source).keywords), new Set(['flying','indestructible']));
  e.continuous.register({
    id: 's34-remove-abilities', layer: LAYER.ABILITY, duration: 'custom',
    filter: ({ target }) => target.instanceId === source.instanceId,
    transform: { removeAbilities: true }
  });
  assert.deepEqual(e.getDerivedStats(source).keywords, []);
  assert.deepEqual(new Set(e.db[source.cardId].keywords), new Set(['flying','indestructible']), 'base definition must remain intact');
});

test('Step 34 — control changes × attachments/commander ownership: relationships survive control change and ownership/commander identity do not change', () => {
  const e = primitiveEngine();
  let commander = e.state.players.player.command[0];
  commander = e._moveZoneNow(commander, 'battlefield', 'player');
  const identity = commander.commanderIdentity;
  const aura = battlefieldCard(e, 'player', { id: 's34-aura', typeLine: 'Enchantment — Aura', subtypes: ['Aura'], oracleText: 'Enchant creature' });
  e.attachPermanent(aura, commander, { reason: 's34-attach' });
  assert.equal(e.attachments.relationshipForAttached(aura)?.hostId, commander.instanceId);

  e.changeController(commander.instanceId, 'ai');
  commander = e.findPermanent(commander.instanceId);
  assert.equal(commander.controller, 'ai');
  assert.equal(commander.owner, 'player');
  assert.equal(commander.commanderIdentity, identity);
  assert.equal(e.attachments.relationshipForAttached(aura)?.hostId, commander.instanceId);
});

test('Step 34 — multiplayer simultaneous trigger ordering remains APNAP and stable', () => {
  const e = new GameEngine(decks[0], [decks[1], decks[2], decks[3]], db, { rng: () => 0.42 });
  e.start();
  e.state.pregame.active = false;
  e.state.gameBegun = true;
  e.state.phase = 'END_STEP';
  e.state.phaseIndex = 11;
  e.state.activePlayer = 'ai2';
  e.state.priorityPlayer = 'ai2';

  for (const pid of ['player','ai','ai2','ai3']) {
    const id = `s34-${pid}-watcher`;
    e._registerRuntimeCardDefinition(id, {
      id, name: id, typeLine: 'Enchantment', manaCost: '', manaValue: 0, keywords: [], subtypes: [], spellEffects: [],
      abilities: [{ type: 'triggered', event: EVENT.END_STEP, effect: { type: 'gainLife', amount: 1 } }]
    });
    putBattlefield(e, pid, id);
  }
  e.emit(EVENT.END_STEP, { controller: 'ai2' });
  assert.deepEqual(e.state.stack.map(item => item.controller), ['ai2','ai3','player','ai']);
  assert.equal(e.state.stack.at(-1).controller, 'ai', 'last stacked APNAP trigger resolves first');
});

test('Step 34 — multiplayer player elimination removes owned objects and does not leave eliminated player with priority', () => {
  const e = primitiveEngine();
  const owned = battlefieldCard(e, 'ai', { id: 's34-ai-owned' });
  e.state.priorityPlayer = 'ai';
  e.state.players.ai.life = 0;
  e.stateBasedActions();
  assert.equal(e.state.players.ai.lost, true);
  assert.notEqual(e.state.priorityPlayer, 'ai');
  assert.equal(e.findPermanent(owned.instanceId), null);
});
