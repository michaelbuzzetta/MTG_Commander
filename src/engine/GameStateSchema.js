import { ZONES } from '../constants.js';
import { GAME_OBJECT_KIND, ensureCanonicalCardObject } from './GameObject.js';
import { buildBaseTurnSequence } from '../turn/TurnStructure.js';
import { createStackObject, validateStackObject } from '../stack/StackObject.js';

export const GAME_STATE_SCHEMA_VERSION = 2;
export const SUPPORTED_OBJECT_KINDS = Object.freeze(Object.values(GAME_OBJECT_KIND));

/**
 * Runtime validation companion to src/engine/state/types.d.ts.
 * The engine remains JavaScript, so this validator makes the canonical state contract executable.
 */
export function validateCanonicalGameState(state, { throwOnError = false } = {}) {
  const errors = [];
  const fail = message => errors.push(message);
  if (!state || typeof state !== 'object') fail('GameState must be an object');
  else {
    if (state.schemaVersion !== GAME_STATE_SCHEMA_VERSION) fail(`GameState.schemaVersion must be ${GAME_STATE_SCHEMA_VERSION}`);
    if (!Array.isArray(state.playerOrder) || state.playerOrder.length < 2) fail('GameState.playerOrder must contain at least two players');
    if (!state.players || typeof state.players !== 'object') fail('GameState.players is required');
    if (!Array.isArray(state.stack)) fail('GameState.stack must be an array');
    if (!Array.isArray(state.pendingTriggers)) fail('GameState.pendingTriggers must be an array');
    if (!Array.isArray(state.triggerRegistrations)) fail('GameState.triggerRegistrations must be an array');
    if (!Array.isArray(state.continuousEffects)) fail('GameState.continuousEffects must be an array');
    if (!Array.isArray(state.attachments)) fail('GameState.attachments must be an array');
    if (!Array.isArray(state.preventionEffects)) fail('GameState.preventionEffects must be an array');
    if (!Array.isArray(state.legalityUsage)) fail('GameState.legalityUsage must be an array');
    if (!Array.isArray(state.legalityDiagnostics)) fail('GameState.legalityDiagnostics must be an array');
    if (!Array.isArray(state.timingUsage)) fail('GameState.timingUsage must be an array');
    if (!Array.isArray(state.timingDiagnostics)) fail('GameState.timingDiagnostics must be an array');
    if (!Array.isArray(state.turnSequence)) fail('GameState.turnSequence must be an array');
    if (!Number.isInteger(state.phaseIndex)) fail('GameState.phaseIndex must be an integer');
    if (!['normal', 'extra'].includes(state.turnKind)) fail('GameState.turnKind must be normal or extra');
    if (state.normalTurnPlayer != null && !state.players?.[state.normalTurnPlayer]) fail('GameState.normalTurnPlayer must reference a player');
    if (state.gameBegun && state.turnSequence?.length) {
      const node = state.turnSequence[state.phaseIndex];
      if (node && node.key !== state.phase) fail(`GameState phase/sequence mismatch: ${state.phase} != ${node.key}`);
    }

    const gameObjectIds = new Set();
    for (const [playerId, player] of Object.entries(state.players || {})) {
      if (player.objectKind !== GAME_OBJECT_KIND.PLAYER) fail(`Player ${playerId} must have objectKind=player`);
      if (player.id !== playerId) fail(`Player key/id mismatch for ${playerId}`);
      for (const zone of ZONES.filter(zone => zone !== 'stack')) {
        if (!Array.isArray(player[zone])) { fail(`Player ${playerId}.${zone} must be an array`); continue; }
        for (const card of player[zone]) {
          if (!card.instanceId) fail(`Card in ${playerId}.${zone} is missing instanceId`);
          if (!card.gameObjectId) fail(`Card ${card.instanceId || '?'} is missing gameObjectId`);
          if (!Number.isInteger(card.zoneChangeId) || card.zoneChangeId < 0) fail(`Card ${card.instanceId || '?'} has invalid zoneChangeId`);
          if (card.zone !== zone) fail(`Card ${card.instanceId || '?'} says zone=${card.zone}, expected ${zone}`);
          if (card.owner == null || card.controller == null) fail(`Card ${card.instanceId || '?'} must have distinct owner/controller fields`);
          if (!card.cardIdentity || !card.baseCharacteristics) fail(`Card ${card.instanceId || '?'} is missing immutable/base identity data`);
          if (!card.faceState) fail(`Card ${card.instanceId || '?'} is missing faceState`);
          if (gameObjectIds.has(card.gameObjectId)) fail(`Duplicate gameObjectId ${card.gameObjectId}`);
          gameObjectIds.add(card.gameObjectId);
        }
      }
    }

    for (const item of state.stack || []) {
      if (!item.gameObjectId) fail(`Stack item ${item.id || '?'} is missing gameObjectId`);
      if (![GAME_OBJECT_KIND.SPELL, GAME_OBJECT_KIND.ABILITY_ON_STACK].includes(item.objectKind)) fail(`Stack item ${item.id || '?'} has invalid objectKind`);
      if (gameObjectIds.has(item.gameObjectId)) fail(`Duplicate gameObjectId ${item.gameObjectId}`);
      gameObjectIds.add(item.gameObjectId);
      for (const error of validateStackObject(item).errors) fail(`Stack item ${item.id || '?'}: ${error}`);
      if (item.card) {
        if (item.card.zone !== 'stack') fail(`Spell card ${item.card.instanceId || '?'} must have zone=stack`);
        if (item.card.objectKind !== GAME_OBJECT_KIND.SPELL) fail(`Spell card ${item.card.instanceId || '?'} must have objectKind=spell`);
        if (!item.card.gameObjectId) fail(`Spell card ${item.card.instanceId || '?'} is missing gameObjectId`);
        else if (gameObjectIds.has(item.card.gameObjectId)) fail(`Duplicate gameObjectId ${item.card.gameObjectId}`);
        else gameObjectIds.add(item.card.gameObjectId);
      }
    }
  }
  if (throwOnError && errors.length) throw new Error(`Invalid canonical GameState:\n- ${errors.join('\n- ')}`);
  return { ok: errors.length === 0, errors };
}

export function hydrateCanonicalGameState(state, db = {}) {
  if (!state || typeof state !== 'object') throw new Error('Cannot hydrate an invalid GameState');
  state.schemaVersion = GAME_STATE_SCHEMA_VERSION;
  const playerIds = Array.isArray(state.playerOrder) ? state.playerOrder : Object.keys(state.players || {});
  const keyed = initial => Object.fromEntries(playerIds.map(id => [id, typeof initial === 'function' ? initial(id) : structuredClone(initial)]));
  if (!Array.isArray(state.turnSequence) || !state.turnSequence.length) state.turnSequence = buildBaseTurnSequence();
  if (!Number.isInteger(state.phaseIndex)) state.phaseIndex = state.phase === 'PREGAME' ? -1 : Math.max(0, state.turnSequence.findIndex(node => node.key === state.phase));
  state.turnStepId ??= state.phaseIndex >= 0 ? state.turnSequence[state.phaseIndex]?.id || null : null;
  state.turnPhaseGroup ??= state.phaseIndex >= 0 ? state.turnSequence[state.phaseIndex]?.phaseGroup || null : null;
  state.cleanupIteration = Number(state.cleanupIteration || 0);
  state.turnHistory ||= [];
  state.skippedTurnHistory ||= [];
  state.extraTurnQueue ||= [];
  state.turnKind ||= 'normal';
  state.normalTurnPlayer ||= state.activePlayer || playerIds[0] || null;
  state.turnModifiers ||= {};
  state.turnModifiers.skippedTurns ||= keyed(0);
  state.turnModifiers.extraUpkeeps ||= keyed(0);
  state.turnModifiers.skippedDrawSteps ||= keyed(0);
  state.turnModifiers.skippedCombatPhases ||= keyed(0);
  state.turnModifiers.skipSteps ||= keyed(() => ({}));
  state.turnModifiers.skipPhaseGroups ||= keyed(() => ({}));
  state.pendingTriggers ||= [];
  state.triggerRegistrations ||= [];
  state.continuousEffects ||= [];
  state.attachments ||= [];
  state.attachmentTimestampSequence = Number(state.attachmentTimestampSequence || 0);
  state.continuousTimestampSequence = Number(state.continuousTimestampSequence || 0);
  state.preventionEffects ||= [];
  state.pendingDamageBatch ??= null;
  state.legalityUsage ||= [];
  state.legalityDiagnostics ||= [];
  state.timingUsage ||= [];
  state.timingDiagnostics ||= [];
  state.combat ||= {};
  state.combat.attackers ||= [];
  state.combat.attackTargets ||= {};
  state.combat.attackDefendingPlayers ||= {};
  state.combat.defendingEntities ||= {};
  state.combat.blockers ||= {};
  state.combat.blocked ||= {};
  state.combat.damageAssignments ||= {};
  state.combat.defendingPlayers ||= [];
  state.combat.blockerQueue ||= [];
  state.combat.currentDefender ??= null;
  state.knownInformation ||= keyed(() => ({ cards: {} }));
  state.lastKnownInformation ||= { sequence: 0, byObjectId: {}, byInstanceId: {} };
  state.lastKnownInformation.sequence = Number(state.lastKnownInformation.sequence || 0);
  state.lastKnownInformation.byObjectId ||= {};
  state.lastKnownInformation.byInstanceId ||= {};
  for (const id of playerIds) {
    if (!(id in state.turnModifiers.skippedTurns)) state.turnModifiers.skippedTurns[id] = 0;
    if (!(id in state.turnModifiers.extraUpkeeps)) state.turnModifiers.extraUpkeeps[id] = 0;
    if (!(id in state.turnModifiers.skippedDrawSteps)) state.turnModifiers.skippedDrawSteps[id] = 0;
    if (!(id in state.turnModifiers.skippedCombatPhases)) state.turnModifiers.skippedCombatPhases[id] = 0;
    state.turnModifiers.skipSteps[id] ||= {};
    state.turnModifiers.skipPhaseGroups[id] ||= {};
    state.knownInformation[id] ||= { cards: {} };
    state.knownInformation[id].cards ||= {};
  }
  for (const [playerId, player] of Object.entries(state.players || {})) {
    player.id = player.id || playerId;
    player.objectKind = GAME_OBJECT_KIND.PLAYER;
    player.gameObjectId = player.gameObjectId || `player:${playerId}`;
    const ownedCommanders = [];
    for (const zone of ZONES.filter(zone => zone !== 'stack')) {
      if (!Array.isArray(player[zone])) player[zone] = [];
      for (const card of player[zone]) {
        card.zone = zone;
        ensureCanonicalCardObject(card, db[card.cardId] || {});
        if (card.isCommander && card.owner === playerId) ownedCommanders.push(card);
      }
    }
    player.counters ||= {};
    player.commanderTaxLedger ||= {};
    player.commanderDamage ||= {};
    player.commanderIdentities ||= [];
    player.commanderCardIds ||= [];
    ownedCommanders.forEach((card, index) => {
      card.commanderIdentity ||= player.commanderIdentities[index] || `commander:${playerId}:${index + 1}:${card.cardId}`;
      player.commanderIdentities[index] ||= card.commanderIdentity;
      player.commanderCardIds[index] ||= card.cardId;
      if (!player.commanderTaxLedger[card.commanderIdentity]) {
        const legacyTax = ownedCommanders.length === 1 ? Math.max(0, Number(player.commanderTax || 0)) : 0;
        player.commanderTaxLedger[card.commanderIdentity] = {
          commanderIdentity: card.commanderIdentity,
          cardId: card.cardId,
          castsFromCommandZone: Math.floor(legacyTax / 2),
          tax: legacyTax
        };
      }
    });
  }
  for (let index = 0; index < (state.stack || []).length; index++) {
    const item = state.stack[index];
    const normalized = createStackObject(item);
    Object.assign(item, normalized);
    state.stack[index] = item;
    if (item.card) {
      item.card.zone = 'stack';
      ensureCanonicalCardObject(item.card, db[item.card.cardId] || {});
      item.card.objectKind = GAME_OBJECT_KIND.SPELL;
      if (item.card.isCommander && !item.card.commanderIdentity) {
        const owner = state.players?.[item.card.owner];
        const match = Object.values(owner?.commanderTaxLedger || {}).find(entry => entry.cardId === item.card.cardId);
        item.card.commanderIdentity = match?.commanderIdentity || `commander:${item.card.owner}:1:${item.card.cardId}`;
      }
    }
  }
  return state;
}
