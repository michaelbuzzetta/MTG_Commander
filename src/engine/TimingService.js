import { isType } from './utils.js';
import { STEP_DEFINITION, TURN_PHASE_GROUP } from '../turn/TurnStructure.js';
import { normalizeTimingPermission } from './TimingPermission.js';
import { TIMING_ACTION, TIMING_RELEVANT_ACTIONS, TIMING_SPEED, TimingError } from './TimingTypes.js';

const MAIN_PHASES = new Set(['PRECOMBAT_MAIN', 'POSTCOMBAT_MAIN']);

function abilityFingerprint(ability = {}) {
  if (ability.scriptAbilityId) return `script:${ability.scriptAbilityId}`;
  if (ability.id) return `id:${ability.id}`;
  const compact = {
    type: ability.type || null,
    sorcerySpeed: !!ability.sorcerySpeed,
    tap: !!ability.tap,
    cost: ability.cost || null,
    effect: ability.effect || null,
    targets: ability.targets || null,
    timing: ability.timing || null
  };
  return `shape:${JSON.stringify(compact)}`;
}

function typeForAction(action = {}) {
  if (['CAST_SPELL', 'CAST_COMMANDER'].includes(action.type)) return TIMING_ACTION.CAST;
  if (['ACTIVATE_ABILITY', 'ACTIVATE_MANA'].includes(action.type)) return TIMING_ACTION.ACTIVATE;
  if (action.type === 'PLAY_LAND') return TIMING_ACTION.PLAY_LAND;
  if (action.type === 'FORETELL_CARD') return TIMING_ACTION.FORETELL;
  if (action.type === 'ENCORE_CARD') return TIMING_ACTION.ENCORE;
  if (action.type === 'PASS_PRIORITY') return TIMING_ACTION.PASS_PRIORITY;
  if (action.type === 'LOOP_SHORTCUT') return TIMING_ACTION.LOOP_SHORTCUT;
  return null;
}

export class TimingService {
  constructor(engine) {
    this.engine = engine;
    this.sequence = 0;
    this.ensureState();
  }

  ensureState() {
    this.engine.state.timingUsage ||= [];
    this.engine.state.timingDiagnostics ||= [];
    return this.engine.state;
  }

  _phaseGroup() {
    const s = this.engine.state;
    return STEP_DEFINITION[s.phase]?.phaseGroup || s.turnPhaseGroup || null;
  }

  _currentIndex() {
    const s = this.engine.state;
    if (Number.isInteger(s.phaseIndex) && s.phaseIndex >= 0) return s.phaseIndex;
    return (s.turnSequence || []).findIndex(node => node.key === s.phase);
  }

  _boundaryIndex(boundary, { preferLast = false } = {}) {
    if (!boundary?.step) return null;
    const sequence = this.engine.state.turnSequence || [];
    const matches = [];
    sequence.forEach((node, index) => {
      if (node.key !== boundary.step) return;
      if (boundary.occurrence != null && Number(node.occurrence) !== Number(boundary.occurrence)) return;
      matches.push(index);
    });
    if (!matches.length) return null;
    return preferLast ? matches.at(-1) : matches[0];
  }

  _relativeBoundaryIndex(boundary, direction = 'before') {
    if (!boundary?.step) return null;
    const sequence = this.engine.state.turnSequence || [];
    const current = this._currentIndex();
    const matches = [];
    sequence.forEach((node, index) => {
      if (node.key !== boundary.step) return;
      if (boundary.occurrence != null && Number(node.occurrence) !== Number(boundary.occurrence)) return;
      matches.push(index);
    });
    if (!matches.length) return null;
    if (boundary.occurrence != null) return matches[0];
    if (direction === 'before') return matches.find(index => index >= current) ?? null;
    return [...matches].reverse().find(index => index <= current) ?? null;
  }

  _combatId() {
    const s = this.engine.state;
    if (this._phaseGroup() !== TURN_PHASE_GROUP.COMBAT) return null;
    const current = this._currentIndex();
    const sequence = s.turnSequence || [];
    let begin = -1;
    for (let index = Math.min(current, sequence.length - 1); index >= 0; index--) {
      if (sequence[index]?.key === 'BEGIN_COMBAT') { begin = index; break; }
      if (sequence[index]?.phaseGroup !== TURN_PHASE_GROUP.COMBAT && begin < 0) break;
    }
    const node = begin >= 0 ? sequence[begin] : null;
    return `${s.turn}:${node?.id || `combat:${current}`}`;
  }

  _diagnostic(kind, payload = {}) {
    this.ensureState();
    const row = {
      id: `timing-diagnostic-${++this.sequence}`,
      kind,
      turn: this.engine.state.turn,
      phase: this.engine.state.phase,
      priorityPlayer: this.engine.state.priorityPlayer,
      ...structuredClone(payload)
    };
    this.engine.state.timingDiagnostics.push(row);
    if (this.engine.state.timingDiagnostics.length > 250) this.engine.state.timingDiagnostics.splice(0, this.engine.state.timingDiagnostics.length - 250);
    return row;
  }

  _definitionFor(card, castFaceIndex = null) {
    if (!card?.cardId) return {};
    if (Number.isInteger(castFaceIndex) && this.engine._castDefinition) return this.engine._castDefinition(card, castFaceIndex);
    return this.engine.copy?.definitionForObject(card) || this.engine.db[card.cardId] || {};
  }

  _castContext(playerId, action) {
    const found = action.cardInstanceId ? this.engine.zones.find(action.cardInstanceId) : null;
    const card = found?.card || null;
    const definition = this._definitionFor(card, action.castFaceIndex);
    const mode = definition && action.mode ? this.engine._modeFor(definition, action.mode) : null;
    const castingOption = (definition?.castingOptions || []).find(option => option.castOption === action.castOption && (!option.fromZone || option.fromZone === (found?.zone || card?.zone))) || null;
    return {
      card,
      definition,
      mode,
      castingOption,
      zone: found?.zone || card?.zone || null,
      sourceObjectId: card?.gameObjectId || card?.instanceId || null,
      usageKey: `cast:${card?.gameObjectId || card?.instanceId || card?.cardId || 'unknown'}:${action.castFaceIndex ?? 'front'}:${action.mode || 'default'}`
    };
  }

  _abilityContext(playerId, action) {
    const source = action.permanentId ? this.engine.findPermanent(action.permanentId) : null;
    const ability = action.ability || null;
    const key = abilityFingerprint(ability || {});
    return {
      source,
      card: source,
      definition: this._definitionFor(source),
      ability,
      zone: source?.zone || 'battlefield',
      sourceObjectId: source?.gameObjectId || source?.instanceId || action.permanentId || null,
      abilityKey: key,
      usageKey: `ability:${source?.gameObjectId || source?.instanceId || action.permanentId || 'unknown'}:${key}`
    };
  }

  actionContext(playerId, action = {}) {
    const actionKind = typeForAction(action);
    if (!actionKind) return { actionKind: null, permission: null, usageKey: null };
    let context = { actionKind, usageKey: `${actionKind}:${playerId}` };
    if (actionKind === TIMING_ACTION.CAST) context = { ...context, ...this._castContext(playerId, action) };
    else if (actionKind === TIMING_ACTION.ACTIVATE) context = { ...context, ...this._abilityContext(playerId, action) };
    else if ([TIMING_ACTION.PLAY_LAND, TIMING_ACTION.FORETELL, TIMING_ACTION.ENCORE].includes(actionKind)) {
      const found = action.cardInstanceId ? this.engine.zones.find(action.cardInstanceId) : null;
      const card = found?.card || null;
      context = {
        ...context,
        card,
        definition: this._definitionFor(card),
        zone: found?.zone || card?.zone || null,
        sourceObjectId: card?.gameObjectId || card?.instanceId || null,
        usageKey: `${actionKind.toLowerCase()}:${card?.gameObjectId || card?.instanceId || card?.cardId || 'unknown'}`
      };
    }
    context.permission = this.permissionForAction(playerId, action, context);
    return context;
  }

  _hasInstantCastPermission(playerId, card, zone, definition) {
    const s = this.engine.state;
    const grants = (s.castingPermissions || []).filter(grant =>
      grant.playerId === playerId &&
      (!grant.cardId || grant.cardId === card?.cardId) &&
      (!grant.cardInstanceId || grant.cardInstanceId === card?.instanceId) &&
      (!grant.fromZone || grant.fromZone === zone) &&
      (grant.untilTurn == null || Number(grant.untilTurn) >= Number(s.turn))
    );
    if (grants.some(grant => ['any', 'flash', 'instant'].includes(String(grant.timing || '').toLowerCase()))) return true;
    if (this.engine.legality?.grantsCastTiming(playerId, card, zone)) return true;
    if (card && this.engine.static?.canCastAsFlash(playerId, card)) return true;
    if (this.engine.mechanics?.canCastAtInstantTiming(definition)) return true;
    return false;
  }

  permissionForAction(playerId, action = {}, prepared = null) {
    const actionKind = prepared?.actionKind || typeForAction(action);
    if (!actionKind) return null;
    let context = prepared;
    if (!context) {
      if (actionKind === TIMING_ACTION.CAST) context = { actionKind, ...this._castContext(playerId, action) };
      else if (actionKind === TIMING_ACTION.ACTIVATE) context = { actionKind, ...this._abilityContext(playerId, action) };
      else context = { actionKind, usageKey: `${actionKind}:${playerId}` };
    }

    if (actionKind === TIMING_ACTION.CAST) {
      const { card, definition = {}, mode, castingOption, zone } = context;
      let timing = castingOption?.timing ?? mode?.timing ?? definition.timing ?? null;
      let defaultSpeed = isType(definition, 'Instant') ? TIMING_SPEED.INSTANT : TIMING_SPEED.SORCERY;
      if (this._hasInstantCastPermission(playerId, card, zone, definition)) defaultSpeed = TIMING_SPEED.INSTANT;
      if (timing == null) return normalizeTimingPermission({ speed: defaultSpeed, source: 'card-type/default-cast-timing' });
      const normalized = normalizeTimingPermission(timing, { speed: defaultSpeed, source: 'card/mode-timing' });
      // A permission to cast as though the spell had flash relaxes only the
      // default speed. Explicit additional restrictions remain intact.
      if (defaultSpeed === TIMING_SPEED.INSTANT && normalized.speed === TIMING_SPEED.SORCERY && typeof timing !== 'object') {
        return normalizeTimingPermission({ ...normalized, speed: TIMING_SPEED.INSTANT, source: 'cast-timing-permission' });
      }
      return normalized;
    }

    if (actionKind === TIMING_ACTION.ACTIVATE) {
      const ability = context.ability || action.ability || {};
      const defaultSpeed = ability.sorcerySpeed ? TIMING_SPEED.SORCERY : (action.type === 'ACTIVATE_MANA' ? TIMING_SPEED.MANA : TIMING_SPEED.INSTANT);
      const declared = ability.timing == null ? { speed: defaultSpeed } : ability.timing;
      return normalizeTimingPermission(declared, { speed: defaultSpeed, source: 'ability-timing' });
    }

    if (actionKind === TIMING_ACTION.PLAY_LAND) return normalizeTimingPermission({ speed: TIMING_SPEED.SORCERY, source: 'land-special-action' });
    if (actionKind === TIMING_ACTION.FORETELL) return normalizeTimingPermission({ speed: TIMING_SPEED.SPECIAL, yourTurn: true, source: 'foretell-special-action' });
    if (actionKind === TIMING_ACTION.ENCORE) return normalizeTimingPermission({ speed: TIMING_SPEED.SORCERY, source: 'encore-activation' });
    return normalizeTimingPermission({ speed: TIMING_SPEED.SPECIAL, source: actionKind.toLowerCase() });
  }

  _usageCount(playerId, context, permission, scope) {
    this.ensureState();
    return this.engine.state.timingUsage.filter(row => {
      if (row.playerId !== playerId || row.usageKey !== context.usageKey) return false;
      if (scope === 'turn') return Number(row.turn) === Number(this.engine.state.turn);
      if (scope === 'combat') return row.combatId != null && row.combatId === this._combatId();
      return false;
    }).length;
  }

  _conditionHolds(permission, playerId, context) {
    if (permission.condition == null) return true;
    if (typeof permission.condition === 'boolean') return permission.condition;
    const runtime = this.engine.cardScripts?.runtime;
    if (!runtime?.condition) return false;
    return !!runtime.condition(permission.condition, {
      controller: playerId,
      source: context.source || context.card || null,
      card: context.card || null,
      ability: context.ability || null,
      action: context.action || null,
      variables: {}
    });
  }

  assess(playerId, action = {}, prepared = null) {
    if (!TIMING_RELEVANT_ACTIONS.has(action.type)) return Object.freeze({ allowed: true, permission: null, denials: [], context: prepared || null });
    const s = this.engine.state;
    const context = prepared || this.actionContext(playerId, action);
    const permission = context.permission || this.permissionForAction(playerId, action, context);
    const denials = [];
    const deny = (code, message) => denials.push({ code, message });

    if (permission.requiresPriority && s.priorityPlayer !== playerId) deny('NO_PRIORITY', 'Acting player does not have priority');
    if (permission.speed === TIMING_SPEED.SORCERY) {
      if (s.activePlayer !== playerId) deny('NOT_ACTIVE_PLAYER', 'Sorcery timing requires your turn');
      if (!MAIN_PHASES.has(s.phase)) deny('NOT_MAIN_PHASE', 'Sorcery timing requires one of your main phases');
      if ((s.stack || []).length !== 0) deny('STACK_NOT_EMPTY', 'Sorcery timing requires an empty stack');
    }
    if (permission.yourTurn && s.activePlayer !== playerId) deny('NOT_YOUR_TURN', 'This action may only be taken during your turn');
    if (permission.combatOnly && this._phaseGroup() !== TURN_PHASE_GROUP.COMBAT) deny('NOT_COMBAT', 'This action may only be taken during combat');
    if (permission.phases.length && !permission.phases.includes(s.phase)) deny('WRONG_STEP', `This action is only legal during ${permission.phases.join(', ')}`);
    if (permission.phaseGroups.length && !permission.phaseGroups.includes(this._phaseGroup())) deny('WRONG_PHASE_GROUP', `This action is only legal during ${permission.phaseGroups.join(', ')}`);

    const currentIndex = this._currentIndex();
    const before = this._relativeBoundaryIndex(permission.beforeStep, 'before');
    if (permission.beforeStep && (before == null || currentIndex >= before)) deny('TOO_LATE', `This action must be taken before ${permission.beforeStep.step}`);
    const after = this._relativeBoundaryIndex(permission.afterStep, 'after');
    if (permission.afterStep && (after == null || currentIndex <= after)) deny('TOO_EARLY', `This action must be taken after ${permission.afterStep.step}`);

    if (permission.notUsedSinceStep) {
      const boundary = this._relativeBoundaryIndex(permission.notUsedSinceStep, 'after');
      if (boundary != null) {
        const usedSince = this.engine.state.timingUsage.some(row =>
          row.playerId === playerId && row.usageKey === context.usageKey && Number(row.turn) === Number(s.turn) && Number(row.phaseIndex) >= boundary
        );
        if (usedSince) deny('USED_SINCE_STEP', permission.message || `This action cannot be used again after ${permission.notUsedSinceStep.step}`);
      }
    }

    if (permission.maxPerTurn != null && this._usageCount(playerId, context, permission, 'turn') >= permission.maxPerTurn) {
      deny('TURN_USAGE_EXHAUSTED', permission.message || `This action may be used only ${permission.maxPerTurn} time(s) each turn`);
    }
    if (permission.maxPerCombat != null) {
      const combatId = this._combatId();
      if (!combatId) deny('NOT_COMBAT_USAGE', 'A per-combat action may only be used during combat');
      else if (this._usageCount(playerId, context, permission, 'combat') >= permission.maxPerCombat) {
        deny('COMBAT_USAGE_EXHAUSTED', permission.message || `This action may be used only ${permission.maxPerCombat} time(s) each combat`);
      }
    }
    if (!this._conditionHolds(permission, playerId, { ...context, action })) deny('CUSTOM_CONDITION', permission.message || 'The timing condition for this action is not satisfied');

    return Object.freeze({ allowed: denials.length === 0, permission, denials: Object.freeze(denials), context });
  }

  validateAction(playerId, action = {}) {
    const result = this.assess(playerId, action);
    if (result.allowed) return result;
    const diagnostic = this._diagnostic('denied', {
      playerId,
      actionType: action.type,
      sourceObjectId: result.context?.sourceObjectId || null,
      usageKey: result.context?.usageKey || null,
      permission: result.permission,
      denials: result.denials
    });
    throw new TimingError(result.denials[0]?.message || 'Action is not legal at this time', diagnostic);
  }

  allowsSpell(playerId, card, zone, modeId = null, castFaceIndex = null, castOption = null) {
    const definition = this._definitionFor(card, castFaceIndex);
    const mode = modeId ? this.engine._modeFor(definition, modeId) : null;
    const action = { type: card?.isCommander && zone === 'command' ? 'CAST_COMMANDER' : 'CAST_SPELL', cardInstanceId: card?.instanceId, mode: modeId, ...(castOption ? { castOption } : {}), ...(Number.isInteger(castFaceIndex) ? { castFaceIndex } : {}) };
    const context = {
      actionKind: TIMING_ACTION.CAST,
      card,
      definition,
      mode,
      castingOption: (definition?.castingOptions || []).find(option => option.castOption === castOption && (!option.fromZone || option.fromZone === zone)) || null,
      zone,
      sourceObjectId: card?.gameObjectId || card?.instanceId || null,
      usageKey: `cast:${card?.gameObjectId || card?.instanceId || card?.cardId || 'unknown'}:${castFaceIndex ?? 'front'}:${modeId || 'default'}`
    };
    context.permission = this.permissionForAction(playerId, action, context);
    return this.assess(playerId, action, context).allowed;
  }

  allowsAbility(playerId, source, ability, { manaAbility = false } = {}) {
    const action = { type: manaAbility ? 'ACTIVATE_MANA' : 'ACTIVATE_ABILITY', permanentId: source?.instanceId, ability };
    const context = {
      actionKind: TIMING_ACTION.ACTIVATE,
      source,
      card: source,
      definition: this._definitionFor(source),
      ability,
      zone: source?.zone || 'battlefield',
      sourceObjectId: source?.gameObjectId || source?.instanceId || null,
      abilityKey: abilityFingerprint(ability || {}),
      usageKey: `ability:${source?.gameObjectId || source?.instanceId || 'unknown'}:${abilityFingerprint(ability || {})}`
    };
    context.permission = this.permissionForAction(playerId, action, context);
    return this.assess(playerId, action, context).allowed;
  }

  recordAction(playerId, action = {}, prepared = null) {
    if (!TIMING_RELEVANT_ACTIONS.has(action.type)) return null;
    const context = prepared || this.actionContext(playerId, action);
    const permission = context.permission || this.permissionForAction(playerId, action, context);
    if (permission?.maxPerTurn == null && permission?.maxPerCombat == null && !permission?.notUsedSinceStep) return null;
    this.ensureState();
    const row = {
      id: `timing-usage-${++this.sequence}`,
      turn: this.engine.state.turn,
      phase: this.engine.state.phase,
      phaseIndex: this._currentIndex(),
      combatId: this._combatId(),
      playerId,
      actionType: action.type,
      sourceObjectId: context.sourceObjectId || null,
      abilityKey: context.abilityKey || null,
      usageKey: context.usageKey,
      permission: structuredClone(permission)
    };
    this.engine.state.timingUsage.push(row);
    if (this.engine.state.timingUsage.length > 1000) this.engine.state.timingUsage.splice(0, this.engine.state.timingUsage.length - 1000);
    return row;
  }

  beginTurn() {
    this.ensureState();
    const turn = Number(this.engine.state.turn || 0);
    this.engine.state.timingUsage = this.engine.state.timingUsage.filter(row => Number(row.turn) >= turn - 1);
  }

  getDiagnostics() {
    this.ensureState();
    return structuredClone(this.engine.state.timingDiagnostics);
  }

  snapshot() {
    this.ensureState();
    return Object.freeze({
      turn: this.engine.state.turn,
      phase: this.engine.state.phase,
      phaseGroup: this._phaseGroup(),
      priorityPlayer: this.engine.state.priorityPlayer,
      combatId: this._combatId(),
      usage: structuredClone(this.engine.state.timingUsage),
      diagnostics: structuredClone(this.engine.state.timingDiagnostics)
    });
  }
}
