import { beginNewObjectIncarnation, ensureCanonicalCardObject } from '../state/GameObject.js';
import { PLAYER_ZONES, STACK_ZONE, isPlayerZone } from './ZoneTypes.js';

function matchesId(card, id) {
  return card?.instanceId === id || card?.gameObjectId === id;
}

function resetZoneChangeState(card, toZone, destinationPlayerId, definition = {}) {
  ensureCanonicalCardObject(card, definition);
  beginNewObjectIncarnation(card, toZone, destinationPlayerId, definition);
  card.tapped = false;
  card.summoningSick = false;
  card.counters = {};
  card.damageMarked = 0;
  card.damagePrevention = 0;
  card.deathtouchMarked = false;
  card.attacking = false;
  card.attackTarget = null;
  card.blocking = null;
  card.modifiers = { power: 0, toughness: 0, keywords: [] };
  card.createdTurn = null;
  card.controlledSinceTurn = null;
  card.controlHistory = [];
  card.chosenType = null;
  card.attachedTo = null;
  card.phasedOut = false;
  card.foretold = false;
  card.faceDown = false;
  card.exiledBy = null;
  card.castMode = null;
  delete card.entryLifeResolved;
  delete card.entryLifePaid;
  delete card.entryRevealResolved;
  delete card.entryRevealSucceeded;
}

/**
 * Step 8's authoritative zone-container API. Production code outside this
 * module must never push/splice player zone arrays directly.
 */
export class ZoneService {
  constructor(engine) { this.engine = engine; }

  find(instanceOrObjectId) {
    const state = this.engine.state;
    for (const player of Object.values(state.players)) {
      for (const zone of PLAYER_ZONES) {
        const index = player[zone].findIndex(card => matchesId(card, instanceOrObjectId));
        if (index >= 0) return { player, playerId: player.id, zone, index, card: player[zone][index] };
      }
    }
    const index = state.stack.findIndex(item => matchesId(item.card, instanceOrObjectId) || item.gameObjectId === instanceOrObjectId || item.id === instanceOrObjectId);
    return index >= 0 ? { zone: STACK_ZONE, index, card: state.stack[index].card, stackItem: state.stack[index] } : null;
  }

  list(playerId, zone) {
    if (!isPlayerZone(zone)) throw new Error(`Unsupported player zone ${zone}`);
    const player = this.engine.state.players[playerId];
    if (!player) throw new Error(`Unknown player ${playerId}`);
    return player[zone];
  }

  prepareForZone(card, toZone, destinationPlayerId = null, definition = {}) {
    if (!card) return null;
    const destinationId = destinationPlayerId || card.owner;
    resetZoneChangeState(card, toZone, destinationId, definition);
    return card;
  }

  detach(instanceOrObjectId) {
    const found = this.find(instanceOrObjectId);
    if (!found) return null;
    if (found.zone === STACK_ZONE) {
      const item = this.engine.stack.remove(found.stackItem?.id || found.stackItem?.gameObjectId || instanceOrObjectId);
      return item?.card || null;
    }
    return found.player[found.zone].splice(found.index, 1)[0] || null;
  }

  place(card, toZone, toPlayerId = null, { index = null } = {}) {
    if (!card || !isPlayerZone(toZone)) return null;
    const destinationId = toPlayerId || card.owner;
    const destination = this.engine.state.players[destinationId];
    if (!destination) throw new Error(`Unknown destination player ${destinationId}`);

    resetZoneChangeState(card, toZone, destinationId, this.engine.db[card.cardId] || {});
    if (card.isCommander && ['graveyard', 'exile'].includes(toZone)) card.commanderZoneChoicePending = true;
    else delete card.commanderZoneChoicePending;

    const zone = destination[toZone];
    if (index == null || index >= zone.length) zone.push(card);
    else zone.splice(Math.max(0, index), 0, card);
    return card;
  }

  move(instanceOrObjectId, toZone, toPlayerId = null, options = {}) {
    if (!isPlayerZone(toZone)) throw new Error(`Unsupported destination zone ${toZone}`);
    const found = this.find(instanceOrObjectId);
    if (!found) return null;
    const card = found.zone === STACK_ZONE
      ? this.detach(found.stackItem?.id || found.stackItem?.gameObjectId || instanceOrObjectId)
      : found.player[found.zone].splice(found.index, 1)[0];
    return this.place(card, toZone, toPlayerId, options);
  }

  remove(instanceOrObjectId) { return this.detach(instanceOrObjectId); }

  reorder(playerId, zone, orderedInstanceIds) {
    if (!isPlayerZone(zone)) throw new Error(`Unsupported player zone ${zone}`);
    const container = this.list(playerId, zone);
    if (orderedInstanceIds.length !== container.length) throw new Error('Zone reorder must include every object exactly once');
    const byId = new Map(container.map(card => [card.instanceId, card]));
    if (new Set(orderedInstanceIds).size !== orderedInstanceIds.length || orderedInstanceIds.some(id => !byId.has(id))) throw new Error('Invalid zone reorder');
    container.splice(0, container.length, ...orderedInstanceIds.map(id => byId.get(id)));
    return container;
  }

  shuffleLibrary(playerId, rng) {
    const library = this.list(playerId, 'library');
    for (let i = library.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [library[i], library[j]] = [library[j], library[i]];
    }
    return library;
  }

  moveWithinZone(playerId, zone, instanceId, destinationIndex) {
    const container = this.list(playerId, zone);
    const index = container.findIndex(card => card.instanceId === instanceId || card.gameObjectId === instanceId);
    if (index < 0) return null;
    const [card] = container.splice(index, 1);
    const safe = Math.max(0, Math.min(Number(destinationIndex) || 0, container.length));
    container.splice(safe, 0, card);
    return card;
  }

  replaceZone(playerId, zone, cards) {
    if (!isPlayerZone(zone)) throw new Error(`Unsupported player zone ${zone}`);
    const container = this.list(playerId, zone);
    container.splice(0, container.length, ...cards);
    return container;
  }

  transferBattlefieldControl(instanceOrObjectId, newController) {
    const found = this.find(instanceOrObjectId);
    if (!found || found.zone !== 'battlefield') throw new Error('Permanent is not on the battlefield');
    const destination = this.engine.state.players[newController];
    if (!destination) throw new Error(`Unknown controller ${newController}`);
    if (found.player.id === newController) return found.card;
    const [card] = found.player.battlefield.splice(found.index, 1);
    destination.battlefield.push(card);
    return card;
  }

  removeOwnedObjects(playerId) {
    let removed = 0;
    for (const player of Object.values(this.engine.state.players)) {
      for (const zone of PLAYER_ZONES) {
        const container = player[zone];
        for (let index = container.length - 1; index >= 0; index--) {
          if (container[index]?.owner === playerId) { container.splice(index, 1); removed += 1; }
        }
      }
    }
    return removed;
  }
}
