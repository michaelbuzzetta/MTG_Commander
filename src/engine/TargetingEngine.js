import { ZoneManager } from './ZoneManager.js';
import { isType, hasSubtype } from './utils.js';
import { matchesTargetFilter } from './choices/TargetFilter.js';
import { LEGALITY_OPERATION } from './legality/index.js';

const PLAYER_ZONES = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'];
const COLOR_NAMES = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };

function asSpecs(source) {
  const raw = source?.targets ?? source?.target;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function normalizedSpec(raw) {
  if (typeof raw === 'string') {
    const lower = raw.toLowerCase();
    if (lower === 'player') return { kind: 'player' };
    if (lower === 'creature') return { kind: 'permanent', type: 'Creature' };
    if (lower === 'permanent') return { kind: 'permanent' };
    if (lower === 'spell') return { kind: 'spell', zone: 'stack' };
    if (lower === 'spellorpermanent' || lower === 'spell-or-permanent') return { kind: 'spellOrPermanent' };
    if (lower === 'playerorpermanent' || lower === 'player-or-permanent') return { kind: 'playerOrPermanent' };
    return { kind: 'permanent', type: raw };
  }
  return { ...(raw || {}) };
}

function relationMatches(engine, actorPid, targetPid, relation, context = {}) {
  if (!relation) return true;
  if (engine.multiplayer?.matches) return engine.multiplayer.matches(relation, targetPid, { actorPlayerId: actorPid, targetPlayerId: targetPid, ...context });
  if (relation === 'you' || relation === 'self') return targetPid === actorPid;
  if (relation === 'opponent') return actorPid !== targetPid && !!engine.state.players[targetPid] && !engine.state.players[targetPid].lost;
  return true;
}

function sourceQualities(engine, sourceObject) {
  const def = sourceObject?.cardId ? (engine.copy?.definitionForObject(sourceObject) || engine.db[sourceObject.cardId]) : sourceObject;
  const manaCost = def?.manaCost || '';
  const colors = new Set();
  for (const [symbol, name] of Object.entries(COLOR_NAMES)) if (manaCost.includes(`{${symbol}}`)) colors.add(name);
  const typeLine = (def?.typeLine || '').toLowerCase();
  return { def, colors, typeLine };
}

export class TargetingEngine {
  constructor(engine) { this.engine = engine; }

  hasTargets(source) { return asSpecs(source).length > 0; }

  bounds(source) {
    const specs = asSpecs(source);
    if (!specs.length) return { min: 0, max: 0 };
    const first = normalizedSpec(specs[0]);
    const min = Number(source?.minTargets ?? first.minTargets ?? (source?.optionalTarget || first.optional ? 0 : specs.length));
    const max = Number(source?.maxTargets ?? first.maxTargets ?? specs.length);
    return { min: Math.max(0, min), max: Math.max(Math.max(0, min), max) };
  }

  specFor(source, index) {
    const specs = asSpecs(source);
    if (!specs.length) return null;
    return normalizedSpec(specs[this.specIndexFor(source, index)]);
  }

  specIndexFor(source, index) {
    const specs = asSpecs(source);
    if (!specs.length) return -1;
    return Math.min(Math.max(0, Number(index) || 0), specs.length - 1);
  }

  validateTargetMultiplicity(source, targetIds = []) {
    if (source?.allowDuplicateTargets) return true;
    const seenByClause = new Map();
    for (let index = 0; index < targetIds.length; index++) {
      const id = targetIds[index];
      const clause = this.specIndexFor(source, index);
      const seen = seenByClause.get(clause) || new Set();
      if (seen.has(id)) throw new Error('A single target clause cannot choose the same target more than once');
      seen.add(id);
      seenByClause.set(clause, seen);
    }
    return true;
  }

  validateTargets(actorPid, source, targetIds = [], context = {}) {
    const ids = Array.isArray(targetIds) ? targetIds : null;
    const { min, max } = this.bounds(source);
    if (!this.hasTargets(source)) {
      if (ids?.length) throw new Error('This action does not take targets');
      return true;
    }
    if (!ids || ids.length < min || ids.length > max) throw new Error(`Choose between ${min} and ${max} legal target${max === 1 ? '' : 's'}`);
    this.validateTargetMultiplicity(source, ids);
    for (let index = 0; index < ids.length; index++) this.validateTarget(actorPid, ids[index], this.specFor(source, index), { ...context, selectedTargets: ids });
    return true;
  }

  isLegalTarget(actorPid, targetId, spec, context = {}) {
    try { this.validateTarget(actorPid, targetId, normalizedSpec(spec), context); return true; }
    catch { return false; }
  }

  validateTarget(actorPid, targetId, rawSpec, context = {}) {
    const e = this.engine;
    const spec = normalizedSpec(rawSpec);
    const kind = spec.kind || 'permanent';
    const supportsPlayer = kind === 'player' || kind === 'playerOrPermanent' || kind === 'player-or-permanent';
    const isPlayer = !!e.state.players[targetId];

    if (isPlayer) {
      if (e.state.players[targetId].lost) throw new Error('An eliminated player cannot be targeted');
      if (!supportsPlayer) throw new Error('Target must be a card or permanent, not a player');
      if (!relationMatches(e, actorPid, targetId, spec.controller || spec.player, { ...context, sourceObject: context.sourceObject })) throw new Error('Illegal player relationship for this target');
      const playerCandidate = { id: targetId, kind: 'player', zone: null, controller: targetId, owner: targetId, player: e.state.players[targetId], definition: null, card: null };
      if (spec.filter && !matchesTargetFilter(e, actorPid, playerCandidate, spec.filter, context)) throw new Error('Player does not satisfy this target filter');
      if (typeof spec.predicate === 'function' && !spec.predicate({ engine: e, actorPid, targetId, player: e.state.players[targetId], context })) {
        throw new Error('Player does not satisfy this target restriction');
      }
      e.legality?.assertOperation(LEGALITY_OPERATION.TARGET, actorPid, {
        targetPlayerId: targetId,
        source: context.sourceObject || null,
        definition: context.sourceObject?.cardId ? (e.copy?.definitionForObject(context.sourceObject) || e.db[context.sourceObject.cardId]) : null
      });
      return { id: targetId, kind: 'player', player: e.state.players[targetId] };
    }

    if (kind === 'player') throw new Error('Target must be a player');
    const found = ZoneManager.find(e.state, targetId);
    if (!found) throw new Error('Target no longer exists');
    const target = found.card;
    const def = e.copy?.definitionForObject(target) || e.db[target.cardId];
    const merged = { ...(spec.filter || {}), ...spec };
    const supportsStack = kind === 'spell' || kind === 'spellOrPermanent' || kind === 'spell-or-permanent';
    const supportsBattlefield = kind !== 'spell';
    const zone = merged.zone || (kind === 'spell' ? 'stack' : null);

    if (zone && found.zone !== zone) throw new Error(`Target must be in ${zone}`);
    if (kind === 'spell' && found.zone !== 'stack') throw new Error('Target must be a spell on the stack');
    if ((kind === 'permanent' || kind === 'playerOrPermanent' || kind === 'player-or-permanent') && found.zone !== 'battlefield') {
      throw new Error('Target must be a permanent on the battlefield');
    }
    if ((kind === 'spellOrPermanent' || kind === 'spell-or-permanent') && !['battlefield','stack'].includes(found.zone)) throw new Error('Target must be a spell or permanent');
    if (found.zone === 'stack' && !supportsStack) throw new Error('This effect cannot target a spell');
    if (found.zone === 'battlefield' && !supportsBattlefield) throw new Error('This effect cannot target a permanent');
    if (!relationMatches(e, actorPid, target.controller, merged.controller, { ...context, sourceObject: context.sourceObject })) throw new Error('Illegal controller relationship for this target');
    if (!relationMatches(e, actorPid, target.owner, merged.owner, { ...context, sourceObject: context.sourceObject })) throw new Error('Illegal owner relationship for this target');
    if (merged.ownerFromTargetIndex != null) {
      const expectedOwner = context.selectedTargets?.[Number(merged.ownerFromTargetIndex)];
      if (!expectedOwner || !e.state.players[expectedOwner] || target.owner !== expectedOwner) throw new Error('Target card must be owned by the selected player');
    }
    if (merged.type && !(found.zone === 'battlefield' ? e.static.isType(target, merged.type) : isType(def, merged.type))) throw new Error(`Target must be ${merged.type}`);
    if (Array.isArray(merged.types) && merged.types.length && !merged.types.some(type => found.zone === 'battlefield' ? e.static.isType(target, type) : isType(def, type))) throw new Error(`Target must be one of: ${merged.types.join(', ')}`);
    if (merged.subtype && !(found.zone === 'battlefield' ? e.static.hasSubtype(target, merged.subtype) : hasSubtype(def, merged.subtype))) throw new Error(`Target must have subtype ${merged.subtype}`);
    if (Array.isArray(merged.subtypes) && merged.subtypes.length && !merged.subtypes.some(type => found.zone === 'battlefield' ? e.static.hasSubtype(target, type) : hasSubtype(def, type))) throw new Error(`Target must have one of these subtypes: ${merged.subtypes.join(', ')}`);
    if (merged.nonland && isType(def, 'Land')) throw new Error('Target must be nonland');
    if (merged.hasCounter && Number(target.counters?.[merged.hasCounter] || 0) <= 0) throw new Error(`Target must have a ${merged.hasCounter} counter`);
    if (merged.withoutCounter && Number(target.counters?.[merged.withoutCounter] || 0) > 0) throw new Error(`Target must not have a ${merged.withoutCounter} counter`);
    let manaValueMax = merged.manaValueMax;
    if (merged.manaValueMaxFromSourceCastMode) {
      const source = context.sourceObject?.instanceId ? (e.findPermanent(context.sourceObject.instanceId) || context.sourceObject) : context.sourceObject;
      const match = String(source?.castMode || '').match(/(?:kicker-|x-)(\d+)/);
      manaValueMax = match ? Number(match[1]) : -1;
    }
    if (manaValueMax != null && Number(def?.manaValue || 0) > Number(manaValueMax)) throw new Error('Target has too high a mana value');
    if (merged.cardId && target.cardId !== merged.cardId) throw new Error('Target is the wrong card');
    if (merged.notSelf && context.sourceObject?.instanceId === target.instanceId) throw new Error('Source cannot target itself');
    if (merged.attacking && !target.attacking) throw new Error('Target must be attacking');
    if (merged.powerLessThanSource) {
      const source = context.sourceObject?.instanceId ? e.findPermanent(context.sourceObject.instanceId) || context.sourceObject : context.sourceObject;
      if (!source || e.static.derivedStats(target).power >= e.static.derivedStats(source).power) throw new Error('Target must have lesser power than source');
    }

    if (found.zone === 'battlefield' && !context.ignoreProtection) this._validateProtection(actorPid, target, context.sourceObject);
    const filterCandidate = {
      id: targetId,
      kind: found.zone === 'battlefield' ? 'permanent' : (found.zone === 'stack' ? 'spell' : 'card'),
      zone: found.zone,
      controller: target.controller,
      owner: target.owner,
      card: target,
      definition: def
    };
    if (spec.filter && !matchesTargetFilter(e, actorPid, filterCandidate, spec.filter, { ...context, sourceObject: context.sourceObject })) {
      throw new Error('Target does not satisfy the composed target filter');
    }
    if (typeof merged.predicate === 'function' && !merged.predicate({ engine: e, actorPid, target, definition: def, context })) {
      throw new Error('Permanent does not satisfy this target restriction');
    }
    e.legality?.assertOperation(LEGALITY_OPERATION.TARGET, actorPid, {
      target,
      object: target,
      definition: def,
      zone: found.zone,
      targetPlayerId: target.controller || target.owner || null,
      source: context.sourceObject || null
    });
    return { id: targetId, kind: found.zone === 'battlefield' ? 'permanent' : 'card', card: target, zone: found.zone };
  }

  _validateProtection(actorPid, target, sourceObject) {
    return this.engine.mechanics.validateTargeting(actorPid, target, sourceObject);
  }

  getCandidates(actorPid, source, selected = [], context = {}) {
    const { max } = this.bounds(source);
    if (!this.hasTargets(source) || selected.length >= max) return [];
    const spec = this.specFor(source, selected.length);
    const candidates = [];
    const clause = this.specIndexFor(source, selected.length);
    const used = new Set(selected.filter((_, index) => this.specIndexFor(source, index) === clause));
    const kind = spec.kind || 'permanent';
    const supportsPlayer = ['player', 'playerOrPermanent', 'player-or-permanent'].includes(kind);
    const supportsCards = kind !== 'player';
    const supportsStack = ['spell', 'spellOrPermanent', 'spell-or-permanent'].includes(kind);

    if (supportsPlayer) {
      for (const id of this.engine.livingPlayerIds()) {
        if (!used.has(id) && this.isLegalTarget(actorPid, id, spec, { ...context, selectedTargets: selected })) candidates.push({ id, kind: 'player', player: this.engine.state.players[id] });
      }
    }

    if (supportsCards) {
      const requestedZone = spec.zone || (kind === 'spell' ? 'stack' : null);
      const zones = requestedZone ? [requestedZone] : (supportsStack ? ['battlefield','stack'] : ['battlefield']);
      for (const zone of zones) {
        if (zone === 'stack') {
          for (const item of this.engine.state.stack) {
            const card = item.card;
            if (!card || used.has(card.instanceId)) continue;
            if (this.isLegalTarget(actorPid, card.instanceId, spec, { ...context, selectedTargets: selected })) candidates.push({ id: card.instanceId, kind: 'spell', card, zone: 'stack' });
          }
          continue;
        }
        if (PLAYER_ZONES.includes(zone)) {
          const indexed = this.engine.performance?.zoneCandidates?.(zone)
            || Object.entries(this.engine.state.players).flatMap(([playerId, player]) => (player[zone] || []).map(card => ({ playerId, card })));
          for (const { card } of indexed) {
            if (!used.has(card.instanceId) && this.isLegalTarget(actorPid, card.instanceId, spec, { ...context, selectedTargets: selected })) {
              candidates.push({ id: card.instanceId, kind: zone === 'battlefield' ? 'permanent' : 'card', card, zone });
            }
          }
        }
      }
    }
    return candidates;
  }

  generateTargetSets(actorPid, source, context = {}, limit = 128) {
    if (!this.hasTargets(source)) return [[]];
    const { min, max } = this.bounds(source);
    const results = [];
    const visit = selected => {
      if (results.length >= limit) return;
      if (selected.length >= min) results.push([...selected]);
      if (selected.length >= max) return;
      for (const candidate of this.getCandidates(actorPid, source, selected, context)) {
        visit([...selected, candidate.id]);
        if (results.length >= limit) return;
      }
    };
    visit([]);
    return results;
  }

  recheckTargets(actorPid, source, targetIds = [], context = {}) {
    if (!this.hasTargets(source)) return { targeted: false, legalTargets: [], illegalTargets: [], allIllegal: false };
    const legalTargets = [];
    const illegalTargets = [];
    const resolutionTargets = [];
    targetIds.forEach((id, index) => {
      if (this.isLegalTarget(actorPid, id, this.specFor(source, index), { ...context, selectedTargets: targetIds })) {
        legalTargets.push(id);
        resolutionTargets.push(id);
      } else {
        illegalTargets.push(id);
        resolutionTargets.push(null);
      }
    });
    return {
      targeted: true,
      legalTargets,
      illegalTargets,
      resolutionTargets,
      allIllegal: targetIds.length > 0 && legalTargets.length === 0
    };
  }

  getWardCost(permanent) {
    return this.engine.mechanics.wardCost(permanent);
  }

  _normalizeWardCost(value) {
    return this.engine.mechanics.normalizeWardCost(value);
  }

  wardTriggersForTargets(actorPid, targetStackItemId, targetIds = []) {
    const results = [];
    for (const id of new Set(targetIds)) {
      const permanent = this.engine.findPermanent(id);
      if (!permanent || permanent.controller === actorPid) continue;
      const cost = this.getWardCost(permanent);
      if (!cost) continue;
      results.push({
        type: 'ward',
        controller: permanent.controller,
        source: permanent,
        payingPlayer: actorPid,
        targetStackItemId,
        protectedPermanentId: permanent.instanceId,
        cost
      });
    }
    return results;
  }
}
