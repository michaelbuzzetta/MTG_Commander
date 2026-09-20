import { uid } from './utils.js';
import { ENGINE_EVENT } from '../events/EventTypes.js';
import { PreventionEffect } from './PreventionEffect.js';

export class PreventionService {
  constructor(engine) {
    this.engine = engine;
    // Function predicates are runtime-only. Normal card-created prevention
    // shields live in GameState so snapshots/replays preserve them.
    this.runtimeEffects = new Map();
  }

  _stateEffects() {
    this.engine.state.preventionEffects ||= [];
    return this.engine.state.preventionEffects;
  }

  _allEffects() {
    return [...this._stateEffects(), ...this.runtimeEffects.values()];
  }

  targetRef(target) {
    if (!target) return null;
    if (typeof target === 'string') return target;
    if (target.objectKind === 'player' || (target.id && this.engine.state.players?.[target.id] === target)) return target.id;
    return target.instanceId || target.gameObjectId || target.id || null;
  }

  addDamageShield(target, amount, { source = null, expires = { kind: 'endOfTurn', turn: this.engine.state.turn }, predicate = null, metadata = {} } = {}) {
    const targetRef = this.targetRef(target);
    const effect = new PreventionEffect({ id: uid('prevent'), source, targetRef, amount, predicate, expires, metadata: { ...metadata, mirrorLegacyField: true } });
    if (typeof predicate === 'function') this.runtimeEffects.set(effect.id, effect);
    else this._stateEffects().push({
      id: effect.id,
      source: structuredClone(effect.source),
      targetRef: effect.targetRef,
      remaining: effect.remaining,
      expires: structuredClone(effect.expires),
      metadata: structuredClone(effect.metadata)
    });
    // Preserve the pre-Step-10 public field for existing UI/tests while the
    // authoritative consumption is owned by PreventionService.
    if (target && typeof target === 'object' && amount !== Infinity) target.damagePrevention = Math.max(0, Number(target.damagePrevention || 0)) + Math.max(0, Number(amount || 0));
    return effect.id;
  }

  _isExpired(effect) {
    if (!effect.expires) return false;
    if (effect.expires.kind === 'endOfTurn') return Number(this.engine.state.turn || 0) > Number(effect.expires.turn || 0);
    if (effect.expires.kind === 'turn') return Number(this.engine.state.turn || 0) > Number(effect.expires.turn || 0);
    return false;
  }

  _clearMirror(effect) {
    if (!effect?.metadata?.mirrorLegacyField || effect.remaining === Infinity) return;
    const target = this.engine.state.players[effect.targetRef] || this.engine.findPermanent(effect.targetRef);
    if (target) target.damagePrevention = Math.max(0, Number(target.damagePrevention || 0) - Number(effect.remaining || 0));
  }

  pruneExpired({ forceEndOfTurn = false, turn = this.engine.state.turn } = {}) {
    const stateEffects = this._stateEffects();
    for (let index = stateEffects.length - 1; index >= 0; index--) {
      const effect = stateEffects[index];
      const endNow = forceEndOfTurn && effect.expires?.kind === 'endOfTurn' && Number(effect.expires.turn || 0) <= Number(turn || 0);
      if (endNow || this._isExpired(effect) || effect.remaining <= 0) {
        this._clearMirror(effect);
        stateEffects.splice(index, 1);
      }
    }
    for (const [id, effect] of this.runtimeEffects.entries()) {
      const endNow = forceEndOfTurn && effect.expires?.kind === 'endOfTurn' && Number(effect.expires.turn || 0) <= Number(turn || 0);
      if (endNow || this._isExpired(effect) || effect.remaining <= 0) {
        this._clearMirror(effect);
        this.runtimeEffects.delete(id);
      }
    }
  }

  _damageTargetRef(event) {
    if (event.payload?.targetPlayer) return event.payload.targetPlayer;
    const target = this.engine._queryObject(event.payload?.targetId || event.payload?.target);
    return this.targetRef(target || event.payload?.targetId || event.payload?.target);
  }

  _legacyShieldFor(event) {
    const target = event.payload?.targetPlayer
      ? this.engine.state.players[event.payload.targetPlayer]
      : this.engine.findPermanent(event.payload?.targetId || event.payload?.target);
    const available = Math.max(0, Number(target?.damagePrevention || 0));
    if (!available) return null;
    if (this._allEffects().some(effect => effect.targetRef === this.targetRef(target) && effect.metadata?.mirrorLegacyField)) return null;
    return { id: `legacy:${this.targetRef(target)}`, remaining: available, target, legacy: true, source: null };
  }

  _shieldCounterFor(event) {
    if (event.payload?.targetPlayer) return null;
    const target = this.engine.findPermanent(event.payload?.targetId || event.payload?.target);
    if (Number(target?.counters?.shield || 0) <= 0) return null;
    return { id: `shield-counter:${target.instanceId}`, remaining: Infinity, target, shieldCounter: true, source: { instanceId: target.instanceId } };
  }

  transformEvent(event) {
    if (event.type !== ENGINE_EVENT.DEAL_DAMAGE) return event;
    if (event.payload?.preventable === false || event.payload?.unpreventable === true) return event;
    this.pruneExpired();
    const targetRef = this._damageTargetRef(event);
    let amount = Math.max(0, Number(event.payload?.amount || 0));
    if (amount <= 0 || !targetRef) return event;

    const protectedTarget = event.payload?.targetPlayer ? null : this.engine.findPermanent(event.payload?.targetId || event.payload?.target);
    if (protectedTarget && this.engine.mechanics?.protectionPreventsDamage(protectedTarget, event.payload?.source)) {
      const next = { ...event, payload: structuredClone(event.payload), preventionTrace: [...(event.preventionTrace || [])] };
      next.payload.amount = 0;
      next.payload.preventedAmount = Number(next.payload.preventedAmount || 0) + amount;
      next.preventionTrace.push({ id: 'mechanic:protection', source: event.payload?.source || null, amount, targetRef });
      return next;
    }

    const candidates = [];
    const shieldCounter = this._shieldCounterFor(event);
    if (shieldCounter) candidates.push(shieldCounter);
    const legacy = this._legacyShieldFor(event);
    if (legacy) candidates.push(legacy);
    for (const effect of this._allEffects()) {
      if (this._isExpired(effect) || effect.remaining <= 0 || effect.targetRef !== targetRef) continue;
      if (typeof effect.predicate === 'function' && !effect.predicate(event, this.engine)) continue;
      candidates.push(effect);
    }
    if (!candidates.length) return event;

    const next = { ...event, payload: structuredClone(event.payload), preventionTrace: [...(event.preventionTrace || [])] };
    const consumptions = [];
    let preventedTotal = 0;
    for (const effect of candidates) {
      if (amount <= 0) break;
      const prevent = effect.shieldCounter ? amount : Math.min(amount, effect.remaining === Infinity ? amount : Number(effect.remaining || 0));
      if (prevent <= 0) continue;
      amount -= prevent;
      preventedTotal += prevent;
      consumptions.push({ id: effect.id, amount: prevent, legacy: !!effect.legacy, shieldCounter: !!effect.shieldCounter, targetRef });
      next.preventionTrace.push({ id: effect.id, source: effect.source || null, amount: prevent, targetRef });
      if (effect.shieldCounter) break;
    }
    next.payload.amount = amount;
    next.payload.preventedAmount = Number(next.payload.preventedAmount || 0) + preventedTotal;
    next.payload.preventionConsumptions = [...(next.payload.preventionConsumptions || []), ...consumptions];
    return next;
  }

  _findEffect(id) {
    return this._stateEffects().find(effect => effect.id === id) || this.runtimeEffects.get(id) || null;
  }

  _deleteEffect(id) {
    const index = this._stateEffects().findIndex(effect => effect.id === id);
    if (index >= 0) this._stateEffects().splice(index, 1);
    this.runtimeEffects.delete(id);
  }

  commitConsumptions(payload) {
    for (const item of payload?.preventionConsumptions || []) {
      if (item.shieldCounter) {
        const target = this.engine.findPermanent(item.targetRef);
        if (Number(target?.counters?.shield || 0) > 0) {
          this.engine.events.dispatch(ENGINE_EVENT.REMOVE_COUNTER, { permanentId: target.instanceId, counterType: 'shield', amount: 1, playerId: target.controller }, { cause: 'shield-prevention', stabilize: false, skipReplacements: true });
        }
        continue;
      }
      if (item.legacy) {
        const target = this.engine.state.players[item.targetRef] || this.engine.findPermanent(item.targetRef);
        if (target) target.damagePrevention = Math.max(0, Number(target.damagePrevention || 0) - Number(item.amount || 0));
        continue;
      }
      const effect = this._findEffect(item.id);
      if (!effect) continue;
      if (effect.remaining !== Infinity) effect.remaining = Math.max(0, Number(effect.remaining || 0) - Number(item.amount || 0));
      if (effect.metadata?.mirrorLegacyField) {
        const target = this.engine.state.players[effect.targetRef] || this.engine.findPermanent(effect.targetRef);
        if (target) target.damagePrevention = Math.max(0, Number(target.damagePrevention || 0) - Number(item.amount || 0));
      }
      if (effect.remaining <= 0) this._deleteEffect(effect.id);
    }
  }

  snapshot() {
    return this._allEffects().map(effect => ({
      id: effect.id, targetRef: effect.targetRef, remaining: effect.remaining, source: structuredClone(effect.source), expires: structuredClone(effect.expires), metadata: structuredClone(effect.metadata)
    }));
  }
}
