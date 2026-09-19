import { beginNewObjectIncarnation, ensureCanonicalCardObject } from './state/GameObject.js';
import { PLAYER_ZONES } from './zones/ZoneTypes.js';
import { legacyMove, legacyPlace, legacyRemove } from './zones/legacyStateZoneApi.js';

function matchesId(card, id) {
  return card?.instanceId === id || card?.gameObjectId === id;
}

/**
 * Compatibility facade retained for Step 1-7 callers/tests.
 * Step 8 moves all player-zone mutation into zones/ZoneService.js. This module
 * intentionally exposes only read lookup plus detached-object preparation.
 */
export class ZoneManager {
  static find(state, instanceOrObjectId) {
    for (const player of Object.values(state.players)) {
      for (const zone of PLAYER_ZONES) {
        const index = player[zone].findIndex(card => matchesId(card, instanceOrObjectId));
        if (index >= 0) return { player, playerId: player.id, zone, index, card: player[zone][index] };
      }
    }
    const index = state.stack.findIndex(item => matchesId(item.card, instanceOrObjectId) || item.gameObjectId === instanceOrObjectId || item.id === instanceOrObjectId);
    return index >= 0 ? { zone: 'stack', index, card: state.stack[index].card, stackItem: state.stack[index] } : null;
  }

  static prepareForZone(card, toZone, destinationPlayerId = null, definition = {}) {
    if (!card) return null;
    const destinationId = destinationPlayerId || card.owner;
    ensureCanonicalCardObject(card, definition);
    beginNewObjectIncarnation(card, toZone, destinationId, definition);
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
    return card;
  }
  /** @deprecated Test/legacy compatibility only. Production engine code uses ZoneService via MOVE_ZONE. */
  static move(state, instanceOrObjectId, toZone, toPlayerId = null, db = {}) {
    return legacyMove(state, instanceOrObjectId, toZone, toPlayerId, db);
  }

  /** @deprecated Test/legacy compatibility only. */
  static place(state, card, toZone, toPlayerId = null, db = {}) {
    return legacyPlace(state, card, toZone, toPlayerId, db);
  }

  /** @deprecated Test/legacy compatibility only. */
  static remove(state, instanceOrObjectId) {
    return legacyRemove(state, instanceOrObjectId);
  }

}
