import { immutableClone } from '../public/immutable.js';
import { isHiddenZone } from './ZoneTypes.js';

function nowRecord(engine, card, details = {}) {
  return {
    instanceId: card.instanceId,
    gameObjectId: card.gameObjectId,
    cardId: card.cardId,
    zone: card.zone,
    owner: card.owner,
    knownAtTurn: engine.state.turn,
    knownAtPhase: engine.state.phase,
    public: !!details.public,
    reason: details.reason || null,
    position: details.position || null,
    ...details
  };
}

export class KnownInformationTracker {
  constructor(engine) {
    this.engine = engine;
    this.ensureState();
  }

  ensureState() {
    const state = this.engine.state;
    const ids = state.playerOrder || Object.keys(state.players || {});
    state.knownInformation ||= {};
    for (const id of ids) state.knownInformation[id] ||= { cards: {} };
    return state.knownInformation;
  }

  _viewer(viewerId) {
    const all = this.ensureState();
    all[viewerId] ||= { cards: {} };
    return all[viewerId];
  }

  remember(viewerId, card, details = {}) {
    if (!viewerId || !card?.instanceId) return null;
    const record = nowRecord(this.engine, card, details);
    this._viewer(viewerId).cards[card.instanceId] = structuredClone(record);
    return immutableClone(record);
  }

  reveal(card, { reason = 'reveal', position = null } = {}) {
    for (const viewerId of this.engine.playerIds()) this.remember(viewerId, card, { public: true, reason, position });
  }

  look(viewerId, card, { reason = 'look', position = null } = {}) {
    return this.remember(viewerId, card, { public: false, reason, position });
  }

  forget(viewerId, cardOrId) {
    const id = typeof cardOrId === 'string' ? cardOrId : cardOrId?.instanceId;
    if (id) delete this._viewer(viewerId).cards[id];
  }

  forgetForAll(cardOrId) {
    const id = typeof cardOrId === 'string' ? cardOrId : cardOrId?.instanceId;
    if (!id) return;
    for (const viewerId of this.engine.playerIds()) this.forget(viewerId, id);
  }

  clearLibraryKnowledge(playerId) {
    for (const viewerId of this.engine.playerIds()) {
      const cards = this._viewer(viewerId).cards;
      for (const [instanceId, record] of Object.entries(cards)) {
        if (record.zone === 'library' && record.owner === playerId) delete cards[instanceId];
      }
    }
  }

  onZoneChange(card, { fromZone, toZone, reason = null, knownTo = null, publicReveal = false, position = null } = {}) {
    if (!card) return;
    if (!isHiddenZone(toZone)) {
      this.forgetForAll(card);
      return;
    }

    // Moving into a hidden zone normally breaks object tracking. Preserve only
    // knowledge explicitly granted by the resolving effect (look/reveal/top/bottom).
    this.forgetForAll(card);
    if (publicReveal) this.reveal(card, { reason: reason || 'zone-change-reveal', position });
    else for (const viewerId of knownTo || []) this.look(viewerId, card, { reason: reason || 'zone-change-look', position });
  }

  isKnown(viewerId, card) {
    if (!viewerId || !card?.instanceId) return false;
    return !!this._viewer(viewerId).cards[card.instanceId];
  }

  get(viewerId, cardOrId) {
    const id = typeof cardOrId === 'string' ? cardOrId : cardOrId?.instanceId;
    const record = id ? this._viewer(viewerId).cards[id] : null;
    return record ? immutableClone(record) : null;
  }

  snapshot(viewerId) {
    return immutableClone(this._viewer(viewerId));
  }
}
