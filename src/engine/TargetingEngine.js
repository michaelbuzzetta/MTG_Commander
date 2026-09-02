import { ZoneManager } from './ZoneManager.js';
import { isType, hasSubtype } from './utils.js';

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

function relationMatches(engine, actorPid, targetPid, relation) {
  if (!relation) return true;
  if (relation === 'you' || relation === 'self') return targetPid === actorPid;
  if (relation === 'opponent') return actorPid !== targetPid && !!engine.state.players[targetPid] && !engine.state.players[targetPid].lost;
  return true;
}

function sourceQualities(engine, sourceObject) {
  const def = sourceObject?.cardId ? engine.db[sourceObject.cardId] : sourceObject;
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
      if (!relationMatches(e, actorPid, targetId, spec.controller || spec.player)) throw new Error('Illegal player relationship for this target');
      if (typeof spec.predicate === 'function' && !spec.predicate({ engine: e, actorPid, targetId, player: e.state.players[targetId], context })) {
        throw new Error('Player does not satisfy this target restriction');
      }
      return { id: targetId, kind: 'player', player: e.state.players[targetId] };
    }

    if (kind === 'player') throw new Error('Target must be a player');
    const found = ZoneManager.find(e.state, targetId);
    if (!found) throw new Error('Target no longer exists');
    const target = found.card;
    const def = e.db[target.cardId];
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
    if (!relationMatches(e, actorPid, target.controller, merged.controller)) throw new Error('Illegal controller relationship for this target');
    if (!relationMatches(e, actorPid, target.owner, merged.owner)) throw new Error('Illegal owner relationship for this target');
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
    if (typeof merged.predicate === 'function' && !merged.predicate({ engine: e, actorPid, target, definition: def, context })) {
      throw new Error('Permanent does not satisfy this target restriction');
    }
    return { id: targetId, kind: found.zone === 'battlefield' ? 'permanent' : 'card', card: target, zone: found.zone };
  }

  _validateProtection(actorPid, target, sourceObject) {
    const e = this.engine;
    const keywords = e.static.derivedStats(target).keywords.map(k => String(k).trim().toLowerCase());
    if (keywords.includes('shroud')) throw new Error('Target has shroud');
    if (target.controller !== actorPid && keywords.includes('hexproof')) throw new Error('Target has hexproof');

    const qualities = sourceQualities(e, sourceObject);
    for (const keyword of keywords) {
      if (target.controller !== actorPid && keyword.startsWith('hexproof from ')) {
        const quality = keyword.slice('hexproof from '.length).trim();
        if (this._sourceMatchesQuality(qualities, quality)) throw new Error(`Target has hexproof from ${quality}`);
      }
      if (keyword.startsWith('protection from ')) {
        const quality = keyword.slice('protection from '.length).trim();
        if (quality === 'everything' || this._sourceMatchesQuality(qualities, quality)) throw new Error(`Target has protection from ${quality}`);
      }
    }
  }

  _sourceMatchesQuality(qualities, quality) {
    const q = quality.toLowerCase().replace(/s$/, '');
    if (qualities.colors.has(q)) return true;
    return qualities.typeLine.includes(q);
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
          for (const player of Object.values(this.engine.state.players)) {
            for (const card of player[zone]) {
              if (!used.has(card.instanceId) && this.isLegalTarget(actorPid, card.instanceId, spec, { ...context, selectedTargets: selected })) {
                candidates.push({ id: card.instanceId, kind: zone === 'battlefield' ? 'permanent' : 'card', card, zone });
              }
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
    if (!permanent || permanent.zone !== 'battlefield') return null;
    const e = this.engine;
    const def = e.db[permanent.cardId] || {};
    const explicit = def.wardCost ?? def.ward;
    const normalizedExplicit = this._normalizeWardCost(explicit);
    if (normalizedExplicit) return normalizedExplicit;

    for (const ability of def.abilities || []) {
      if (String(ability.type).toLowerCase() !== 'ward') continue;
      const cost = this._normalizeWardCost(ability.cost ?? ability.manaCost ?? ability.wardCost);
      if (cost) return cost;
    }

    const keywords = e.static.derivedStats(permanent).keywords.map(k => String(k).trim());
    for (const keyword of keywords) {
      const match = keyword.match(/^ward(?:\s*[—:-]?\s*(.+))?$/i);
      if (!match) continue;
      const cost = this._normalizeWardCost(match[1]);
      if (cost) return cost;
    }
    return null;
  }

  _normalizeWardCost(value) {
    if (value == null || value === '' || value === false) return null;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return { mana: `{${value}}`, life: 0 };
    if (typeof value === 'object') {
      const mana = value.mana || value.manaCost || '';
      const life = Number(value.life || 0);
      return (mana || life) ? { mana, life } : null;
    }
    const text = String(value).trim();
    if (!text) return null;
    const lifeMatch = text.match(/(?:pay\s+)?(\d+)\s+life/i);
    const mana = [...text.matchAll(/\{[^}]+\}/g)].map(x => x[0]).join('');
    const life = lifeMatch ? Number(lifeMatch[1]) : 0;
    return (mana || life) ? { mana, life } : null;
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
