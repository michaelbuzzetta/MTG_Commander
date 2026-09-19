import { ENGINE_EVENT } from '../events/EventTypes.js';
import { canonicalTokenDefinition, isUtilityTokenName } from '../TokenDefinitions.js';

const LEGACY_EVENT_MAP = Object.freeze({
  COUNTERS_ADDED: ENGINE_EVENT.ADD_COUNTER,
  TOKEN_CREATED: ENGINE_EVENT.CREATE_TOKEN,
  DRAW_CARD: ENGINE_EVENT.DRAW_CARD,
  LIFE_GAIN: ENGINE_EVENT.GAIN_LIFE,
  LIFE_LOSS: ENGINE_EVENT.LOSE_LIFE,
  MOVE_ZONE: ENGINE_EVENT.MOVE_ZONE,
  DAMAGE: ENGINE_EVENT.DEAL_DAMAGE
});

function cloneEvent(event) {
  return { ...event, payload: structuredClone(event.payload || {}), replacementTrace: [...(event.replacementTrace || [])] };
}

function multiplyTokenPayload(payload, factor) {
  if (Array.isArray(payload.tokenBatches)) {
    payload.tokenBatches = payload.tokenBatches.map(batch => ({ ...batch, amount: Math.max(0, Number(batch.amount || 0) * factor) }));
  } else {
    payload.amount = Math.max(0, Number(payload.amount || 0) * factor);
  }
}

function applyDeclarativeTransform(event, ability) {
  const next = cloneEvent(event);
  const effect = ability.effect;
  if (effect === 'addOne') {
    if (next.type === ENGINE_EVENT.ADD_COUNTER) next.payload.amount = Number(next.payload.amount || 0) + 1;
    return next;
  }
  if (effect === 'double') {
    if (next.type === ENGINE_EVENT.ADD_COUNTER) next.payload.amount = Number(next.payload.amount || 0) * 2;
    else if (next.type === ENGINE_EVENT.CREATE_TOKEN) multiplyTokenPayload(next.payload, 2);
    else if (typeof next.payload.amount === 'number') next.payload.amount *= 2;
    return next;
  }
  if (effect === 'manufactor' && next.type === ENGINE_EVENT.CREATE_TOKEN) {
    const name = next.payload.tokenDefinition?.name;
    if (!isUtilityTokenName(name)) return next;
    const amount = Math.max(0, Number(next.payload.amount || 0));
    next.payload.tokenBatches = ['Treasure', 'Food', 'Clue'].map(tokenName => ({
      amount,
      tokenDefinition: canonicalTokenDefinition({ name: tokenName })
    }));
    delete next.payload.amount;
    delete next.payload.tokenDefinition;
    return next;
  }
  if (effect && typeof effect === 'object') {
    switch (effect.kind) {
      case 'multiplyAmount':
        if (next.type === ENGINE_EVENT.CREATE_TOKEN) multiplyTokenPayload(next.payload, Number(effect.factor || 1));
        else next.payload.amount = Number(next.payload.amount || 0) * Number(effect.factor || 1);
        break;
      case 'addAmount':
        next.payload.amount = Number(next.payload.amount || 0) + Number(effect.amount || 0);
        break;
      case 'setDestination':
        next.payload.toZone = effect.zone || next.payload.toZone;
        if (effect.playerId) next.payload.toPlayerId = effect.playerId;
        break;
      case 'enterTapped':
        next.payload.entryState = { ...(next.payload.entryState || {}), tapped: true };
        break;
      case 'enterWithCounters':
        next.payload.entryState = {
          ...(next.payload.entryState || {}),
          counters: [...(next.payload.entryState?.counters || []), { type: effect.counterType || '+1/+1', amount: Number(effect.amount || 1) }]
        };
        break;
      case 'prevent':
        next.prevented = true;
        break;
      case 'replaceEvent':
        next.originalType ||= next.type;
        next.type = effect.eventType || next.type;
        next.payload = { ...next.payload, ...(structuredClone(effect.payload || {})) };
        break;
      default:
        break;
    }
  }
  return next;
}

export class ReplacementEffect {
  constructor({ id, eventTypes, predicate = null, affectedPlayer = null, transform, source = null, controller = null, sourceName = null, usageLimit = 1, duration = null, metadata = {} } = {}) {
    if (!id) throw new Error('ReplacementEffect requires an id');
    const types = Array.isArray(eventTypes) ? eventTypes : [eventTypes];
    if (!types.filter(Boolean).length) throw new Error('ReplacementEffect requires at least one event type');
    if (typeof transform !== 'function') throw new Error('ReplacementEffect requires a transform function');
    this.id = String(id);
    this.eventTypes = [...new Set(types.filter(Boolean))];
    this.predicate = predicate;
    this.affectedPlayer = affectedPlayer;
    this.transform = transform;
    this.source = source ? structuredClone(source) : null;
    this.controller = controller || null;
    this.sourceName = sourceName || source?.name || this.id;
    this.usageLimit = Math.max(1, Number(usageLimit || 1));
    this.duration = duration ? structuredClone(duration) : null;
    this.metadata = structuredClone(metadata || {});
  }

  isActive(engine) {
    if (!this.duration) return true;
    if (this.duration.untilTurn != null && Number(engine.state.turn || 0) > Number(this.duration.untilTurn)) return false;
    if (this.duration.whileSourceOnBattlefield && this.source?.instanceId && !engine.findPermanent(this.source.instanceId)) return false;
    if (typeof this.duration.predicate === 'function' && !this.duration.predicate(engine)) return false;
    return true;
  }

  applies(event, engine) {
    if (!this.isActive(engine)) return false;
    if (!this.eventTypes.includes(event.type)) return false;
    if (typeof this.predicate === 'function' && !this.predicate(event, engine)) return false;
    return true;
  }

  affectedPlayerId(event, engine) {
    if (typeof this.affectedPlayer === 'function') return this.affectedPlayer(event, engine);
    return this.affectedPlayer || null;
  }

  apply(event, engine) {
    return this.transform(event, engine) || event;
  }

  static fromCardAbility({ source, definition, ability, abilityIndex, predicate }) {
    const eventType = LEGACY_EVENT_MAP[ability.event] || ability.event;
    return new ReplacementEffect({
      id: `${source.instanceId}:replacement:${abilityIndex}`,
      eventTypes: eventType,
      predicate,
      affectedPlayer: (event, engine) => engine.replacements.inferAffectedPlayer(event),
      transform: event => applyDeclarativeTransform(event, ability),
      source: { instanceId: source.instanceId, cardId: source.cardId },
      controller: source.controller,
      sourceName: definition?.name || source.cardId,
      usageLimit: 1,
      metadata: { ability: structuredClone(ability), declarative: true }
    });
  }
}
