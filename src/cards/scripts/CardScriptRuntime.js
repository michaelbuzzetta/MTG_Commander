import { ZoneManager } from '../../engine/ZoneManager.js';
import { matchesTargetFilter } from '../../engine/choices/TargetFilter.js';
import { isType } from '../../engine/utils.js';

function resolveValue(expr, ctx = {}) {
  if (expr == null || typeof expr === 'number' || typeof expr === 'string' || typeof expr === 'boolean') return expr;
  if (typeof expr !== 'object') return expr;
  if (expr.variable) return ctx.vars?.[expr.variable];
  if (expr.xValue) return Number(ctx.xValue ?? ctx.mode?.xValue ?? 0);
  if (expr.eventField) return String(expr.eventField).split('.').reduce((value, key) => value?.[key], ctx.eventPayload);
  if (expr.sourcePower) return ctx.engine.static.derivedStats(ctx.engine.findPermanent(ctx.source?.instanceId) || ctx.source).power;
  if (expr.sourceToughness) return ctx.engine.static.derivedStats(ctx.engine.findPermanent(ctx.source?.instanceId) || ctx.source).toughness;
  if (expr.targetPower || expr.targetToughness || expr.targetManaValue) {
    const index = Number(expr.targetIndex || 0);
    const id = (ctx.targets || [])[index];
    const permanent = id ? ctx.engine.findPermanent(id) : null;
    if (!permanent) return 0;
    if (expr.targetPower) return ctx.engine.static.derivedStats(permanent).power;
    if (expr.targetToughness) return ctx.engine.static.derivedStats(permanent).toughness;
    return Number((ctx.engine.copy?.definitionForObject(permanent) || ctx.engine.db[permanent.cardId] || {}).manaValue || 0);
  }
  if (expr.controllerHandCount) return Number(ctx.engine.state.players[ctx.controller]?.hand?.length || 0);
  if (expr.controllerGraveyardCount) return Number(ctx.engine.state.players[ctx.controller]?.graveyard?.length || 0);
  if (expr.countSelector) return selectObjects(ctx.engine, ctx.controller, expr.countSelector, ctx).length;
  if (expr.multiply) return [].concat(expr.multiply).reduce((product, item) => product * Number(resolveValue(item, ctx) || 0), 1);
  if (expr.add) return [].concat(expr.add).reduce((sum, item) => sum + Number(resolveValue(item, ctx) || 0), 0);
  return expr;
}

function candidateFor(engine, card, zone, playerId = null) {
  const definition = engine.copy?.definitionForObject(card) || engine.db[card.cardId] || {};
  return { id: card.instanceId, kind: zone === 'battlefield' ? 'permanent' : 'card', zone, controller: card.controller, owner: card.owner || playerId, card, definition };
}

function selectObjects(engine, actorPid, selector = {}, ctx = {}) {
  const candidates = [];
  const kinds = [].concat(selector.kind || []);
  const wantsPlayers = kinds.includes('player') || kinds.includes('playerOrPermanent');
  if (wantsPlayers) {
    for (const playerId of engine.livingPlayerIds()) {
      const candidate = { id: playerId, kind: 'player', zone: null, controller: playerId, owner: playerId, player: engine.state.players[playerId], definition: {} };
      if (matchesTargetFilter(engine, actorPid, candidate, selector, { sourceObject: ctx.source })) candidates.push(candidate);
    }
  }
  const zones = [].concat(selector.zone || 'battlefield');
  for (const zone of zones) {
    if (zone === 'stack') {
      for (const item of engine.state.stack) {
        if (!item.card) continue;
        const candidate = candidateFor(engine, item.card, 'stack', item.card.owner);
        candidate.kind = 'spell';
        if (matchesTargetFilter(engine, actorPid, candidate, selector, { sourceObject: ctx.source })) candidates.push(candidate);
      }
      continue;
    }
    for (const [playerId, player] of Object.entries(engine.state.players)) {
      for (const card of player[zone] || []) {
        const candidate = candidateFor(engine, card, zone, playerId);
        if (matchesTargetFilter(engine, actorPid, candidate, selector, { sourceObject: ctx.source })) candidates.push(candidate);
      }
    }
  }
  return candidates;
}

function conditionHolds(engine, condition, ctx = {}) {
  if (condition == null) return true;
  if (typeof condition === 'boolean') return condition;
  if (condition.always != null) return !!condition.always;
  if (condition.not) return !conditionHolds(engine, condition.not, ctx);
  if (condition.and) return [].concat(condition.and).every(item => conditionHolds(engine, item, ctx));
  if (condition.or) return [].concat(condition.or).some(item => conditionHolds(engine, item, ctx));
  if (condition.variableExists) return ctx.vars?.[condition.variableExists] != null;
  if (condition.targetExists) return !!(ctx.targets || [])[Number(condition.targetExists.index || 0)];
  if (condition.sourceHasCounter) {
    const source = engine.findPermanent(ctx.source?.instanceId) || ctx.source;
    const spec = typeof condition.sourceHasCounter === 'string' ? { type: condition.sourceHasCounter, min: 1 } : condition.sourceHasCounter;
    return Number(source?.counters?.[spec.type] || 0) >= Number(spec.min || 1);
  }
  if (condition.controllerLifeAtMost != null) return Number(engine.state.players[ctx.controller]?.life || 0) <= Number(condition.controllerLifeAtMost);
  if (condition.controllerLifeAtLeast != null) return Number(engine.state.players[ctx.controller]?.life || 0) >= Number(condition.controllerLifeAtLeast);
  if (condition.controllerControls) {
    const spec = condition.controllerControls;
    const cards = engine.state.players[ctx.controller]?.battlefield || [];
    const min = Number(spec.min ?? 1);
    const count = cards.filter(card => {
      if (spec.other && card.instanceId === ctx.source?.instanceId) return false;
      if (spec.type && !engine.static.isType(card, spec.type)) return false;
      if (spec.subtype && !engine.static.hasSubtype(card, spec.subtype)) return false;
      return true;
    }).length;
    return count >= min;
  }
  if (condition.opponentControls) {
    const spec = condition.opponentControls;
    const min = Number(spec.min ?? 1);
    return engine.opponents(ctx.controller).some(playerId => {
      const cards = engine.state.players[playerId]?.battlefield || [];
      return cards.filter(card => {
        if (spec.type && !engine.static.isType(card, spec.type)) return false;
        if (spec.subtype && !engine.static.hasSubtype(card, spec.subtype)) return false;
        return true;
      }).length >= min;
    });
  }
  if (condition.eventFieldEquals) {
    const actual = resolveValue({ eventField: condition.eventFieldEquals.path }, ctx);
    return actual === condition.eventFieldEquals.value;
  }
  return false;
}

export class CardScriptRuntime {
  constructor(engine, { customHooks } = {}) { this.engine = engine; this.customHooks = customHooks; }

  resolveValue(expr, ctx = {}) { return resolveValue(expr, { engine: this.engine, ...ctx }); }
  select(selector, ctx = {}) { return selectObjects(this.engine, ctx.controller, selector, { engine: this.engine, ...ctx }); }
  condition(condition, ctx = {}) { return conditionHolds(this.engine, condition, { engine: this.engine, ...ctx }); }

  executeControl(effect, ctx = {}) {
    const e = this.engine;
    if (effect.type === 'scriptIf') {
      const branch = this.condition(effect.condition, ctx) ? effect.then : effect.otherwise;
      if (branch) e.effects.resolve(branch, ctx);
      return true;
    }
    if (effect.type === 'scriptForEach') {
      const matches = this.select(effect.selector || {}, ctx);
      for (const match of matches) {
        const childCtx = { ...ctx, vars: { ...(ctx.vars || {}), [effect.as]: match.id }, targets: [match.id] };
        e.effects.resolve(effect.effect, childCtx);
        if (e.state.pendingChoice) break;
      }
      return true;
    }
    if (effect.type === 'scriptRepeat') {
      const count = Math.max(0, Math.min(1000, Number(this.resolveValue(effect.times, ctx) || 0)));
      for (let i = 0; i < count; i++) {
        e.effects.resolve(effect.effect, { ...ctx, vars: { ...(ctx.vars || {}), repeatIndex: i } });
        if (e.state.pendingChoice) break;
      }
      return true;
    }
    if (effect.type === 'customHook') {
      return this.customHooks.execute(effect.hookId, effect.version, { engine: e, runtime: this, context: ctx }, effect.args || {});
    }
    return false;
  }

  discard(effect, ctx = {}) {
    const playerId = effect.player || ctx.controller;
    const player = this.engine.state.players[playerId];
    if (!player) return [];
    const amount = Math.max(0, Number(this.resolveValue(effect.amount ?? 1, ctx) || 0));
    const selected = (ctx.targets || []).map(id => ZoneManager.find(this.engine.state, id)).filter(found => found?.zone === 'hand' && found.card.owner === playerId).map(found => found.card);
    const cards = selected.length ? selected.slice(0, amount) : player.hand.slice(0, amount);
    for (const card of cards) this.engine._moveZoneNow(card, 'graveyard', card.owner);
    return cards;
  }

  mill(effect, ctx = {}) {
    const playerId = effect.player || ctx.controller;
    const player = this.engine.state.players[playerId];
    if (!player) return [];
    const amount = Math.max(0, Number(this.resolveValue(effect.amount ?? 1, ctx) || 0));
    const cards = player.library.slice(0, amount);
    for (const card of cards) this.engine._moveZoneNow(card, 'graveyard', card.owner);
    return cards;
  }

  tap(effect, ctx = {}) {
    const targets = (ctx.targets || []).map(id => this.engine.findPermanent(id)).filter(Boolean);
    for (const target of targets) this.engine.tapPermanent(target);
    return targets;
  }

  moveZone(effect, ctx = {}) {
    const ids = ctx.targets?.length ? ctx.targets : this.select(effect.selector || {}, ctx).map(item => item.id);
    const moved = [];
    for (const id of ids) {
      const found = ZoneManager.find(this.engine.state, id);
      if (!found?.card) continue;
      const destinationPlayer = effect.toPlayer === 'controller' ? ctx.controller : effect.toPlayer === 'owner' ? found.card.owner : (effect.toPlayer || found.card.owner);
      const result = this.engine._moveZoneNow(found.card, effect.toZone, destinationPlayer);
      if (result) moved.push(result);
    }
    return moved;
  }

  removeCounter(effect, ctx = {}) {
    const type = effect.counter || '+1/+1';
    const amount = Math.max(0, Number(this.resolveValue(effect.amount ?? 1, ctx) || 0));
    for (const id of ctx.targets || []) {
      const target = this.engine.findPermanent(id);
      if (target) this.engine.removeCounters(target, type, amount, target.controller);
    }
  }

  reveal(effect, ctx = {}) {
    const ids = ctx.targets?.length ? ctx.targets : this.select(effect.selector || {}, ctx).map(item => item.id);
    for (const id of ids) {
      const found = ZoneManager.find(this.engine.state, id);
      if (found?.card) this.engine.revealCard(found.card, { reason: effect.reason || 'script-reveal' });
    }
  }

  shuffle(effect, ctx = {}) {
    const playerId = effect.player || ctx.controller;
    return this.engine.shuffleLibrary(playerId, effect.reason || 'script-shuffle');
  }

  search(effect, ctx = {}) {
    const playerId = effect.player || ctx.controller;
    const selector = { ...(effect.selector || {}) };
    delete selector.zone;
    delete selector.owner;
    delete selector.controller;
    return this.engine.libraryOps.searchImmediate({
      searchingPlayerId: playerId,
      libraryOwnerId: effect.libraryOwnerId || playerId,
      filter: selector,
      minCount: Number(effect.min ?? (effect.optional ? 0 : 1)),
      maxCount: Math.max(0, Number(effect.max ?? effect.amount ?? 1)),
      destination: effect.toZone || 'hand',
      destinationPlayerId: effect.toPlayer || playerId,
      revealFound: !!effect.reveal,
      shuffleAfter: effect.shuffle !== false,
      tapped: !!effect.tapped,
      optional: !!effect.optional,
      reason: effect.reason || 'script-search'
    });
  }

  copy(effect, ctx = {}) {
    const index = Number(effect.index || 0);
    const targetId = ctx.targets?.[index] || (effect.selector ? this.select(effect.selector, ctx)[0]?.id : null);
    if (effect.what === 'spell' || effect.what === 'ability' || effect.zone === 'stack') {
      if (!targetId) return null;
      const found = ZoneManager.find(this.engine.state, targetId);
      const item = found?.zone === 'stack' ? found.stackItem : this.engine.stack.find(targetId);
      if (!item) return null;
      return this.engine.effects.queueSpellCopies(item, Number(effect.copies || effect.amount || 1), ctx.controller, {
        retargetAllowed: !!(effect.retargetAllowed ?? effect.chooseNewTargets)
      });
    }
    if (effect.what === 'permanent') {
      if (!targetId) return null;
      const copyToId = effect.copyTo === 'target' ? targetId : (effect.copyToId || ctx.source?.instanceId);
      if (!copyToId) throw new Error('Script permanent copy requires a source object to become the copy');
      return this.engine.copy.applyPermanentCopy(copyToId, targetId, {
        except: effect.except || effect.modifications || null,
        duration: effect.duration || 'indefinite',
        effectSourceInstanceId: effect.effectSourceInstanceId || null
      });
    }
    if (effect.what === 'token') {
      if (!targetId) return [];
      return this.engine.copy.createTokenCopy(ctx.controller, targetId, {
        amount: Number(effect.amount || 1),
        except: effect.except || effect.modifications || null,
        tapped: !!effect.tapped,
        attacking: !!effect.attacking,
        attackTarget: effect.attackTarget || null,
        sacrificeAtEndTurn: !!effect.sacrificeAtEndTurn,
        exileAtEndCombat: !!effect.exileAtEndCombat
      });
    }
    throw new Error(`Unsupported scripted copy kind ${effect.what || 'unknown'}`);
  }

  grantAbility(effect, ctx = {}) {
    for (const id of ctx.targets || []) {
      const target = this.engine.findPermanent(id);
      if (!target) continue;
      this.engine.continuous.register({
        sourceId: ctx.source?.instanceId || null,
        duration: effect.duration || 'until-end-of-turn',
        layer: 6,
        filter: { instanceId: target.instanceId },
        transform: { addAbilities: [structuredClone(effect.ability)] },
        metadata: { createdTurn: this.engine.state.turn, scripted: true, targetInstanceId: target.instanceId }
      });
    }
  }

  removeAbility(effect, ctx = {}) {
    for (const id of ctx.targets || []) {
      const target = this.engine.findPermanent(id);
      if (!target) continue;
      const remove = effect.abilityTypes || (effect.abilityType ? [effect.abilityType] : []);
      this.engine.continuous.register({
        sourceId: ctx.source?.instanceId || null,
        duration: effect.duration || 'until-end-of-turn', layer: 6,
        filter: { instanceId: target.instanceId }, transform: { removeAbilities: remove.length ? remove : true },
        metadata: { createdTurn: this.engine.state.turn, scripted: true, targetInstanceId: target.instanceId }
      });
    }
  }
}
