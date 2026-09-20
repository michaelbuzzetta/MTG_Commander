import { ensureCanonicalCardObject } from '../state/GameObject.js';
import { immutableClone } from '../public/immutable.js';

function cleanSnapshot(card, derived = null, abilities = null) {
  if (!card) return null;
  return {
    instanceId: card.instanceId,
    gameObjectId: card.gameObjectId,
    zoneChangeId: card.zoneChangeId,
    cardId: card.cardId,
    objectKind: card.objectKind,
    owner: card.owner,
    controller: card.controller,
    zone: card.zone,
    isCommander: !!card.isCommander,
    commanderIdentity: card.commanderIdentity || null,
    isToken: !!card.isToken,
    isCopy: !!card.isCopy,
    tapped: !!card.tapped,
    faceDown: !!card.faceDown,
    phasedOut: !!card.phasedOut,
    counters: structuredClone(card.counters || {}),
    damageMarked: Number(card.damageMarked || 0),
    attachments: structuredClone(card.attachments || []),
    attachedTo: card.attachedTo || null,
    baseCharacteristics: structuredClone(card.baseCharacteristics || null),
    faceState: structuredClone(card.faceState || null),
    copyState: structuredClone(card.copyState || null),
    copyMetadata: structuredClone(card.copyMetadata || null),
    derivedCharacteristics: derived ? structuredClone(derived) : null,
    effectiveAbilities: abilities ? structuredClone(abilities) : null
  };
}

export class LastKnownInformationService {
  constructor(engine) {
    this.engine = engine;
    this.ensureState();
  }

  ensureState() {
    const state = this.engine.state;
    state.lastKnownInformation ||= { sequence: 0, byObjectId: {}, byInstanceId: {} };
    state.lastKnownInformation.sequence = Number(state.lastKnownInformation.sequence || 0);
    state.lastKnownInformation.byObjectId ||= {};
    state.lastKnownInformation.byInstanceId ||= {};
    return state.lastKnownInformation;
  }

  capture(card, { reason = null, eventId = null, fromZone = card?.zone || null } = {}) {
    if (!card) return null;
    // Legacy fixtures and compatibility callers may supply pre-Step-2 card
    // shapes. Canonicalize before capturing so LKI always has a rules-object ID
    // and survives pruning exactly like production objects.
    ensureCanonicalCardObject(card, this.engine.db[card.cardId] || {});
    const store = this.ensureState();
    const derived = this.engine.static?.derivedStats ? this.engine.static.derivedStats(card) : null;
    const abilities = this.engine.static?.effectiveAbilities ? this.engine.static.effectiveAbilities(card) : null;
    const sequence = ++store.sequence;
    const record = {
      lkiId: `lki:${sequence}`,
      sequence,
      eventId,
      reason,
      fromZone,
      capturedTurn: this.engine.state.turn,
      capturedPhase: this.engine.state.phase,
      object: cleanSnapshot(card, derived, abilities)
    };
    if (card.gameObjectId) store.byObjectId[card.gameObjectId] = structuredClone(record);
    if (card.instanceId) store.byInstanceId[card.instanceId] = structuredClone(record);
    return immutableClone(record);
  }

  get(ref) {
    const store = this.ensureState();
    const id = typeof ref === 'string' ? ref : (ref?.gameObjectId || ref?.instanceId || null);
    if (!id) return null;
    const record = store.byObjectId[id] || store.byInstanceId[id] || null;
    return record ? immutableClone(record) : null;
  }

  prune({ maxRecords = 512 } = {}) {
    const store = this.ensureState();
    const records = Object.values(store.byObjectId).sort((a, b) => Number(b.sequence || 0) - Number(a.sequence || 0));
    const keep = new Set(records.slice(0, maxRecords).map(record => record.object?.gameObjectId).filter(Boolean));
    for (const key of Object.keys(store.byObjectId)) if (!keep.has(key)) delete store.byObjectId[key];
    const retainedInstances = new Set(Object.values(store.byObjectId).map(record => record.object?.instanceId).filter(Boolean));
    for (const key of Object.keys(store.byInstanceId)) if (!retainedInstances.has(key)) delete store.byInstanceId[key];
  }
}
