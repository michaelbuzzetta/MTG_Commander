import { ENGINE_EVENT } from '../events/EventTypes.js';
import { CounterStore, normalizeCounterType } from './CounterStore.js';
import { BUILTIN_COUNTER_SEMANTICS } from './CounterSemantics.js';

function positiveAmount(value, label = 'Counter amount') {
  const amount = Number(value);
  if (!(amount > 0)) throw new Error(`${label} must be positive`);
  return amount;
}

function unique(values) { return [...new Set(values)]; }

/**
 * Step 24 authoritative counter subsystem.
 *
 * Counter maps remain generic keyed collections, but all changes are committed
 * by ADD_COUNTER / REMOVE_COUNTER events so replacement effects, triggers,
 * diagnostics, replay metadata, and future mechanic hooks observe one path.
 */
export class CounterService {
  constructor(engine) {
    this.engine = engine;
    this.semanticHooks = new Map();
    this.registerSemantic('lore', {
      afterAdd: ({ target, prior, next }) => {
        if (target?.zone === 'battlefield' && this.engine.static?.hasSubtype(target, 'Saga')) {
          this.engine._queueSagaChapters(target, Math.max(prior + 1, Number(target.readAheadFloor || 1)), next);
        }
      }
    });
    this.registerSemantic('stun', {
      replaceUntap: ({ target }) => {
        if (!target || this.count(target, 'stun') <= 0) return false;
        this.engine.events.dispatch(ENGINE_EVENT.REMOVE_COUNTER, {
          objectId: target.instanceId || target.gameObjectId,
          counterType: 'stun',
          amount: 1,
          playerId: target.controller || target.owner,
          source: null,
          semantic: 'stun-untap-replacement'
        }, { cause: 'stun-counter-untap', stabilize: false });
        this.engine.log('STUN_COUNTER_PREVENTED_UNTAP', { permanentId: target.instanceId, controller: target.controller });
        return true;
      }
    });
  }

  registerSemantic(counterType, hooks = {}) {
    const type = normalizeCounterType(counterType);
    this.semanticHooks.set(type, { ...(this.semanticHooks.get(type) || {}), ...hooks });
    return type;
  }

  semantic(counterType) {
    const type = normalizeCounterType(counterType);
    return { ...(BUILTIN_COUNTER_SEMANTICS[type] || { category: 'generic' }), hooks: Object.keys(this.semanticHooks.get(type) || {}) };
  }

  resolveTarget(ref) {
    if (!ref) return null;
    if (typeof ref === 'string' && this.engine.state.players[ref]) return { kind: 'player', id: ref, target: this.engine.state.players[ref], playerId: ref };
    if (ref?.objectKind === 'player' && ref.id && this.engine.state.players[ref.id]) return { kind: 'player', id: ref.id, target: this.engine.state.players[ref.id], playerId: ref.id };
    const id = typeof ref === 'string' ? ref : (ref.instanceId || ref.gameObjectId || ref.id);
    const object = id ? this.engine._queryObject(id) : null;
    if (!object) return null;
    return { kind: 'object', id: object.instanceId || object.gameObjectId, target: object, playerId: object.controller || object.owner || null };
  }

  count(ref, counterType) {
    return CounterStore.count(this.resolveTarget(ref)?.target || ref, counterType);
  }

  has(ref, counterType) { return this.count(ref, counterType) > 0; }
  types(ref) { return CounterStore.types(this.resolveTarget(ref)?.target || ref); }
  entries(ref) { return CounterStore.entries(this.resolveTarget(ref)?.target || ref); }
  snapshot(ref) { return CounterStore.snapshot(this.resolveTarget(ref)?.target || ref); }

  _payloadFor(ref, counterType, amount, options = {}) {
    const resolved = this.resolveTarget(ref);
    if (!resolved) throw new Error('Counter target is no longer available');
    const payload = {
      counterType: normalizeCounterType(counterType),
      amount: positiveAmount(amount),
      playerId: options.playerId || resolved.playerId || null,
      source: options.source || null,
      sourceController: options.sourceController || options.source?.controller || null,
      reason: options.reason || options.cause || null
    };
    if (resolved.kind === 'player') payload.targetPlayer = resolved.id;
    else payload.objectId = resolved.id;
    return { resolved, payload };
  }

  add(ref, counterType, amount = 1, options = {}) {
    const { resolved, payload } = this._payloadFor(ref, counterType, amount, options);
    const affectedPlayerId = options.affectedPlayerId || resolved.playerId;
    return this.engine.replacements.dispatchWithChoice(ENGINE_EVENT.ADD_COUNTER, payload, {
      cause: options.cause || 'add-counter',
      stabilize: options.stabilize ?? false,
      affectedPlayerId,
      replacementOrder: options.replacementOrder || null
    });
  }

  remove(ref, counterType, amount = 1, options = {}) {
    const { resolved, payload } = this._payloadFor(ref, counterType, amount, options);
    const affectedPlayerId = options.affectedPlayerId || resolved.playerId;
    return this.engine.replacements.dispatchWithChoice(ENGINE_EVENT.REMOVE_COUNTER, payload, {
      cause: options.cause || 'remove-counter',
      stabilize: options.stabilize ?? false,
      affectedPlayerId,
      replacementOrder: options.replacementOrder || null
    });
  }

  addWithoutChoice(ref, counterType, amount = 1, options = {}) {
    const { payload } = this._payloadFor(ref, counterType, amount, options);
    return this.engine.events.dispatch(ENGINE_EVENT.ADD_COUNTER, payload, {
      cause: options.cause || 'add-counter', stabilize: options.stabilize ?? false,
      replacementOrder: options.replacementOrder || null, skipReplacements: options.skipReplacements === true
    });
  }

  removeWithoutChoice(ref, counterType, amount = 1, options = {}) {
    const { payload } = this._payloadFor(ref, counterType, amount, options);
    return this.engine.events.dispatch(ENGINE_EVENT.REMOVE_COUNTER, payload, {
      cause: options.cause || 'remove-counter', stabilize: options.stabilize ?? false,
      replacementOrder: options.replacementOrder || null, skipReplacements: options.skipReplacements === true
    });
  }

  validateEventPayload(payload = {}) {
    const ref = payload.targetPlayer || payload.objectId || payload.permanentId || payload.permanent || payload.object;
    if (!this.resolveTarget(ref)) throw new Error('Counter target is no longer available');
    positiveAmount(payload.amount);
    normalizeCounterType(payload.counterType);
    return true;
  }

  commitAdd(payload = {}) {
    const ref = payload.targetPlayer || payload.objectId || payload.permanentId || payload.permanent || payload.object;
    const resolved = this.resolveTarget(ref);
    if (!resolved) throw new Error('Counter target is no longer available');
    const type = normalizeCounterType(payload.counterType);
    const amount = positiveAmount(payload.amount);
    const result = CounterStore.addDirect(resolved.target, type, amount);
    this.engine.emit('COUNTERS_ADDED', {
      controller: resolved.playerId,
      target: resolved.kind === 'player' ? null : resolved.target,
      targetPlayer: resolved.kind === 'player' ? resolved.id : null,
      counterType: type,
      amount: result.added,
      source: payload.source || null
    });
    this.semanticHooks.get(type)?.afterAdd?.({ engine: this.engine, service: this, resolved, target: resolved.target, type, amount: result.added, prior: result.prior, next: result.next, payload });
    return result.added;
  }

  commitRemove(payload = {}) {
    const ref = payload.targetPlayer || payload.objectId || payload.permanentId || payload.permanent || payload.object;
    const resolved = this.resolveTarget(ref);
    if (!resolved) throw new Error('Counter target is no longer available');
    const type = normalizeCounterType(payload.counterType);
    const amount = positiveAmount(payload.amount);
    const result = CounterStore.removeDirect(resolved.target, type, amount);
    if (result.removed > 0) {
      this.engine.emit('COUNTERS_REMOVED', {
        controller: resolved.playerId,
        target: resolved.kind === 'player' ? null : resolved.target,
        targetPlayer: resolved.kind === 'player' ? resolved.id : null,
        counterType: type,
        amount: result.removed,
        source: payload.source || null
      });
      this.semanticHooks.get(type)?.afterRemove?.({ engine: this.engine, service: this, resolved, target: resolved.target, type, amount: result.removed, prior: result.prior, next: result.next, payload });
    }
    return result.removed;
  }

  move(fromRef, toRef, counterType, amount = 1, options = {}) {
    const available = this.count(fromRef, counterType);
    const requested = Math.min(available, Math.max(0, Number(amount || 0)));
    if (!requested) return { removed: 0, added: 0 };
    // A move is represented by two canonical counter events. The amount actually
    // removed is the maximum amount eligible to be added to the destination.
    const removed = this.removeWithoutChoice(fromRef, counterType, requested, { ...options, cause: options.cause || 'move-counter-remove' });
    if (!(Number(removed) > 0)) return { removed: Number(removed || 0), added: 0 };
    const added = this.addWithoutChoice(toRef, counterType, Number(removed), { ...options, cause: options.cause || 'move-counter-add' });
    return { removed: Number(removed || 0), added: Number(added || 0) };
  }

  double(ref, counterType, options = {}) {
    const amount = this.count(ref, counterType);
    if (!amount) return 0;
    return this.add(ref, counterType, amount, { ...options, cause: options.cause || 'double-counters' });
  }

  wouldUntap(permanent) {
    for (const [type, hooks] of this.semanticHooks) {
      if (this.count(permanent, type) <= 0 || typeof hooks.replaceUntap !== 'function') continue;
      if (hooks.replaceUntap({ engine: this.engine, service: this, target: permanent, type })) return true;
    }
    return false;
  }

  ensureEntryCounters(permanent) {
    if (!permanent || permanent.zone !== 'battlefield') return;
    const chars = this.engine.continuous?.characteristics(permanent);
    if (this.engine.static?.isType(permanent, 'Planeswalker') && this.count(permanent, 'loyalty') <= 0 && chars?.loyalty != null && Number(chars.loyalty) > 0) {
      this.addWithoutChoice(permanent, 'loyalty', Number(chars.loyalty), { cause: 'planeswalker-entry-loyalty' });
    }
    if (this.engine.static?.isType(permanent, 'Battle') && this.count(permanent, 'defense') <= 0 && chars?.defense != null && Number(chars.defense) > 0) {
      this.addWithoutChoice(permanent, 'defense', Number(chars.defense), { cause: 'battle-entry-defense' });
    }
    if (this.engine.static?.hasSubtype(permanent, 'Saga') && this.count(permanent, 'lore') <= 0) {
      const definition = this.engine.db[permanent.cardId] || {};
      // Read Ahead replaces the ordinary one-lore-counter entry with a chosen
      // chapter. The UI/API may call chooseReadAheadChapter before the first
      // priority pass; ordinary Sagas enter with one lore counter immediately.
      if (definition.readAhead) permanent.readAheadPending = true;
      else this.add(permanent, 'lore', 1, { cause: 'saga-entry-lore' });
    }
  }

  ensureImplicitBaseCounter(permanent, counterType, baseAmount) {
    if (!permanent || this.count(permanent, counterType) > 0 || !(Number(baseAmount) > 0)) return this.count(permanent, counterType);
    this.addWithoutChoice(permanent, counterType, Number(baseAmount), { cause: 'legacy-counter-bootstrap', skipReplacements: true });
    return this.count(permanent, counterType);
  }

  proliferateCandidates() {
    const out = [];
    for (const [playerId, player] of Object.entries(this.engine.state.players)) {
      if (this.types(player).length) out.push(playerId);
      for (const permanent of player.battlefield || []) if (!permanent.phasedOut && this.types(permanent).length) out.push(permanent.instanceId);
    }
    return out;
  }

  beginProliferate(playerId, after = null) {
    const eligibleIds = this.proliferateCandidates();
    const continuation = after ? { ...structuredClone(after), controller: after.controller || playerId } : null;
    this.engine.state.pendingChoice = {
      type: 'PROLIFERATE', playerId, eligibleIds, after: continuation,
      resume: this.engine.state.phase === 'CLEANUP' ? 'CLEANUP' : 'PRIORITY'
    };
    this.engine.state.priorityPlayer = playerId;
    return eligibleIds;
  }

  chooseProliferate(playerId, targetIds = []) {
    const choice = this.engine.state.pendingChoice;
    if (!choice || choice.type !== 'PROLIFERATE' || choice.playerId !== playerId) throw new Error('No proliferate choice is pending');
    const selected = unique(targetIds);
    if (selected.some(id => !choice.eligibleIds.includes(id))) throw new Error('Proliferate can select only players/permanents that currently have counters');
    this.engine.state.pendingChoice = null;
    this.engine.state.lastProliferatedIds = [...selected];
    this.engine.state.afterProliferate = choice.after ? structuredClone(choice.after) : null;
    const queue = [];
    for (const id of selected) {
      const resolved = this.resolveTarget(id);
      if (!resolved) continue;
      for (const type of this.types(resolved.target)) {
        queue.push(resolved.kind === 'player'
          ? { kind: 'player', playerId: resolved.id, counterType: type }
          : { kind: 'object', objectId: resolved.id, counterType: type });
      }
    }
    this.engine.state.pendingProliferateQueue = queue;
    this.continueProliferate();
    return selected;
  }

  continueProliferate() {
    const state = this.engine.state;
    const queue = state.pendingProliferateQueue;
    if (!queue) return;
    while (queue.length && !state.pendingChoice) {
      const item = queue.shift();
      const ref = item.kind === 'player' ? item.playerId : item.objectId;
      if (this.count(ref, item.counterType) <= 0) continue;
      const result = this.add(ref, item.counterType, 1, { cause: 'proliferate', source: state.afterProliferate?.source || null });
      if (result?.deferred) break;
    }
    if (!queue.length && !state.pendingChoice) {
      delete state.pendingProliferateQueue;
      const after = state.afterProliferate;
      delete state.afterProliferate;
      if (after?.type === 'phaseOutProliferated') {
        const controller = after.player || after.controller || state.priorityPlayer || state.activePlayer;
        const eligibleIds = (state.lastProliferatedIds || []).filter(id => {
          const permanent = this.engine.findPermanent(id);
          return permanent?.controller === controller;
        });
        delete state.lastProliferatedIds;
        if (eligibleIds.length) {
          state.pendingChoice = { type: 'PHASE_OUT_PROLIFERATED', playerId: controller, eligibleIds, resume: state.phase === 'CLEANUP' ? 'CLEANUP' : 'PRIORITY' };
          state.priorityPlayer = controller;
          return;
        }
      } else if (after) this.engine.effects.resolve(after, { controller: state.priorityPlayer || state.activePlayer });
      else delete state.lastProliferatedIds;
    }
  }
}
