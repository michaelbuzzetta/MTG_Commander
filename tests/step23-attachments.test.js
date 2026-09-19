import test from 'node:test';
import assert from 'node:assert/strict';
import { engine, setPhase } from './helpers.js';
import { makeCardInstance } from '../src/engine/GameState.js';
import { createStackObject } from '../src/engine/stack/index.js';
import { LAYER } from '../src/engine/continuous/index.js';
import { AIController } from '../src/ai/AIController.js';

function register(e, id, extra = {}) {
  return e._registerRuntimeCardDefinition(id, {
    id, name: id, typeLine: 'Creature — Test', manaCost: '{2}', manaValue: 2,
    colorIdentity: [], colors: [], subtypes: ['Test'], keywords: [], abilities: [],
    power: 2, toughness: 2, oracleText: 'Step 23 fixture.', supported: true,
    ...extra
  });
}

function permanent(e, pid, id, extra = {}) {
  const card = makeCardInstance(id, pid, 'battlefield', {
    tapped: false, summoningSick: false, counters: {}, damageMarked: 0,
    modifiers: { power: 0, toughness: 0, keywords: [] }, ...extra
  }, e.db[id]);
  e.zones.place(card, 'battlefield', pid);
  return card;
}

function cardInZone(e, pid, id, zone, extra = {}) {
  const card = makeCardInstance(id, pid, zone, extra, e.db[id]);
  e.zones.place(card, zone, pid);
  return card;
}

function equipmentDef(extra = {}) {
  return {
    typeLine: 'Artifact — Equipment', subtypes: ['Equipment'], power: null, toughness: null,
    oracleText: 'Equipped creature gets +2/+2.\nEquip {2}', equipCost: '{2}',
    abilities: [{ type: 'static', filter: { attachedToSource: true }, effect: { power: 2, toughness: 2 } }],
    ...extra
  };
}

function auraDef(extra = {}) {
  return {
    typeLine: 'Enchantment — Aura', subtypes: ['Aura'], power: null, toughness: null,
    oracleText: 'Enchant creature\nEnchanted creature gets +1/+1.',
    targets: { kind: 'permanent', type: 'Creature', minTargets: 1, maxTargets: 1 },
    abilities: [{ type: 'static', filter: { attachedToSource: true }, effect: { power: 1, toughness: 1 } }],
    ...extra
  };
}

function resolveTop(e) { return e.resolution.resolveTop(); }

test('Step 23: attachment relationships are first-class state with compatibility and UI metadata', () => {
  const e = engine();
  register(e, 's23-eq', equipmentDef());
  register(e, 's23-host', { power: 3, toughness: 3 });
  const eq = permanent(e, 'player', 's23-eq');
  const host = permanent(e, 'player', 's23-host');
  const relationship = e.attachPermanent(eq.instanceId, host.instanceId, { attachmentType: 'equipment', reason: 'test' });
  assert.equal(e.state.attachments.length, 1);
  assert.equal(relationship.attachedId, eq.instanceId);
  assert.equal(relationship.hostId, host.instanceId);
  assert.equal(eq.attachedTo, host.instanceId);
  assert.equal(e.getAttachmentUiMetadata()[0].legal, true);
});

test('Step 23: attach and detach are canonical engine events', () => {
  const e = engine();
  register(e, 's23-eq-events', equipmentDef());
  register(e, 's23-host-events');
  const eq = permanent(e, 'player', 's23-eq-events');
  const host = permanent(e, 'player', 's23-host-events');
  e.attachPermanent(eq, host, { attachmentType: 'equipment' });
  e.detachPermanent(eq, { reason: 'test-detach' });
  const committed = e.events.getLogSnapshot().filter(row => row.status === 'committed').map(row => row.type);
  assert.ok(committed.includes('ATTACH'));
  assert.ok(committed.includes('DETACH'));
  assert.equal(e.state.attachments.length, 0);
  assert.equal(eq.attachedTo, null);
});

test('Step 23: attachment-granted bonuses use continuous effects and vanish automatically on detach', () => {
  const e = engine();
  register(e, 's23-eq-bonus', equipmentDef());
  register(e, 's23-bonus-host', { power: 2, toughness: 2 });
  const eq = permanent(e, 'player', 's23-eq-bonus');
  const host = permanent(e, 'player', 's23-bonus-host');
  assert.equal(e.getDerivedStats(host).power, 2);
  e.attachPermanent(eq, host, { attachmentType: 'equipment' });
  assert.equal(e.getDerivedStats(host).power, 4);
  assert.equal(e.getDerivedStats(host).toughness, 4);
  e.detachPermanent(eq);
  assert.equal(e.getDerivedStats(host).power, 2);
  assert.equal(e.getDerivedStats(host).toughness, 2);
  assert.deepEqual(host.modifiers, { power: 0, toughness: 0, keywords: [] }, 'host is never permanently rewritten');
});

test('Step 23: Equipment detaches but remains on the battlefield when its host leaves', () => {
  const e = engine();
  register(e, 's23-eq-leave', equipmentDef());
  register(e, 's23-leave-host');
  const eq = permanent(e, 'player', 's23-eq-leave');
  const host = permanent(e, 'player', 's23-leave-host');
  e.attachPermanent(eq, host, { attachmentType: 'equipment' });
  e._moveZoneNow(host, 'graveyard', host.owner);
  assert.ok(e.findPermanent(eq.instanceId));
  assert.equal(e.attachments.isAttached(eq), false);
  assert.equal(eq.attachedTo, null);
});

test('Step 23: an Aura whose host leaves is put into its owner graveyard by SBAs', () => {
  const e = engine();
  register(e, 's23-aura-leave', auraDef());
  register(e, 's23-aura-host');
  const aura = permanent(e, 'player', 's23-aura-leave');
  const host = permanent(e, 'player', 's23-aura-host');
  e.attachPermanent(aura, host, { attachmentType: 'aura' });
  e._moveZoneNow(host, 'graveyard', host.owner);
  e.stateBasedActions();
  assert.equal(e.findPermanent(aura.instanceId), null);
  assert.ok(e.state.players.player.graveyard.some(card => card.instanceId === aura.instanceId));
});

test('Step 23: an unattached Aura on the battlefield is illegal and goes to graveyard', () => {
  const e = engine();
  register(e, 's23-aura-unattached', auraDef());
  const aura = permanent(e, 'player', 's23-aura-unattached');
  e.stateBasedActions();
  assert.equal(e.findPermanent(aura.instanceId), null);
  assert.ok(e.state.players.player.graveyard.some(card => card.instanceId === aura.instanceId));
});

test('Step 23: host type changes are re-evaluated for Equipment and Aura attachment legality', () => {
  const e = engine();
  register(e, 's23-type-eq', equipmentDef());
  register(e, 's23-type-aura', auraDef());
  register(e, 's23-type-host', { power: 2, toughness: 2 });
  const eq = permanent(e, 'player', 's23-type-eq');
  const aura = permanent(e, 'player', 's23-type-aura');
  const hostA = permanent(e, 'player', 's23-type-host');
  const hostB = permanent(e, 'player', 's23-type-host');
  e.attachPermanent(eq, hostA, { attachmentType: 'equipment' });
  e.attachPermanent(aura, hostB, { attachmentType: 'aura' });
  e.continuous.register({ id: 's23-remove-creature', layer: LAYER.TYPE, duration: 'custom', filter: ({ target }) => [hostA.instanceId, hostB.instanceId].includes(target.instanceId), transform: { removeType: 'Creature' } });
  e.stateBasedActions();
  assert.equal(e.attachments.isAttached(eq), false);
  assert.ok(e.findPermanent(eq.instanceId));
  assert.equal(e.findPermanent(aura.instanceId), null);
});

test('Step 23: control-sensitive Aura legality recalculates after control changes', () => {
  const e = engine();
  register(e, 's23-control-aura', auraDef({ oracleText: 'Enchant creature you control\nEnchanted creature gets +1/+1.' }));
  register(e, 's23-control-host');
  const aura = permanent(e, 'player', 's23-control-aura');
  const host = permanent(e, 'player', 's23-control-host');
  e.attachPermanent(aura, host, { attachmentType: 'aura' });
  e.changeController(host.instanceId, 'ai');
  e.stateBasedActions();
  assert.equal(e.findPermanent(aura.instanceId), null);
});

test('Step 23: protection invalidates attachments, while shroud alone does not make an existing Aura fall off', () => {
  const e = engine();
  register(e, 's23-red-aura', auraDef({ manaCost: '{R}', colors: ['R'], colorIdentity: ['R'] }));
  register(e, 's23-protected-host', { keywords: ['protection from red'] });
  register(e, 's23-shroud-host', { keywords: ['shroud'] });
  const auraA = permanent(e, 'player', 's23-red-aura');
  const auraB = permanent(e, 'player', 's23-red-aura');
  const protectedHost = permanent(e, 'player', 's23-protected-host');
  const shroudHost = permanent(e, 'player', 's23-shroud-host');
  assert.throws(() => e.attachPermanent(auraA, protectedHost, { attachmentType: 'aura' }), /Illegal attachment host/);
  e.attachPermanent(auraB, shroudHost, { attachmentType: 'aura' });
  e.stateBasedActions();
  assert.ok(e.findPermanent(auraB.instanceId));
  assert.equal(e.attachments.isAttached(auraB), true);
});

test('Step 23: Equip is exposed as a normal sorcery-speed activated ability with real cost/targeting/stack resolution', () => {
  const e = engine();
  register(e, 's23-equip-action', equipmentDef());
  register(e, 's23-equip-target');
  const eq = permanent(e, 'player', 's23-equip-action');
  const host = permanent(e, 'player', 's23-equip-target');
  setPhase(e, 'PRECOMBAT_MAIN', { activePlayer: 'player', priorityPlayer: 'player' });
  e.state.players.player.manaPool.C = 2;
  const action = e.getLegalActions('player').find(row => row.type === 'ACTIVATE_ABILITY' && row.permanentId === eq.instanceId && row.ability?.attachmentAction === 'equip' && row.targets?.[0] === host.instanceId);
  assert.ok(action, 'equip action should be generated by authoritative legal actions');
  e.perform('player', action);
  assert.equal(e.state.players.player.manaPool.C, 0);
  assert.equal(e.state.stack.at(-1)?.ability?.attachmentAction, 'equip');
  resolveTop(e);
  assert.equal(e.attachments.relationshipForAttached(eq)?.hostId, host.instanceId);
});

test('Step 23: Equip cannot be activated at instant timing and respects target protection', () => {
  const e = engine();
  register(e, 's23-equip-timing', equipmentDef({ manaCost: '{1}', colors: [] }));
  register(e, 's23-equip-protected', { keywords: ['protection from artifacts'] });
  const eq = permanent(e, 'player', 's23-equip-timing');
  const host = permanent(e, 'player', 's23-equip-protected');
  e.state.players.player.manaPool.C = 10;
  const ability = e.static.effectiveAbilities(eq).find(row => row.attachmentAction === 'equip');
  setPhase(e, 'UPKEEP', { activePlayer: 'player', priorityPlayer: 'player' });
  assert.equal(e.isActionLegal('player', { type: 'ACTIVATE_ABILITY', permanentId: eq.instanceId, ability, targets: [host.instanceId] }), false);
  setPhase(e, 'PRECOMBAT_MAIN', { activePlayer: 'player', priorityPlayer: 'player' });
  assert.equal(e.isActionLegal('player', { type: 'ACTIVATE_ABILITY', permanentId: eq.instanceId, ability, targets: [host.instanceId] }), false);
});

test('Step 23: Fortify actions target lands you control and not creatures', () => {
  const e = engine();
  register(e, 's23-fort', { typeLine: 'Artifact — Fortification', subtypes: ['Fortification'], power: null, toughness: null, fortifyCost: '{1}', oracleText: 'Fortify {1}' });
  register(e, 's23-land', { typeLine: 'Land', subtypes: [], power: null, toughness: null });
  register(e, 's23-creature');
  const fort = permanent(e, 'player', 's23-fort');
  const land = permanent(e, 'player', 's23-land');
  const creature = permanent(e, 'player', 's23-creature');
  const ability = e.static.effectiveAbilities(fort).find(row => row.attachmentAction === 'fortify');
  e.state.players.player.manaPool.C = 2;
  setPhase(e, 'PRECOMBAT_MAIN', { activePlayer: 'player', priorityPlayer: 'player' });
  assert.equal(e.isActionLegal('player', { type: 'ACTIVATE_ABILITY', permanentId: fort.instanceId, ability, targets: [land.instanceId] }), true);
  assert.equal(e.isActionLegal('player', { type: 'ACTIVATE_ABILITY', permanentId: fort.instanceId, ability, targets: [creature.instanceId] }), false);
});

test('Step 23: Reconfigure removes creature type while attached and restores it after its detach mode resolves', () => {
  const e = engine();
  register(e, 's23-reconfigure', { typeLine: 'Artifact Creature — Equipment Construct', subtypes: ['Equipment','Construct'], power: 2, toughness: 2, reconfigureCost: '{1}', oracleText: 'Reconfigure {1}' });
  register(e, 's23-reconfigure-host');
  const source = permanent(e, 'player', 's23-reconfigure');
  const host = permanent(e, 'player', 's23-reconfigure-host');
  setPhase(e, 'PRECOMBAT_MAIN', { activePlayer: 'player', priorityPlayer: 'player' });
  e.state.players.player.manaPool.C = 4;
  const attachAbility = e.static.effectiveAbilities(source).find(row => row.attachmentAction === 'reconfigure-attach');
  e.perform('player', { type: 'ACTIVATE_ABILITY', permanentId: source.instanceId, ability: attachAbility, targets: [host.instanceId] });
  resolveTop(e);
  assert.equal(e.static.isType(source, 'Creature'), false);
  const detachAbility = e.static.effectiveAbilities(source).find(row => row.attachmentAction === 'reconfigure-detach');
  assert.ok(detachAbility);
  e.state.priorityPlayer = 'player';
  e.state.players.player.manaPool.C = 2;
  e.perform('player', { type: 'ACTIVATE_ABILITY', permanentId: source.instanceId, ability: detachAbility, targets: [] });
  resolveTop(e);
  assert.equal(e.attachments.isAttached(source), false);
  assert.equal(e.static.isType(source, 'Creature'), true);
});

test('Step 23: an Aura spell attaches through ATTACH as it resolves and gets its continuous bonus', () => {
  const e = engine();
  register(e, 's23-cast-aura', auraDef());
  register(e, 's23-cast-host', { power: 2, toughness: 2 });
  const host = permanent(e, 'player', 's23-cast-host');
  const aura = makeCardInstance('s23-cast-aura', 'player', 'stack', {}, e.db['s23-cast-aura']);
  const item = createStackObject({ type: 'spell', controller: 'player', card: aura, targets: [host.instanceId] });
  e.state.stack.push(item);
  resolveTop(e);
  assert.ok(e.findPermanent(aura.instanceId));
  assert.equal(e.attachments.relationshipForAttached(aura)?.hostId, host.instanceId);
  assert.equal(e.getDerivedStats(host).power, 3);
  assert.ok(e.events.getLogSnapshot().some(row => row.type === 'ATTACH' && row.status === 'committed'));
});



test('Step 23: Oracle-only Aura definitions synthesize their Enchant clause as spell targeting', () => {
  const e = engine();
  register(e, 's23-oracle-aura', auraDef({
    oracleText: 'Enchant opponent\nAt the beginning of enchanted opponent\'s end step, draw a card.',
    targets: undefined,
    manaCost: '{1}{W}',
    abilities: []
  }));
  const aura = cardInZone(e, 'player', 's23-oracle-aura', 'hand');
  setPhase(e, 'PRECOMBAT_MAIN', { activePlayer: 'player', priorityPlayer: 'player' });
  e.state.players.player.manaPool.W = 1;
  e.state.players.player.manaPool.C = 1;
  assert.equal(e.isActionLegal('player', { type: 'CAST_SPELL', cardInstanceId: aura.instanceId, targets: [] }), false);
  const cast = { type: 'CAST_SPELL', cardInstanceId: aura.instanceId, targets: ['ai'] };
  assert.equal(e.isActionLegal('player', cast), true);
  e.perform('player', cast);
  resolveTop(e);
  const resolved = e.findPermanent(aura.instanceId);
  assert.ok(resolved);
  assert.equal(e.attachments.relationshipForAttached(resolved)?.hostId, 'ai');
});

test('Step 23: an Aura entering without being cast waits for a non-targeting legal-host choice', () => {
  const e = engine();
  register(e, 's23-entry-aura', auraDef());
  register(e, 's23-entry-host');
  const aura = cardInZone(e, 'player', 's23-entry-aura', 'hand');
  const host = permanent(e, 'player', 's23-entry-host');
  e._moveZoneNow(aura, 'battlefield', 'player', { reason: 'put-onto-battlefield' });
  assert.equal(e.state.pendingChoice?.type, 'ATTACHMENT_ENTRY');
  assert.ok(e.state.pendingChoice.candidateIds.includes(host.instanceId));
  assert.ok(e.state.players.player.hand.some(card => card.instanceId === aura.instanceId), 'Aura has not entered before its as-enters choice');
  e.perform('player', { type: 'CHOOSE_ATTACHMENT_HOST', hostId: host.instanceId });
  assert.ok(e.findPermanent(aura.instanceId));
  assert.equal(e.attachments.relationshipForAttached(aura)?.hostId, host.instanceId);
});

test('Step 23: Auras that enchant players use the same generic relationship model', () => {
  const e = engine();
  register(e, 's23-player-aura', auraDef({ oracleText: 'Enchant player', targets: { kind: 'player', minTargets: 1, maxTargets: 1 }, abilities: [] }));
  const aura = permanent(e, 'player', 's23-player-aura');
  e.attachPermanent(aura, 'ai', { attachmentType: 'aura' });
  const relationship = e.attachments.relationshipForAttached(aura);
  assert.equal(relationship.hostKind, 'player');
  assert.equal(relationship.hostId, 'ai');
  e.stateBasedActions();
  assert.ok(e.findPermanent(aura.instanceId));
});

test('Step 23: attachment state hydrates legacy attachedTo without making UI state authoritative', () => {
  const e = engine();
  register(e, 's23-legacy-eq', equipmentDef());
  register(e, 's23-legacy-host');
  const eq = permanent(e, 'player', 's23-legacy-eq');
  const host = permanent(e, 'player', 's23-legacy-host');
  eq.attachedTo = host.instanceId;
  e.state.attachments = [];
  e.attachments.reconcileLegacyAttachments();
  assert.equal(e.state.attachments.length, 1);
  const ui = e.getAttachmentUiMetadata();
  assert.equal(ui[0].attachedId, eq.instanceId);
  assert.equal(ui[0].hostId, host.instanceId);
  assert.equal(ui[0].legal, true);
});


test('Step 23: AI does not repeatedly activate a zero-value attachment action onto the current host', () => {
  const e = engine();
  register(e, 's23-ai-eq', equipmentDef({ equipCost: '{0}', oracleText: 'Equip {0}' }));
  register(e, 's23-ai-host');
  const eq = permanent(e, 'player', 's23-ai-eq');
  const host = permanent(e, 'player', 's23-ai-host');
  e.attachPermanent(eq, host, { attachmentType: 'equipment' });
  setPhase(e, 'PRECOMBAT_MAIN', { activePlayer: 'player', priorityPlayer: 'player' });
  const ability = e.static.effectiveAbilities(eq).find(row => row.attachmentAction === 'equip');
  const action = { type: 'ACTIVATE_ABILITY', permanentId: eq.instanceId, ability, targets: [host.instanceId], selections: [] };
  assert.equal(e.isActionLegal('player', action), true, 'the no-op re-equip remains rules-legal');
  const ai = new AIController(e, 'player');
  ai._refreshView();
  assert.equal(ai.abilityScore(action), -Infinity, 'AI strategy must not loop on a legal no-op reattachment');
});


test('Step 23: AI attachment strategy does not ping-pong between equal or weaker hosts', () => {
  const e = engine();
  register(e, 's23-ai-pingpong-eq', equipmentDef({ equipCost: '{0}', oracleText: 'Equip {0}' }));
  register(e, 's23-ai-strong-host', { power: 5, toughness: 5 });
  register(e, 's23-ai-weak-host', { power: 2, toughness: 2 });
  const eq = permanent(e, 'player', 's23-ai-pingpong-eq');
  const strong = permanent(e, 'player', 's23-ai-strong-host');
  const weak = permanent(e, 'player', 's23-ai-weak-host');
  e.attachPermanent(eq, strong, { attachmentType: 'equipment' });
  setPhase(e, 'PRECOMBAT_MAIN', { activePlayer: 'player', priorityPlayer: 'player' });
  const ability = e.static.effectiveAbilities(eq).find(row => row.attachmentAction === 'equip');
  const moveToWeak = { type: 'ACTIVATE_ABILITY', permanentId: eq.instanceId, ability, targets: [weak.instanceId], selections: [] };
  assert.equal(e.isActionLegal('player', moveToWeak), true, 'moving to the weaker host remains rules-legal');
  const ai = new AIController(e, 'player');
  ai._refreshView();
  assert.equal(ai.abilityScore(moveToWeak), -Infinity, 'AI must not oscillate an attachment onto an equal/weaker host');
});
