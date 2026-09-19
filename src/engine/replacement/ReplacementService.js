import { ENGINE_EVENT } from '../events/EventTypes.js';
import { ReplacementRegistry } from './ReplacementRegistry.js';
import { summarizeEventPayload } from '../events/provenance.js';

export class ReplacementService {
  constructor(engine) {
    this.engine = engine;
    this.registry = new ReplacementRegistry(engine);
    this.trace = [];
  }

  inferAffectedObject(event) {
    const p = event.payload || {};
    if (event.type === ENGINE_EVENT.ADD_COUNTER || event.type === ENGINE_EVENT.REMOVE_COUNTER) return this.engine._queryObject(p.permanentId || p.permanent || p.objectId || p.object);
    if (event.type === ENGINE_EVENT.DEAL_DAMAGE && !p.targetPlayer) return this.engine.findPermanent(p.targetId || p.target);
    if (event.type === ENGINE_EVENT.MOVE_ZONE) return this.engine._queryObject(p.cardInstanceId || p.cardRef);
    return null;
  }

  inferAffectedPlayer(event) {
    const p = event.payload || {};
    if (p.targetPlayer) return p.targetPlayer;
    if ([ENGINE_EVENT.DRAW_CARD, ENGINE_EVENT.GAIN_LIFE, ENGINE_EVENT.LOSE_LIFE, ENGINE_EVENT.CREATE_TOKEN, ENGINE_EVENT.SEARCH].includes(event.type)) return p.playerId || null;
    const object = this.inferAffectedObject(event);
    return p.playerId || object?.controller || object?.owner || p.toPlayerId || null;
  }

  register(definition) { return this.registry.register(definition); }

  applicable(event, applied = new Set()) {
    return this.registry.applicable(event).filter(effect => !applied.has(effect.id));
  }

  _orderedCandidate(applicable, order, applied) {
    if (Array.isArray(order)) {
      for (const id of order) {
        if (applied.has(id)) continue;
        const effect = applicable.find(candidate => candidate.id === id);
        if (effect) return effect;
      }
    }
    return applicable[0] || null;
  }

  transformEvent(event) {
    if (event.skipReplacements || event.payload?._skipReplacements) return event;
    let current = { ...event, payload: structuredClone(event.payload || {}), replacementTrace: [...(event.replacementTrace || [])] };
    const applied = new Set(current.appliedReplacementIds || []);
    const order = current.replacementOrder || current.payload?.replacementOrder || null;
    const usage = new Map();
    let guard = 0;

    while (!current.prevented && guard++ < 128) {
      const applicable = this.applicable(current, applied).filter(effect => Number(usage.get(effect.id) || 0) < effect.usageLimit);
      if (!applicable.length) break;
      const affectedPlayerId = this.inferAffectedPlayer(current);
      this.trace.push({
        stage: 'considered',
        eventId: current.eventId,
        eventType: current.type,
        affectedPlayerId,
        replacementIds: applicable.map(effect => effect.id)
      });
      const effect = this._orderedCandidate(applicable, order, applied);
      if (!effect) break;
      this.trace.push({
        stage: 'selected',
        eventId: current.eventId,
        eventType: current.type,
        affectedPlayerId: effect.affectedPlayerId(current, this.engine) || affectedPlayerId,
        replacementId: effect.id,
        sourceName: effect.sourceName
      });
      const before = summarizeEventPayload(current.payload);
      const transformed = effect.apply(current, this.engine) || current;
      current = { ...current, ...transformed, payload: structuredClone(transformed.payload || current.payload || {}) };
      applied.add(effect.id);
      usage.set(effect.id, Number(usage.get(effect.id) || 0) + 1);
      const entry = {
        replacementId: effect.id,
        sourceName: effect.sourceName,
        source: structuredClone(effect.source),
        affectedPlayerId: effect.affectedPlayerId(current, this.engine) || this.inferAffectedPlayer(current),
        before,
        after: summarizeEventPayload(current.payload)
      };
      current.replacementTrace = [...(current.replacementTrace || []), entry];
      this.trace.push({ stage: 'applied', eventId: current.eventId, eventType: current.type, ...structuredClone(entry) });
    }
    if (guard >= 128) throw new Error('Replacement selection loop exceeded safety limit');
    current.appliedReplacementIds = [...applied];
    return current;
  }

  preview(eventType, payload = {}) {
    const event = { type: eventType, payload: structuredClone(payload), replacementTrace: [], preventionTrace: [], appliedReplacementIds: [] };
    return this.registry.applicable(event);
  }

  requiresChoice(eventType, effects) {
    if ((effects || []).length <= 1) return false;
    const labels = effects.map(effect => effect.metadata?.ability?.effect || effect.metadata?.effect || null);
    // These current token transforms are mathematically commutative: N token
    // doublers plus Academy Manufactor yield the same quantities in either
    // order. Do not interrupt gameplay with a meaningless order dialog.
    if (eventType === ENGINE_EVENT.CREATE_TOKEN && labels.every(label => ['double', 'manufactor'].includes(label))) return false;
    // Identical additive or multiplicative counter replacements commute too.
    if (eventType === ENGINE_EVENT.ADD_COUNTER && new Set(labels).size === 1 && ['double', 'addOne'].includes(labels[0])) return false;
    if (effects.every(effect => effect.metadata?.commutative === true)) return false;
    return true;
  }

  dispatchWithChoice(eventType, payload = {}, { cause = null, stabilize = false, affectedPlayerId = null, replacementOrder = null } = {}) {
    const draft = { type: eventType, payload: structuredClone(payload), replacementTrace: [], preventionTrace: [] };
    const applicable = this.registry.applicable(draft);
    const playerId = affectedPlayerId || this.inferAffectedPlayer(draft);
    if (applicable.length) {
      this.trace.push({
        stage: 'considered',
        eventId: null,
        eventType,
        affectedPlayerId: playerId,
        replacementIds: applicable.map(effect => effect.id),
        preDispatch: true
      });
    }
    if (this.requiresChoice(eventType, applicable) && !replacementOrder) {
      if (this.engine.state.pendingChoice) throw new Error('Cannot start a replacement-order choice while another choice is pending');
      this.trace.push({
        stage: 'choice_requested',
        eventId: null,
        eventType,
        affectedPlayerId: playerId,
        replacementIds: applicable.map(effect => effect.id)
      });
      this.engine.state.pendingChoice = {
        type: 'REPLACEMENT_ORDER',
        playerId,
        replacementIds: applicable.map(effect => effect.id),
        replacements: applicable.map(effect => ({ id: effect.id, sourceName: effect.sourceName, effect: effect.metadata?.ability?.effect || effect.metadata?.effect || null, metadata: structuredClone(effect.metadata || {}) })),
        replacementEvent: { eventType, payload: structuredClone(payload), options: { cause, stabilize } },
        resume: this.engine.state.phase === 'CLEANUP' ? 'CLEANUP' : 'PRIORITY'
      };
      this.engine.state.priorityPlayer = playerId;
      return { deferred: true, applicable: applicable.map(effect => effect.id) };
    }
    return this.engine.events.dispatch(eventType, payload, { cause, stabilize, replacementOrder });
  }

  resolveOrderChoice(choice, replacementIds) {
    if (!choice?.replacementEvent) return false;
    this.engine.state.pendingChoice = null;
    const { eventType, payload, options = {} } = choice.replacementEvent;
    return this.engine.events.dispatch(eventType, structuredClone(payload), { ...options, replacementOrder: [...replacementIds] });
  }

  getTraceSnapshot() { return structuredClone(this.trace); }
  clearTrace() { this.trace = []; }
}
