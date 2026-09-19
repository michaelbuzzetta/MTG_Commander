import assert from 'node:assert/strict';
import { EVENT } from '../../src/engine/constants.js';
import { ENGINE_EVENT } from '../../src/engine/events/index.js';
import { LAYER } from '../../src/engine/continuous/index.js';

function cardZone(e, ref) {
  return e.zones.find(typeof ref === 'string' ? ref : ref?.instanceId)?.zone || null;
}

function defineDiesCreature(h, id) {
  return h.defineCard(id, {
    typeLine: 'Creature — Spirit',
    power: 2,
    toughness: 2,
    abilities: [{
      type: 'triggered',
      event: EVENT.CREATURE_DIED,
      condition: { sourceEvent: true },
      effect: { type: 'gainLife', amount: 1 }
    }]
  });
}

function defineEndStepWatcher(h, id) {
  return h.defineCard(id, {
    typeLine: 'Enchantment',
    power: null,
    toughness: null,
    abilities: [{ type: 'triggered', event: EVENT.END_STEP, effect: { type: 'gainLife', amount: 1 } }]
  });
}

export const STEP36_IMPLEMENTATIONS = Object.freeze({
  'J36-LAYERS-DEPENDENCY-001': (h) => {
    const e = h.createEngine({ invariantChecks: false });
    h.setPhase('PRECOMBAT_MAIN');
    const target = h.permanent('player', 'j36-layer-target', {
      typeLine: 'Artifact', subtypes: [], keywords: ['flying'], power: 4, toughness: 4
    });

    e.continuous.register({
      id: 'type-maker', layer: LAYER.TYPE, duration: 'custom',
      filter: ({ target: candidate }) => candidate.instanceId === target.instanceId,
      transform: { addTypes: ['Creature'], addSubtypes: ['Construct'] }
    });
    e.continuous.register({
      id: 'type-dependent', layer: LAYER.TYPE, dependsOn: ['type-maker'], duration: 'custom',
      filter: ({ target: candidate, characteristics }) => candidate.instanceId === target.instanceId && characteristics.types.includes('Creature'),
      transform: { addSubtypes: ['JudgeMarked'] }
    });
    e.continuous.register({
      id: 'ability-strip', layer: LAYER.ABILITY, duration: 'custom',
      filter: ({ target: candidate }) => candidate.instanceId === target.instanceId,
      transform: { removeAbilities: true }
    });
    e.continuous.register({
      id: 'pt-set', layer: LAYER.PT_SET, duration: 'custom',
      filter: ({ target: candidate }) => candidate.instanceId === target.instanceId,
      transform: { setPower: 1, setToughness: 1 }
    });
    e.continuous.register({
      id: 'pt-modify', layer: LAYER.PT_MODIFY, duration: 'custom',
      filter: ({ target: candidate }) => candidate.instanceId === target.instanceId,
      transform: { powerDelta: 2, toughnessDelta: 3 }
    });

    const chars = e.continuous.characteristics(target, { trace: true });
    assert.ok(chars.types.includes('Creature'));
    assert.ok(chars.subtypes.includes('JudgeMarked'), 'dependent type effect must see the prior same-layer effect');
    assert.deepEqual(chars.keywords, [], 'ability layer strips printed flying');
    assert.equal(chars.power, 3);
    assert.equal(chars.toughness, 4);
    assert.ok(chars.appliedEffects.indexOf('type-maker') < chars.appliedEffects.indexOf('type-dependent'));
    assert.ok(chars.appliedEffects.indexOf('type-dependent') < chars.appliedEffects.indexOf('ability-strip'));
    assert.ok(chars.appliedEffects.indexOf('pt-set') < chars.appliedEffects.indexOf('pt-modify'));
    assert.deepEqual(e.db['j36-layer-target'].keywords, ['flying'], 'base characteristics must not be overwritten');
    assert.equal(e.db['j36-layer-target'].power, 4);
    for (const id of ['type-maker','type-dependent','ability-strip','pt-set','pt-modify']) h.trace(id);
  },

  'J36-REPLACEMENTS-ORDER-002': (h) => {
    const e = h.createEngine({ invariantChecks: false });
    const before = e.state.players.player.life;
    e.replacements.register({
      id: 'judge-add-one', eventTypes: ENGINE_EVENT.GAIN_LIFE, affectedPlayer: () => 'player', metadata: { effect: 'addOne' },
      transform: event => ({ ...event, payload: { ...event.payload, amount: Number(event.payload.amount) + 1 } })
    });
    e.replacements.register({
      id: 'judge-double', eventTypes: ENGINE_EVENT.GAIN_LIFE, affectedPlayer: () => 'player', metadata: { effect: 'double' },
      transform: event => ({ ...event, payload: { ...event.payload, amount: Number(event.payload.amount) * 2 } })
    });
    const deferred = e.replacements.dispatchWithChoice(ENGINE_EVENT.GAIN_LIFE, { playerId: 'player', amount: 1 }, { affectedPlayerId: 'player', cause: 'judge-scenario' });
    assert.equal(deferred.deferred, true);
    assert.equal(e.state.players.player.life, before, 'replacement ordering choice occurs before mutation');
    assert.equal(e.state.pendingChoice?.type, 'REPLACEMENT_ORDER');
    h.trace('choice:REPLACEMENT_ORDER');
    e.perform('player', { type: 'ORDER_REPLACEMENTS', replacementIds: ['judge-add-one', 'judge-double'] });
    assert.equal(e.state.players.player.life, before + 4);
    const record = e.getEventLogSnapshot().filter(row => row.type === ENGINE_EVENT.GAIN_LIFE).at(-1);
    assert.deepEqual(record.replacementTrace.map(row => row.replacementId), ['judge-add-one','judge-double']);
    h.trace('replacement:judge-add-one'); h.trace('replacement:judge-double'); h.trace('life:+4');
  },

  'J36-SIMULTANEOUS-DEATHS-003': (h) => {
    const e = h.createEngine({ invariantChecks: false });
    defineDiesCreature(h, 'j36-dies-a');
    defineDiesCreature(h, 'j36-dies-b');
    const a = h.permanent('player', 'j36-dies-a', e.db['j36-dies-a']);
    const b = h.permanent('ai', 'j36-dies-b', e.db['j36-dies-b']);
    const sourceA = h.permanent('player', 'j36-damage-source-a', { power: 1, toughness: 3 });
    const sourceB = h.permanent('ai', 'j36-damage-source-b', { power: 1, toughness: 3 });
    const result = e.dealDamageBatch([
      { targetId: a.instanceId, amount: 2, source: sourceB },
      { targetId: b.instanceId, amount: 2, source: sourceA }
    ], { stabilize: true, cause: 'judge-simultaneous-deaths' });
    const rows = e.getEventLogSnapshot().filter(row => row.type === ENGINE_EVENT.DEAL_DAMAGE && row.payload.batchId === result.batchId);
    assert.equal(rows.length, 2);
    assert.equal(cardZone(e, a), 'graveyard');
    assert.equal(cardZone(e, b), 'graveyard');
    const sbaBatch = e.state.history.filter(row => row.type === 'SBA_BATCH').at(-1);
    assert.equal(sbaBatch.actions.filter(action => action.reason === 'lethal-damage').length, 2);
    assert.equal(e.state.stack.filter(item => item.type === 'trigger').length, 2, 'both dies triggers should exist before priority resumes');
    h.trace('damage-batch:2'); h.trace('sba:lethal-damage:2'); h.trace('triggers:2');
  },

  'J36-APNAP-004': (h) => {
    const e = h.createEngine({ players: 4, invariantChecks: false });
    for (const pid of ['player','ai','ai2','ai3']) {
      const id = `j36-apnap-${pid}`;
      defineEndStepWatcher(h, id);
      h.permanent(pid, id, e.db[id]);
    }
    h.setPhase('END_STEP', { activePlayer: 'ai2', priorityPlayer: 'ai2' });
    e.emit(EVENT.END_STEP, { controller: 'ai2' });
    const order = e.state.stack.map(item => item.controller);
    assert.deepEqual(order, ['ai2','ai3','player','ai']);
    assert.equal(e.state.stack.at(-1).controller, 'ai');
    order.forEach(pid => h.trace(pid));
  },

  'J36-PLAYER-ELIMINATION-005': (h) => {
    const e = h.createEngine({ players: 4, invariantChecks: false });
    const stolen = h.permanent('player', 'j36-survivor-owned-stolen');
    e.changeController(stolen.instanceId, 'ai');
    const residual = h.permanent('player', 'j36-residual-control');
    e.zones.transferBattlefieldControl(residual.instanceId, 'ai');
    residual.controller = 'ai'; residual.controlHistory = [];
    const leavingOwnerCard = h.permanent('ai', 'j36-doomed-owned');
    e.changeController(leavingOwnerCard.instanceId, 'player');
    e.stack.push({ id: 'j36-eliminated-ability', type: 'ability', controller: 'ai', source: leavingOwnerCard, effect: { type: 'draw', amount: 1 } });
    e.state.pendingTriggers.push({ id: 'j36-lost-trigger', controller: 'ai' }, { id: 'j36-live-trigger', controller: 'ai2' });
    e.state.pendingChoice = { type: 'TEST', playerId: 'ai' };
    e.state.extraTurnQueue = ['ai','ai2']; e.state.extraTurns.ai = 1;
    e.state.combat.defendingPlayers = ['ai','ai2']; e.state.combat.blockerQueue = ['ai','ai2']; e.state.combat.currentDefender = 'ai';
    e.elimination.eliminate('ai', { reason: 'judge-scenario' });
    assert.equal(e.state.players.ai.lost, true);
    assert.equal(e.findPermanent(leavingOwnerCard.instanceId), null);
    assert.equal(e.findPermanent(stolen.instanceId)?.controller, 'player');
    assert.ok(e.state.players.player.exile.some(card => card.instanceId === residual.instanceId));
    assert.equal(e.state.stack.some(item => item.id === 'j36-eliminated-ability'), false);
    assert.deepEqual(e.state.pendingTriggers.map(trigger => trigger.id), ['j36-live-trigger']);
    assert.equal(e.state.pendingChoice, null);
    assert.deepEqual(e.state.extraTurnQueue, ['ai2']);
    assert.deepEqual(e.state.combat.defendingPlayers, ['ai2']);
    assert.equal(e.nextPlayer('player'), 'ai2');
    h.trace('owned-objects-removed'); h.trace('control-restored-or-cleaned'); h.trace('stack-cleaned'); h.trace('turn-order-cleaned');
  },

  'J36-CONTROL-ATTACHMENT-006': (h) => {
    const e = h.createEngine({ invariantChecks: false });
    const aura = h.permanent('player', 'j36-control-aura', {
      typeLine: 'Enchantment — Aura', subtypes: ['Aura'], power: null, toughness: null,
      oracleText: 'Enchant creature you control\nEnchanted creature gets +1/+1.',
      targets: { kind: 'permanent', type: 'Creature', minTargets: 1, maxTargets: 1 },
      abilities: [{ type: 'static', filter: { attachedToSource: true }, effect: { power: 1, toughness: 1 } }]
    });
    const host = h.permanent('player', 'j36-control-host');
    e.attachPermanent(aura, host, { attachmentType: 'aura', reason: 'judge-setup' });
    assert.equal(e.attachments.isAttached(aura), true);
    e.changeController(host.instanceId, 'ai');
    e.stateBasedActions();
    assert.equal(e.findPermanent(aura.instanceId), null, 'Aura becomes illegal after host control changes');
    assert.ok(e.state.players.player.graveyard.some(card => card.instanceId === aura.instanceId));
    assert.equal(e.findPermanent(host.instanceId)?.controller, 'ai');
  },

  'J36-COMMANDER-MOVE-007': (h) => {
    const e = h.createEngine({ invariantChecks: false });
    let commander = e._moveZoneNow(e.state.players.player.command[0], 'battlefield', 'player');
    const identity = commander.commanderIdentity;
    e.moveToZone(commander, 'hand', 'player');
    assert.equal(cardZone(e, commander), 'battlefield');
    assert.equal(e.state.pendingChoice?.type, 'COMMANDER_ZONE');
    assert.equal(e.state.pendingChoice?.replacement, true);
    h.trace('choice:replacement-before-hand');
    e.perform('player', { type: 'CHOOSE_COMMANDER_ZONE', moveToCommand: false });
    commander = e.state.players.player.hand.find(card => card.commanderIdentity === identity);
    assert.ok(commander);
    commander = e._moveZoneNow(commander, 'battlefield', 'player');
    e.toGraveyard(commander, true);
    commander = e.state.players.player.graveyard.find(card => card.commanderIdentity === identity);
    assert.ok(commander);
    h.trace('move:graveyard');
    e.stateBasedActions();
    assert.equal(e.state.pendingChoice?.type, 'COMMANDER_ZONE');
    assert.equal(e.state.pendingChoice?.replacement, false);
    h.trace('choice:sba-after-graveyard');
    e.perform('player', { type: 'CHOOSE_COMMANDER_ZONE', moveToCommand: true });
    assert.ok(e.state.players.player.command.some(card => card.commanderIdentity === identity));
    h.trace('move:command');
  },

  'J36-COPY-LAYERS-008': (h) => {
    const e = h.createEngine({ invariantChecks: false });
    const source = h.permanent('player', 'j36-copy-source', { power: 4, toughness: 4, keywords: ['flying'], typeLine: 'Creature — Bird' });
    const target = h.permanent('player', 'j36-copy-target', { power: 1, toughness: 1, typeLine: 'Creature — Shapeshifter' });
    e.copy.applyPermanentCopy(target, source);
    h.trace('copy');
    e.continuous.register({
      id: 'j36-copy-type-change', layer: LAYER.TYPE, duration: 'custom',
      filter: ({ target: candidate }) => candidate.instanceId === target.instanceId,
      transform: { addTypes: ['Artifact'], addSubtypes: ['Construct'] }
    });
    e.continuous.register({
      id: 'j36-copy-ability-remove', layer: LAYER.ABILITY, duration: 'custom',
      filter: ({ target: candidate }) => candidate.instanceId === target.instanceId,
      transform: { removeAbilities: true }
    });
    const copyValues = e.copy.getCopiableValues(target);
    const chars = e.continuous.characteristics(target, { trace: true });
    assert.equal(copyValues.power, 4);
    assert.equal(copyValues.toughness, 4);
    assert.ok(copyValues.keywords.includes('flying'));
    assert.ok(chars.types.includes('Artifact'));
    assert.ok(chars.subtypes.includes('Construct'));
    assert.deepEqual(chars.keywords, []);
    assert.ok(e.copy.getCopiableValues(target).keywords.includes('flying'), 'later ability removal must not rewrite copiable values');
    h.trace('type-change'); h.trace('ability-removal');
  },

  'J36-BUG-SEARCH-RESOLUTION-009': (h) => {
    const e = h.createEngine({ invariantChecks: true });
    const player = e.state.players.player;
    let spell = null;
    for (const zone of ['library','hand','battlefield','graveyard','exile','command']) {
      spell = player[zone].find(card => card.cardId === 'lcc-kodama-s-reach');
      if (spell) break;
    }
    assert.ok(spell, "Explorers fixture must contain Kodama's Reach");
    if (spell.zone !== 'hand') spell = e.zones.move(spell.instanceId, 'hand', 'player');
    Object.assign(player.manaPool, { W: 0, U: 0, B: 0, R: 0, G: 4, C: 4 });
    h.setPhase('PRECOMBAT_MAIN', { activePlayer: 'player', priorityPlayer: 'player' });
    e.perform('player', { type: 'CAST_SPELL', cardInstanceId: spell.instanceId });
    h.trace('stack:resolving-spell');
    e.perform('player', { type: 'PASS_PRIORITY' });
    e.perform('ai', { type: 'PASS_PRIORITY' });
    assert.equal(e.state.pendingChoice?.type, 'CULTIVATE_SEARCH');
    h.trace('choice:CULTIVATE_SEARCH');
    assert.equal(e.state.pendingResolution?.item?.card?.instanceId, spell.instanceId);
    assert.equal(e.checkInvariants().ok, true);
    h.trace('pending-resolution:retained');
    const selected = e.state.pendingChoice.eligibleIds.slice(0, 2);
    e.perform('player', { type: 'CHOOSE_CULTIVATE', cardInstanceIds: selected });
    assert.equal(e.state.pendingResolution, null);
    assert.equal(cardZone(e, spell.instanceId), 'graveyard');
    assert.equal(e.checkInvariants().ok, true);
    h.trace('resolution:graveyard');
  }
});
