import { isType, hasSubtype } from './utils.js';
import { LEGALITY_OPERATION, LEGALITY_OPERATIONS, RULE_KIND, operationForAction } from './RuleTypes.js';
import { staxRulesForPermanent } from './StaxRuleAdapter.js';

const CAST_ACTIONS = new Set(['CAST_SPELL', 'CAST_COMMANDER']);

export class LegalityError extends Error {
  constructor(message, diagnostic = {}) {
    super(message);
    this.name = 'LegalityError';
    this.code = 'RULE_RESTRICTION';
    this.diagnostic = diagnostic;
  }
}

function normalizeRelation(value) {
  const relation = String(value || 'each-player').toLowerCase();
  if (['all', 'any', 'players', 'each', 'each-player', 'each player'].includes(relation)) return 'each-player';
  if (['you', 'controller', 'source-controller'].includes(relation)) return 'you';
  if (['opponent', 'opponents', 'each-opponent', 'each opponent'].includes(relation)) return 'opponent';
  return relation;
}

function normalizeKind(kind) {
  const value = String(kind || RULE_KIND.RESTRICTION).toLowerCase();
  if (!Object.values(RULE_KIND).includes(value)) throw new Error(`Unknown legality rule kind ${kind}`);
  return value;
}

function normalizeOperation(operation) {
  const value = String(operation || '').toUpperCase().replaceAll('-', '_').replaceAll(' ', '_');
  if (!LEGALITY_OPERATIONS.has(value)) throw new Error(`Unknown legality operation ${operation}`);
  return value;
}

function lowerSet(values = []) { return new Set(values.map(value => String(value).toLowerCase())); }

function objectCount(context = {}) {
  if (Array.isArray(context.objects)) return context.objects.length;
  if (Array.isArray(context.objectIds)) return context.objectIds.length;
  if (context.object || context.card || context.source) return 1;
  return Number(context.count || 0);
}

export class LegalityService {
  constructor(engine) {
    this.engine = engine;
    this.runtimeRules = new Map();
    this.diagnostics = [];
    this.sequence = 0;
    // Rule extraction from Oracle text/card scripts is immutable for a given
    // battlefield object + controller. Cache it so legal-action enumeration
    // does not repeatedly re-parse every stax permanent for every candidate.
    this._sourceRuleCache = new Map();
    this.ensureState();
  }


  _definitionFor(object, fallback = {}) {
    if (!object?.cardId) return fallback || {};
    return this.engine.copy?.definitionForObject(object) || this.engine.db[object.cardId] || fallback || {};
  }

  ensureState() {
    this.engine.state.legalityUsage ||= [];
    this.engine.state.legalityDiagnostics ||= [];
  }

  register(rule) {
    const normalized = this.normalizeRule(rule, { runtime: true });
    this.runtimeRules.set(normalized.id, normalized);
    return structuredClone(normalized);
  }

  unregister(ruleId) { return this.runtimeRules.delete(ruleId); }

  clearRuntimeRules() { this.runtimeRules.clear(); }

  invalidateSourceRules() { this._sourceRuleCache.clear(); }

  normalizeRule(rule = {}, extra = {}) {
    if (!rule || typeof rule !== 'object') throw new Error('Legality rule must be an object');
    const kind = normalizeKind(rule.kind);
    const operation = normalizeOperation(rule.operation);
    const id = String(rule.id || `legality-rule-${++this.sequence}`);
    const maxPerTurn = rule.maxPerTurn == null ? null : Number(rule.maxPerTurn);
    const maxObjects = rule.maxObjects == null ? null : Number(rule.maxObjects);
    const minObjects = rule.minObjects == null ? null : Number(rule.minObjects);
    const genericCost = rule.genericCost == null ? 0 : Number(rule.genericCost);
    const genericCostPerObject = rule.genericCostPerObject == null ? 0 : Number(rule.genericCostPerObject);
    if (maxPerTurn != null && (!Number.isInteger(maxPerTurn) || maxPerTurn < 0)) throw new Error('maxPerTurn must be a nonnegative integer');
    if (maxObjects != null && (!Number.isInteger(maxObjects) || maxObjects < 0)) throw new Error('maxObjects must be a nonnegative integer');
    if (minObjects != null && (!Number.isInteger(minObjects) || minObjects < 0)) throw new Error('minObjects must be a nonnegative integer');
    if (genericCost < 0 || genericCostPerObject < 0) throw new Error('Legality costs must be nonnegative');
    return Object.freeze({
      ...structuredClone(rule),
      ...extra,
      id,
      kind,
      operation,
      appliesTo: normalizeRelation(rule.appliesTo),
      maxPerTurn,
      maxObjects,
      minObjects,
      genericCost,
      genericCostPerObject,
      message: rule.message || null
    });
  }

  _battlefieldRules() {
    const out = [];
    const liveKeys = new Set();
    for (const player of Object.values(this.engine.state.players || {})) {
      for (const permanent of player.battlefield || []) {
        if (permanent.phasedOut) continue;
        const definition = this._definitionFor(permanent);
        const copyFingerprint = permanent.copyState?.timestamp || permanent.copyMetadata?.copiableValues?.sourceGameObjectId || '';
        const key = `${permanent.instanceId}|${permanent.cardId}|${permanent.controller}|${copyFingerprint}|${String(definition.oracleText || '')}`;
        liveKeys.add(key);
        let cached = this._sourceRuleCache.get(key);
        if (!cached) {
          cached = [];
          for (const raw of staxRulesForPermanent(this.engine, permanent)) {
            try { cached.push(this.normalizeRule(raw, { runtime: false })); } catch (error) {
              this._diagnostic('invalid-rule', { sourceId: permanent.instanceId, message: error.message, raw });
            }
          }
          this._sourceRuleCache.set(key, cached);
        }
        out.push(...cached);
      }
    }
    // Bound cache growth across long multiplayer games and control changes.
    for (const key of this._sourceRuleCache.keys()) if (!liveKeys.has(key)) this._sourceRuleCache.delete(key);
    return out;
  }

  _legacyCastPermissionRules() {
    const out = [];
    for (const [index, permission] of (this.engine.state.castingPermissions || []).entries()) {
      if (!permission) continue;
      out.push(this.normalizeRule({
        id: `legacy-cast-permission:${index}:${permission.cardId || '*'}:${permission.playerId || '*'}`,
        kind: RULE_KIND.PERMISSION,
        operation: LEGALITY_OPERATION.CAST,
        appliesTo: permission.playerId || 'each-player',
        cardId: permission.cardId || null,
        fromZone: permission.fromZone || null,
        timing: permission.timing || null,
        untilTurn: permission.untilTurn ?? null,
        message: 'Legacy casting permission'
      }, { runtime: false, sourceController: permission.playerId || null }));
    }
    return out;
  }

  activeRules(operation = null) {
    const rules = [...this.runtimeRules.values(), ...this._battlefieldRules(), ...this._legacyCastPermissionRules()];
    return rules.filter(rule => !operation || rule.operation === operation).filter(rule => rule.untilTurn == null || Number(rule.untilTurn) >= Number(this.engine.state.turn));
  }

  _relationMatches(rule, playerId) {
    const relation = normalizeRelation(rule.appliesTo);
    if (relation === 'each-player') return true;
    if (this.engine.state.players[relation]) return relation === playerId;
    if (relation === 'you') return !!rule.sourceController && rule.sourceController === playerId;
    if (relation === 'opponent') {
      if (!rule.sourceController) return false;
      return this.engine.multiplayer?.matches
        ? this.engine.multiplayer.matches('opponent', playerId, { actorPlayerId: rule.sourceController })
        : rule.sourceController !== playerId;
    }
    if (relation === 'active-player') return this.engine.state.activePlayer === playerId;
    if (relation === 'defending-player') return this.engine.state.combat?.currentDefender === playerId;
    return false;
  }

  _whenMatches(rule, playerId, context) {
    const when = rule.when || {};
    if (when.notOwnTurn && this.engine.state.activePlayer === playerId) return false;
    if (when.onlyOwnTurn && this.engine.state.activePlayer !== playerId) return false;
    if (when.phase && String(this.engine.state.phase) !== String(when.phase)) return false;
    if (when.targetPlayerIsSourceController) {
      const targets = new Set([context.targetPlayerId, ...(context.targetPlayerIds || [])].filter(Boolean));
      if (!rule.sourceController || !targets.has(rule.sourceController)) return false;
    }
    if (when.targetPlayerIsOpponentOfSource) {
      const targets = [context.targetPlayerId, ...(context.targetPlayerIds || [])].filter(Boolean);
      if (!targets.some(id => this.engine.multiplayer.matches('opponent', id, { actorPlayerId: rule.sourceController }))) return false;
    }
    return true;
  }

  _definitionFor(context = {}) {
    if (context.definition) return context.definition;
    const object = context.card || context.object || context.source || context.target || null;
    return object?.cardId ? this._definitionFor(object) : {};
  }

  _filterMatches(rule, playerId, context = {}) {
    const filter = rule.filter || {};
    const object = context.card || context.object || context.source || context.target || null;
    // Declaration actions carry multiple objects at once. A filtered rule is
    // applicable when at least one selected object matches; count-sensitive
    // rules later count only the matching subset.
    if (!object && Array.isArray(context.objects) && context.objects.length && Object.keys(filter).length) {
      return context.objects.some(candidate => this._filterMatches(rule, playerId, {
        ...context,
        objects: undefined,
        object: candidate,
        card: candidate,
        definition: candidate?.cardId ? this._definitionFor(candidate) : {}
      }));
    }
    const definition = this._definitionFor(context);
    if (rule.cardId && object?.cardId !== rule.cardId && definition?.id !== rule.cardId) return false;
    if (rule.fromZone && context.zone !== rule.fromZone) return false;
    if (Array.isArray(rule.fromZones) && rule.fromZones.length && !rule.fromZones.includes(context.zone)) return false;
    if (rule.topOnly && context.zone === 'library' && object) {
      const top = this.engine.state.players[playerId]?.library?.[0];
      if (!top || top.instanceId !== object.instanceId) return false;
    }
    if (filter.zone && context.zone !== filter.zone && object?.zone !== filter.zone) return false;
    if (filter.cardId && object?.cardId !== filter.cardId && definition?.id !== filter.cardId) return false;
    if (filter.type && !isType(definition, filter.type)) return false;
    if (filter.subtype && !hasSubtype(definition, filter.subtype)) return false;
    if (Array.isArray(filter.types) && filter.types.length && !filter.types.some(type => isType(definition, type))) return false;
    if (Array.isArray(filter.subtypes) && filter.subtypes.length && !filter.subtypes.some(type => hasSubtype(definition, type))) return false;
    if (filter.nonland && isType(definition, 'Land')) return false;
    if (filter.land && !isType(definition, 'Land')) return false;
    if (filter.basic && !/\bBasic\b/i.test(definition.typeLine || '')) return false;
    if (filter.nonbasic && /\bBasic\b/i.test(definition.typeLine || '')) return false;
    if (filter.controller === 'you' && object?.controller !== playerId) return false;
    if (filter.controller === 'opponent' && object?.controller === playerId) return false;
    if (filter.owner === 'you' && object?.owner !== playerId) return false;
    if (filter.owner === 'opponent' && object?.owner === playerId) return false;
    return true;
  }

  _applicable(rule, playerId, context = {}) {
    return this._relationMatches(rule, playerId) && this._whenMatches(rule, playerId, context) && this._filterMatches(rule, playerId, context);
  }

  _usageMatches(record, rule, playerId, operation, context) {
    if (record.turn !== this.engine.state.turn || record.playerId !== playerId || record.operation !== operation) return false;
    if (rule.cardId && record.cardId !== rule.cardId) return false;
    if (rule.filter?.cardId && record.cardId !== rule.filter.cardId) return false;
    if (rule.filter?.type && !record.types?.map(x => String(x).toLowerCase()).includes(String(rule.filter.type).toLowerCase())) return false;
    if (rule.filter?.subtype && !record.subtypes?.map(x => String(x).toLowerCase()).includes(String(rule.filter.subtype).toLowerCase())) return false;
    if (rule.fromZone && record.zone !== rule.fromZone) return false;
    return true;
  }

  usageCount(playerId, operation, rule = {}, context = {}) {
    this.ensureState();
    return this.engine.state.legalityUsage.filter(record => this._usageMatches(record, rule, playerId, operation, context)).reduce((sum, record) => sum + Number(record.count || 1), 0);
  }

  _denialForRestriction(rule, playerId, operation, context) {
    if (rule.maxPerTurn != null && this.usageCount(playerId, operation, rule, context) >= rule.maxPerTurn) {
      return rule.message || `Usage limit reached for ${operation}`;
    }
    const count = this._countForRule(rule, context, playerId);
    if (rule.maxObjects != null && count > rule.maxObjects) return rule.message || `Too many objects for ${operation}`;
    if (rule.kind === RULE_KIND.RESTRICTION && rule.maxPerTurn == null && rule.maxObjects == null && !rule.genericCost && !rule.genericCostPerObject) {
      return rule.message || `${operation} is prohibited by a rules restriction`;
    }
    return null;
  }

  _availableObjectCount(rule, playerId, operation, context = {}) {
    if (operation === LEGALITY_OPERATION.ATTACK) {
      return this.engine.combat.legalAttackers(playerId).filter(object => this._filterMatches(rule, playerId, {
        ...context,
        objects: undefined,
        object,
        card: object,
        definition: this._definitionFor(object)
      })).length;
    }
    if (operation === LEGALITY_OPERATION.BLOCK) {
      const candidates = new Set();
      for (const attackerId of this.engine.state.combat?.attackers || []) {
        for (const object of this.engine.combat.legalBlockers(playerId, attackerId) || []) {
          if (this._filterMatches(rule, playerId, {
            ...context,
            objects: undefined,
            object,
            card: object,
            definition: this._definitionFor(object)
          })) candidates.add(object.instanceId);
        }
      }
      return candidates.size;
    }
    return Number.POSITIVE_INFINITY;
  }

  _denialForRequirement(rule, playerId, operation, context) {
    const count = this._countForRule(rule, context, playerId);
    if (rule.minObjects != null && count < rule.minObjects) {
      // Magic requirements apply only when they can actually be satisfied.
      // For combat declarations, do not reject an empty/short declaration if
      // the required number of matching attackers/blockers is not legal.
      if (rule.ifAble !== false && [LEGALITY_OPERATION.ATTACK, LEGALITY_OPERATION.BLOCK].includes(operation)) {
        if (this._availableObjectCount(rule, playerId, operation, context) < rule.minObjects) return null;
      }
      return rule.message || `Not enough objects selected for ${rule.operation}`;
    }
    return null;
  }

  _countForRule(rule, context = {}, playerId = null) {
    let objects = Array.isArray(context.objects) ? context.objects : null;
    if (objects && Object.keys(rule.filter || {}).length && playerId) {
      objects = objects.filter(object => this._filterMatches(rule, playerId, {
        ...context,
        objects: undefined,
        object,
        card: object,
        definition: object?.cardId ? this._definitionFor(object) : {}
      }));
    }
    if (rule.when?.targetPlayerIsSourceController && objects) {
      return objects.filter(object => {
        const target = context.attackTargets?.[object.instanceId];
        if (!target) return false;
        const entity = this.engine.combat.defendingEntity(target, object.controller);
        const defendingPlayer = entity?.defendingPlayer || (this.engine.state.players[target] ? target : null);
        return defendingPlayer === rule.sourceController;
      }).length;
    }
    if (objects) return objects.length;
    return objectCount(context);
  }

  assess(operation, playerId, context = {}) {
    const op = normalizeOperation(operation);
    const applicable = this.activeRules(op).filter(rule => this._applicable(rule, playerId, context));
    const permissions = applicable.filter(rule => rule.kind === RULE_KIND.PERMISSION);
    const denials = [];
    let genericCost = 0;
    for (const rule of applicable) {
      if (rule.kind === RULE_KIND.RESTRICTION) {
        const message = this._denialForRestriction(rule, playerId, op, context);
        if (message) denials.push({ rule, message });
      } else if (rule.kind === RULE_KIND.REQUIREMENT) {
        const message = this._denialForRequirement(rule, playerId, op, context);
        if (message) denials.push({ rule, message });
      }
      if (rule.genericCost) genericCost += Number(rule.genericCost || 0);
      if (rule.genericCostPerObject) genericCost += Number(rule.genericCostPerObject || 0) * this._countForRule(rule, context, playerId);
    }
    const overriding = permissions.some(rule => rule.overridesRestrictions === true);
    const allowed = denials.length === 0 || overriding;
    return Object.freeze({
      allowed,
      operation: op,
      playerId,
      genericCost,
      rules: applicable.map(rule => rule.id),
      permissions: permissions.map(rule => rule.id),
      denials: denials.map(item => ({ ruleId: item.rule.id, sourceId: item.rule.sourceId || null, message: item.message }))
    });
  }

  _diagnostic(kind, detail) {
    this.ensureState();
    const row = {
      id: `legality-diagnostic-${++this.sequence}`,
      kind,
      turn: this.engine.state.turn,
      phase: this.engine.state.phase,
      ...structuredClone(detail)
    };
    this.diagnostics.push(row);
    this.engine.state.legalityDiagnostics.push(row);
    if (this.diagnostics.length > 200) this.diagnostics.splice(0, this.diagnostics.length - 200);
    if (this.engine.state.legalityDiagnostics.length > 200) this.engine.state.legalityDiagnostics.splice(0, this.engine.state.legalityDiagnostics.length - 200);
    return row;
  }

  assertOperation(operation, playerId, context = {}) {
    const result = this.assess(operation, playerId, context);
    if (result.allowed) return result;
    const diagnostic = this._diagnostic('denied', { operation: result.operation, playerId, denials: result.denials, context: this._safeContext(context) });
    throw new LegalityError(result.denials[0]?.message || `${result.operation} is not legal`, diagnostic);
  }

  allowsOperation(operation, playerId, context = {}) {
    const result = this.assess(operation, playerId, context);
    if (!result.allowed) this._diagnostic('prevented', { operation: result.operation, playerId, denials: result.denials, context: this._safeContext(context) });
    return result.allowed;
  }

  _safeContext(context = {}) {
    return {
      zone: context.zone || null,
      cardId: context.card?.cardId || context.object?.cardId || context.source?.cardId || context.target?.cardId || null,
      targetPlayerId: context.targetPlayerId || null,
      targetPlayerIds: [...(context.targetPlayerIds || [])],
      objectIds: [...(context.objectIds || context.objects?.map(object => object?.instanceId).filter(Boolean) || [])],
      count: objectCount(context)
    };
  }

  recordOperation(operation, playerId, context = {}) {
    this.ensureState();
    const op = normalizeOperation(operation);
    const object = context.card || context.object || context.source || null;
    const definition = object?.cardId ? this._definitionFor(object) : context.definition || {};
    const row = {
      id: `legality-usage-${++this.sequence}`,
      turn: this.engine.state.turn,
      phase: this.engine.state.phase,
      playerId,
      operation: op,
      count: Math.max(1, Number(context.count || (Array.isArray(context.objects) ? context.objects.length : 1))),
      cardId: object?.cardId || definition?.id || null,
      objectId: object?.instanceId || object?.gameObjectId || null,
      zone: context.zone || object?.zone || null,
      types: String(definition.typeLine || '').split(/[—-]/)[0].trim().split(/\s+/).filter(Boolean),
      subtypes: Array.isArray(definition.subtypes) ? [...definition.subtypes] : [],
      metadata: structuredClone(context.metadata || {})
    };
    this.engine.state.legalityUsage.push(row);
    if (this.engine.state.legalityUsage.length > 1000) this.engine.state.legalityUsage.splice(0, this.engine.state.legalityUsage.length - 1000);
    return row;
  }

  beginTurn() {
    this.ensureState();
    const currentTurn = Number(this.engine.state.turn || 0);
    this.engine.state.legalityUsage = this.engine.state.legalityUsage.filter(record => Number(record.turn) >= currentTurn - 1);
    this._diagnostic('usage-reset', { activePlayer: this.engine.state.activePlayer, currentTurn });
  }

  actionContext(playerId, action = {}) {
    const operation = operationForAction(action);
    if (!operation) return { operation: null, context: {} };
    if (operation === LEGALITY_OPERATION.CAST || operation === LEGALITY_OPERATION.PLAY_LAND) {
      const found = action.cardInstanceId ? this.engine.zones.find(action.cardInstanceId) : null;
      const card = found?.card || null;
      return { operation, context: { card, object: card, definition: card ? this._definitionFor(card) : null, zone: found?.zone || card?.zone || null } };
    }
    if (operation === LEGALITY_OPERATION.ACTIVATE_ABILITY) {
      const source = this.engine.findPermanent(action.permanentId);
      return { operation, context: { source, object: source, definition: source ? this._definitionFor(source) : null, ability: action.ability || null, zone: source?.zone || null } };
    }
    if (operation === LEGALITY_OPERATION.ATTACK) {
      const objects = (action.attackers || []).map(id => this.engine.findPermanent(id)).filter(Boolean);
      let attackTargets = structuredClone(action.attackTargets || {});
      if (objects.length) {
        try { attackTargets = this.engine.combat.normalizeAttackTargets(playerId, objects.map(object => object.instanceId), attackTargets); }
        catch { /* Core combat validation will provide the authoritative error. */ }
      }
      const targetPlayerIds = [...new Set(objects.map(object => {
        const target = attackTargets?.[object.instanceId];
        return target ? (this.engine.combat.defendingEntity(target, playerId)?.defendingPlayer || (this.engine.state.players[target] ? target : null)) : null;
      }).filter(Boolean))];
      return { operation, context: { objects, objectIds: objects.map(object => object.instanceId), attackTargets, targetPlayerIds, count: objects.length } };
    }
    if (operation === LEGALITY_OPERATION.BLOCK) {
      const ids = [...new Set(Object.values(action.blockers || {}).flatMap(value => Array.isArray(value) ? value : (value == null ? [] : [value])))];
      const objects = ids.map(id => this.engine.findPermanent(id)).filter(Boolean);
      return { operation, context: { objects, objectIds: ids, count: ids.length } };
    }
    return { operation, context: {} };
  }

  validateAction(playerId, action = {}) {
    const { operation, context } = this.actionContext(playerId, action);
    if (!operation) return Object.freeze({ allowed: true, operation: null, genericCost: 0, denials: [], rules: [], permissions: [] });
    const result = this.assertOperation(operation, playerId, context);
    if (result.genericCost > 0) {
      const lockedCost = this.lockedGenericCost(playerId, result.genericCost, `legality:${operation}`);
      const reservedSourceIds = operation === LEGALITY_OPERATION.ATTACK ? [...(context.objectIds || [])] : [];
      if (!this.engine.payments.canPayLockedCost(playerId, lockedCost, { context: { kind: 'rules-action-cost', operation }, reservedSourceIds })) {
        const diagnostic = this._diagnostic('unpayable-action-cost', { operation, playerId, genericCost: result.genericCost, context: this._safeContext(context) });
        throw new LegalityError(`Cannot pay the additional ${operation.toLowerCase()} cost of {${result.genericCost}}`, diagnostic);
      }
    }
    return result;
  }

  recordAction(playerId, action = {}, prepared = null) {
    const { operation, context } = prepared || this.actionContext(playerId, action);
    if (!operation) return null;
    // Attack/block declarations record one operation with a count; spell/land/
    // ability records preserve card/source identity for later filters.
    return this.recordOperation(operation, playerId, context);
  }

  lockedGenericCost(playerId, amount, source = 'legality') {
    const n = Math.max(0, Number(amount || 0));
    return Object.freeze({
      kind: 'locked-cost',
      playerId,
      source,
      finalManaCost: n ? `{${n}}` : '',
      variables: Object.freeze({}),
      nonManaCosts: Object.freeze([]),
      stages: Object.freeze({ rulesIncrease: n })
    });
  }

  actionAdditionalCost(playerId, action = {}) {
    const { operation, context } = this.actionContext(playerId, action);
    if (!operation) return 0;
    return Number(this.assess(operation, playerId, context).genericCost || 0);
  }

  payActionAdditionalCost(playerId, action = {}) {
    const amount = this.actionAdditionalCost(playerId, action);
    if (amount <= 0) return null;
    const operation = operationForAction(action);
    const lockedCost = this.lockedGenericCost(playerId, amount, `legality:${operation}`);
    const { context } = this.actionContext(playerId, action);
    const reservedSourceIds = operation === LEGALITY_OPERATION.ATTACK ? [...(context.objectIds || [])] : [];
    const plan = this.engine.payments.payLockedCost(playerId, lockedCost, { context: { kind: 'rules-action-cost', operation }, reservedSourceIds });
    if (!plan) throw new LegalityError(`Cannot pay the additional ${operation.toLowerCase()} cost of {${amount}}`);
    return plan;
  }

  castPermissions(playerId, card, zone) {
    const definition = card?.cardId ? this._definitionFor(card) : {};
    return this.activeRules(LEGALITY_OPERATION.CAST).filter(rule => rule.kind === RULE_KIND.PERMISSION && this._applicable(rule, playerId, { card, object: card, definition, zone }));
  }

  permitsCastFromZone(playerId, card, zone) {
    return this.castPermissions(playerId, card, zone).some(rule => !rule.fromZone || rule.fromZone === zone || (Array.isArray(rule.fromZones) && rule.fromZones.includes(zone)));
  }

  grantsCastTiming(playerId, card, zone) {
    return this.castPermissions(playerId, card, zone).some(rule => ['any', 'flash', 'instant'].includes(String(rule.timing || '').toLowerCase()));
  }

  additionalLandPlays(playerId) {
    return this.activeRules(LEGALITY_OPERATION.PLAY_LAND)
      .filter(rule => rule.kind === RULE_KIND.PERMISSION && this._applicable(rule, playerId, {}))
      .reduce((sum, rule) => sum + Math.max(0, Number(rule.additionalLandPlays || 0)), 0);
  }

  castableCardsFromPermissions(playerId) {
    const player = this.engine.state.players[playerId];
    if (!player) return [];
    const seen = new Set();
    const out = [];
    for (const zone of ['graveyard', 'exile', 'library']) {
      for (const card of player[zone] || []) {
        if (!this.permitsCastFromZone(playerId, card, zone)) continue;
        if (seen.has(card.instanceId)) continue;
        seen.add(card.instanceId);
        out.push({ card, zone });
      }
    }
    return out;
  }

  getDiagnostics() { return structuredClone(this.engine.state.legalityDiagnostics || []); }

  snapshot() {
    this.ensureState();
    return Object.freeze({
      activeRules: this.activeRules().map(rule => structuredClone(rule)),
      usage: structuredClone(this.engine.state.legalityUsage),
      diagnostics: structuredClone(this.engine.state.legalityDiagnostics)
    });
  }
}
