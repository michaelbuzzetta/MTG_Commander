import { uid } from '../utils.js';
import { ENGINE_EVENT } from '../events/EventTypes.js';
import { DamageEvent } from './DamageEvent.js';

function sourceRef(source) {
  if (!source) return null;
  if (typeof source === 'string') return source;
  return source.instanceId || source.gameObjectId || source.id || null;
}

function serializableSpec(spec = {}) {
  const source = spec.source && typeof spec.source === 'object' ? structuredClone(spec.source) : spec.source || null;
  return {
    ...structuredClone({ ...spec, source: null, recipient: null, target: null }),
    source,
    targetPlayer: spec.targetPlayer || (typeof spec.recipient === 'string' ? null : spec.recipient?.objectKind === 'player' ? spec.recipient.id : null),
    targetId: spec.targetId || spec.target?.instanceId || spec.target?.gameObjectId || (spec.recipient?.instanceId || spec.recipient?.gameObjectId) || null
  };
}

export class DamageService {
  constructor(engine) { this.engine = engine; this.sequence = 0; }

  validatePayload(payload = {}) {
    if (!(Number(payload.amount) >= 0)) throw new Error('Damage amount must be nonnegative');
    const playerId = payload.targetPlayer;
    if (playerId) {
      if (!this.engine.state.players[playerId]) throw new Error(`Unknown player ${playerId}`);
      return true;
    }
    const id = payload.targetId || payload.target?.instanceId || payload.target?.gameObjectId || payload.target;
    if (!id || !this.engine.findPermanent(id)) throw new Error('Permanent is no longer on the battlefield');
    return true;
  }

  _enrichCommittedPayload(event, damage, consequence) {
    const p = event.payload;
    p.amount = damage.amount;
    p.dealtAmount = consequence.amount;
    p.preventedAmount = damage.preventedAmount;
    p.sourceController = damage.sourceController;
    p.sourceOwner = damage.sourceOwner;
    p.commanderIdentity = damage.commanderIdentity;
    p.combat = damage.combat;
    p.damageType = damage.damageType;
    p.damageProperties = structuredClone(damage.properties);
    p.parentEventId = damage.parentEventId;
    p.damageDealt = consequence.amount > 0;
    p.damageConsequence = consequence.kind;
    p.batchId = damage.batchId;
    p.batchIndex = damage.batchIndex;
    p.batchSize = damage.batchSize;
    if (damage.recipient.kind === 'player') {
      p.targetPlayer = damage.recipient.id;
      delete p.targetId;
      delete p.target;
    } else {
      p.targetId = damage.recipient.id;
      p.target = damage.recipientObject;
      delete p.targetPlayer;
    }
  }

  _applyPlayerDamage(damage) {
    const e = this.engine;
    const playerId = damage.recipient.id;
    const amount = damage.amount;
    if (amount > 0) {
      if (damage.properties.infect) {
        e.counters.addWithoutChoice(playerId, 'poison', amount, { source: damage.sourceSnapshot || damage.source, cause: 'infect-damage' });
      } else {
        e.events.dispatch(ENGINE_EVENT.LOSE_LIFE, { playerId, amount, source: damage.sourceSnapshot || damage.source }, { cause: 'damage', stabilize: false });
      }
    }
    return { kind: damage.properties.infect ? 'poison-counters' : 'life-loss', amount };
  }

  _applyPermanentDamage(damage) {
    const e = this.engine;
    const target = e.findPermanent(damage.recipient.id);
    if (!target) throw new Error('Damage recipient is no longer on the battlefield');
    const amount = damage.amount;
    let kind = 'marked-damage';
    if (e.static.isType(target, 'Planeswalker')) {
      const base = e.continuous.characteristics(target)?.loyalty;
      e.counters.ensureImplicitBaseCounter(target, 'loyalty', base);
      if (amount > 0) e.counters.removeWithoutChoice(target, 'loyalty', amount, { source: damage.sourceSnapshot || damage.source, cause: 'planeswalker-damage' });
      kind = 'loyalty-loss';
    } else if (e.static.isType(target, 'Battle')) {
      const base = e.continuous.characteristics(target)?.defense;
      e.counters.ensureImplicitBaseCounter(target, 'defense', base);
      if (amount > 0) e.counters.removeWithoutChoice(target, 'defense', amount, { source: damage.sourceSnapshot || damage.source, cause: 'battle-damage' });
      kind = 'defense-loss';
    } else if (e.static.isType(target, 'Creature') && (damage.properties.infect || damage.properties.wither)) {
      if (amount > 0) e.counters.addWithoutChoice(target, '-1/-1', amount, { source: damage.sourceSnapshot || damage.source, cause: damage.properties.infect ? 'infect-damage' : 'wither-damage' });
      kind = '-1/-1-counters';
    } else {
      target.damageMarked = Math.max(0, Number(target.damageMarked || 0)) + amount;
    }
    if (damage.properties.deathtouch && amount > 0 && e.static.isType(target, 'Creature')) target.deathtouchMarked = true;
    return { kind, amount, target };
  }

  _applyLinkedConsequences(damage, consequence) {
    const e = this.engine;
    const dealt = consequence.amount;
    if (!(dealt > 0)) return;
    if (damage.properties.lifelink && damage.sourceController && e.state.players[damage.sourceController] && !e.state.players[damage.sourceController].lost) {
      e.events.dispatch(ENGINE_EVENT.GAIN_LIFE, { playerId: damage.sourceController, amount: dealt, source: damage.sourceSnapshot || damage.source }, { cause: 'lifelink', stabilize: false });
    }
    if (damage.recipient.kind === 'player' && damage.combat && damage.commanderIdentity) {
      e.commanders.recordCombatDamageByIdentity(damage.recipient.id, damage.commanderIdentity, dealt);
    }
    if (damage.recipient.kind === 'player' && damage.combat && damage.sourceSnapshot) {
      e.emit('COMBAT_DAMAGE_PLAYER', {
        controller: damage.sourceController,
        source: damage.sourceSnapshot,
        object: damage.sourceSnapshot,
        amount: dealt,
        targetPlayer: damage.recipient.id,
        combat: true,
        damageEvent: damage.snapshot()
      });
    }
  }

  commitEvent(event) {
    const damage = DamageEvent.fromEngineEvent(this.engine, event);
    this.engine.prevention.commitConsumptions(event.payload);
    const consequence = damage.recipient.kind === 'player' ? this._applyPlayerDamage(damage) : this._applyPermanentDamage(damage);
    this._enrichCommittedPayload(event, damage, consequence);
    this._applyLinkedConsequences(damage, consequence);
    if (damage.recipient.kind === 'player' && !damage.batchId) this.engine.checkWinner();
    return {
      ...damage.snapshot(),
      // Preserve the pre-Step-26 result shape used by combat/replay consumers
      // while also exposing the normalized DamageEvent snapshot fields.
      source: damage.sourceSnapshot || damage.source || undefined,
      amount: consequence.amount,
      prevented: damage.preventedAmount,
      targetPlayer: damage.recipient.kind === 'player' ? damage.recipient.id : undefined,
      target: damage.recipient.kind === 'permanent' ? consequence.target : undefined,
      consequence: consequence.kind,
      shield: (event.payload.preventionConsumptions || []).some(item => item.shieldCounter)
    };
  }

  deal(spec = {}, options = {}) {
    if (!(Number(spec.amount) > 0)) return null;
    const payload = DamageEvent.request(this.engine, spec, options);
    const affectedPlayerId = payload.targetPlayer || this.engine.findPermanent(payload.targetId)?.controller || this.engine.findPermanent(payload.targetId)?.owner || null;
    return this.engine.replacements.dispatchWithChoice(ENGINE_EVENT.DEAL_DAMAGE, payload, {
      cause: options.cause || (payload.combat ? 'combat-damage' : 'damage'),
      stabilize: options.stabilize ?? false,
      affectedPlayerId,
      replacementOrder: options.replacementOrder || null
    });
  }

  _finalizeBatch(batch) {
    const e = this.engine;
    e.state.pendingDamageBatch = null;
    if (batch.emitType) e.emit(batch.emitType, { ...(batch.emitPayload || {}), batchId: batch.id, damageEvents: structuredClone(batch.results) });
    if (batch.stabilize) e.stateBasedActions();
    else e.checkWinner();
    e.emit('DAMAGE_BATCH', { batchId: batch.id, combat: !!batch.combat, count: batch.results.length, damageEvents: structuredClone(batch.results) });
    return { deferred: false, batchId: batch.id, results: structuredClone(batch.results) };
  }

  _runBatch(batch, { resumedResult = undefined } = {}) {
    const e = this.engine;
    return e._withDeferredTriggers(() => {
      if (resumedResult !== undefined) {
        batch.results.push(resumedResult);
        batch.index += 1;
      }
      while (batch.index < batch.specs.length) {
        const index = batch.index;
        const spec = batch.specs[index];
        const result = this.deal(spec, { batchId: batch.id, batchIndex: index, batchSize: batch.specs.length, cause: batch.cause, stabilize: false });
        if (result?.deferred) {
          e.state.pendingDamageBatch = structuredClone(batch);
          return { deferred: true, batchId: batch.id, index, applicable: result.applicable || [] };
        }
        batch.results.push(result);
        batch.index += 1;
      }
      return this._finalizeBatch(batch);
    });
  }

  resolveBatch(specs = [], { cause = 'damage-batch', stabilize = true, combat = false, emitType = null, emitPayload = null } = {}) {
    const normalized = (specs || []).filter(spec => Number(spec?.amount || 0) > 0).map(serializableSpec);
    const batch = {
      id: uid('damage-batch'),
      sequence: ++this.sequence,
      specs: normalized,
      index: 0,
      results: [],
      cause,
      stabilize: !!stabilize,
      combat: !!combat,
      emitType,
      emitPayload: emitPayload ? structuredClone(emitPayload) : null
    };
    if (!normalized.length) return this._finalizeBatch(batch);
    return this._runBatch(batch);
  }

  hasPendingBatch() { return !!this.engine.state.pendingDamageBatch; }

  resumePendingBatch(resolvedDamageResult) {
    const pending = this.engine.state.pendingDamageBatch;
    if (!pending) return null;
    const batch = structuredClone(pending);
    this.engine.state.pendingDamageBatch = null;
    return this._runBatch(batch, { resumedResult: resolvedDamageResult });
  }

  snapshot() {
    return this.engine.state.pendingDamageBatch ? structuredClone(this.engine.state.pendingDamageBatch) : null;
  }
}
