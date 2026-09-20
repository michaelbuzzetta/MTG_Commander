import { isType, hasSubtype } from './utils.js';

const BASIC_COLORS = new Set(['W', 'U', 'B', 'R', 'G']);
const COLOR_ALIASES = Object.freeze({
  white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G',
  w: 'W', u: 'U', b: 'B', r: 'R', g: 'G', colorless: 'C', c: 'C'
});

function relationMatches(engine, actorPid, candidatePid, relation, context = {}) {
  if (!relation) return true;
  if (engine.multiplayer?.matches) return engine.multiplayer.matches(relation, candidatePid, { actorPlayerId: actorPid, targetPlayerId: candidatePid, ...context });
  const normalized = String(relation).toLowerCase();
  if (normalized === 'you' || normalized === 'self' || normalized === 'controller') return candidatePid === actorPid;
  if (normalized === 'opponent') return candidatePid !== actorPid && !!engine.state.players[candidatePid] && !engine.state.players[candidatePid].lost;
  return true;
}

function normalizeColor(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  return COLOR_ALIASES[raw.toLowerCase()] || raw.toUpperCase();
}

function cardColors(definition = {}) {
  const raw = Array.isArray(definition.colors) && definition.colors.length
    ? definition.colors
    : (Array.isArray(definition.colorIdentity) ? definition.colorIdentity : []);
  const colors = new Set(raw.map(normalizeColor).filter(Boolean));
  if (!colors.size) colors.add('C');
  return colors;
}

function derivedTypeCheck(engine, candidate, type) {
  if (!candidate?.card) return false;
  return candidate.zone === 'battlefield'
    ? engine.static.isType(candidate.card, type)
    : isType(candidate.definition, type);
}

function derivedSubtypeCheck(engine, candidate, subtype) {
  if (!candidate?.card) return false;
  return candidate.zone === 'battlefield'
    ? engine.static.hasSubtype(candidate.card, subtype)
    : hasSubtype(candidate.definition, subtype);
}

function leafMatches(engine, actorPid, candidate, filter = {}, context = {}) {
  if (!filter || typeof filter !== 'object') return true;
  if (filter.kind) {
    const allowed = Array.isArray(filter.kind) ? filter.kind : [filter.kind];
    if (!allowed.map(String).includes(String(candidate.kind))) return false;
  }
  if (filter.zone) {
    const allowed = Array.isArray(filter.zone) ? filter.zone : [filter.zone];
    if (!allowed.includes(candidate.zone)) return false;
  }
  if (filter.controller && !relationMatches(engine, actorPid, candidate.controller ?? candidate.id, filter.controller, context)) return false;
  if (filter.owner && !relationMatches(engine, actorPid, candidate.owner ?? candidate.id, filter.owner, context)) return false;
  if (filter.player && !relationMatches(engine, actorPid, candidate.id, filter.player, context)) return false;

  if (filter.type && !derivedTypeCheck(engine, candidate, filter.type)) return false;
  if (Array.isArray(filter.types) && filter.types.length && !filter.types.some(type => derivedTypeCheck(engine, candidate, type))) return false;
  if (filter.allTypes && Array.isArray(filter.allTypes) && !filter.allTypes.every(type => derivedTypeCheck(engine, candidate, type))) return false;
  if (filter.subtype && !derivedSubtypeCheck(engine, candidate, filter.subtype)) return false;
  if (Array.isArray(filter.subtypes) && filter.subtypes.length && !filter.subtypes.some(type => derivedSubtypeCheck(engine, candidate, type))) return false;

  const definition = candidate.definition || {};
  const mv = Number(definition.manaValue || 0);
  if (filter.manaValue != null && mv !== Number(filter.manaValue)) return false;
  if (filter.manaValueMin != null && mv < Number(filter.manaValueMin)) return false;
  if (filter.manaValueMax != null && mv > Number(filter.manaValueMax)) return false;

  const colors = cardColors(definition);
  if (filter.color && !colors.has(normalizeColor(filter.color))) return false;
  if (Array.isArray(filter.colors) && filter.colors.length && !filter.colors.some(color => colors.has(normalizeColor(color)))) return false;
  if (Array.isArray(filter.allColors) && !filter.allColors.every(color => colors.has(normalizeColor(color)))) return false;
  if (filter.colorless === true && [...colors].some(color => BASIC_COLORS.has(color))) return false;

  const typeLine = String(definition.typeLine || '').toLowerCase();
  if (filter.legendary === true && !typeLine.includes('legendary')) return false;
  if (filter.legendary === false && typeLine.includes('legendary')) return false;
  if (filter.nonland && isType(definition, 'Land')) return false;
  if (filter.cardId && candidate.card?.cardId !== filter.cardId) return false;
  if (filter.name && String(definition.name || '').toLowerCase() !== String(filter.name).toLowerCase()) return false;
  if (filter.names && Array.isArray(filter.names) && !filter.names.some(name => String(definition.name || '').toLowerCase() === String(name).toLowerCase())) return false;

  if (filter.attacking === true && !candidate.card?.attacking) return false;
  if (filter.blocking === true && !candidate.card?.blocking) return false;
  if (filter.tapped === true && !candidate.card?.tapped) return false;
  if (filter.tapped === false && candidate.card?.tapped) return false;
  if (filter.hasCounter && Number(candidate.card?.counters?.[filter.hasCounter] || 0) <= 0) return false;
  if (filter.withoutCounter && Number(candidate.card?.counters?.[filter.withoutCounter] || 0) > 0) return false;
  if (filter.notSelf && context.sourceObject && candidate.card?.instanceId === context.sourceObject.instanceId) return false;

  if (typeof filter.predicate === 'function' && !filter.predicate({ engine, actorPid, candidate, context })) return false;
  return true;
}

export function matchesTargetFilter(engine, actorPid, candidate, filter, context = {}) {
  if (!filter) return true;
  if (Array.isArray(filter)) return filter.every(item => matchesTargetFilter(engine, actorPid, candidate, item, context));
  if (typeof filter !== 'object') return true;
  if (filter.and && ![].concat(filter.and).every(item => matchesTargetFilter(engine, actorPid, candidate, item, context))) return false;
  if (filter.or && ![].concat(filter.or).some(item => matchesTargetFilter(engine, actorPid, candidate, item, context))) return false;
  if (filter.not && matchesTargetFilter(engine, actorPid, candidate, filter.not, context)) return false;
  const { and: _and, or: _or, not: _not, ...leaf } = filter;
  return leafMatches(engine, actorPid, candidate, leaf, context);
}

export function and(...filters) { return { and: filters.filter(Boolean) }; }
export function or(...filters) { return { or: filters.filter(Boolean) }; }
export function not(filter) { return { not: filter }; }
