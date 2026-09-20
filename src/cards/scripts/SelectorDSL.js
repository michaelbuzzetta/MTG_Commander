const LEAF_KEYS = new Set([
  'kind','zone','controller','owner','player','type','types','allTypes','subtype','subtypes',
  'manaValue','manaValueMin','manaValueMax','color','colors','allColors','colorless','legendary',
  'nonland','cardId','name','names','attacking','blocking','tapped','hasCounter','withoutCounter',
  'notSelf','self','other','attachedToSource','fromZone','toZone','counterType','minTargets','maxTargets','optional','allowDuplicateTargets'
]);
const BOOLEAN_KEYS = new Set(['and','or','not']);
const VALID_ZONES = new Set(['library','hand','battlefield','graveyard','exile','command','stack']);
const VALID_KINDS = new Set(['player','permanent','card','spell','spellOrPermanent','playerOrPermanent']);

function pathError(path, message) { return { path, message }; }

function validateNode(selector, path, diagnostics) {
  if (selector == null) return;
  if (Array.isArray(selector)) {
    selector.forEach((item, index) => validateNode(item, `${path}[${index}]`, diagnostics));
    return;
  }
  if (typeof selector !== 'object') {
    diagnostics.push(pathError(path, 'selector must be an object'));
    return;
  }
  for (const key of Object.keys(selector)) {
    if (!LEAF_KEYS.has(key) && !BOOLEAN_KEYS.has(key)) diagnostics.push(pathError(`${path}.${key}`, `unknown selector field "${key}"`));
  }
  if (selector.kind && ![].concat(selector.kind).every(kind => VALID_KINDS.has(String(kind)))) diagnostics.push(pathError(`${path}.kind`, 'unsupported selector kind'));
  if (selector.zone && ![].concat(selector.zone).every(zone => VALID_ZONES.has(String(zone)))) diagnostics.push(pathError(`${path}.zone`, 'unsupported zone'));
  if (selector.manaValueMin != null && selector.manaValueMax != null && Number(selector.manaValueMin) > Number(selector.manaValueMax)) diagnostics.push(pathError(path, 'manaValueMin cannot exceed manaValueMax'));
  if (selector.minTargets != null && selector.maxTargets != null && Number(selector.minTargets) > Number(selector.maxTargets)) diagnostics.push(pathError(path, 'minTargets cannot exceed maxTargets'));
  if (selector.and) [].concat(selector.and).forEach((item, index) => validateNode(item, `${path}.and[${index}]`, diagnostics));
  if (selector.or) [].concat(selector.or).forEach((item, index) => validateNode(item, `${path}.or[${index}]`, diagnostics));
  if (selector.not) validateNode(selector.not, `${path}.not`, diagnostics);
}

export function validateSelector(selector, { path = 'selector' } = {}) {
  const diagnostics = [];
  validateNode(selector, path, diagnostics);
  return diagnostics;
}

export function normalizeSelector(selector = null) {
  if (!selector) return null;
  if (typeof selector === 'string') {
    const value = selector.trim();
    if (value.toLowerCase() === 'player') return { kind: 'player' };
    if (value.toLowerCase() === 'creature') return { kind: 'permanent', type: 'Creature' };
    if (value.toLowerCase() === 'permanent') return { kind: 'permanent' };
    if (value.toLowerCase() === 'spell') return { kind: 'spell', zone: 'stack' };
    return { kind: 'permanent', type: value };
  }
  const result = structuredClone(selector);
  if (!result.kind && result.zone === 'stack') result.kind = 'spell';
  if (!result.kind && ['library','hand','graveyard','exile','command'].includes(result.zone)) result.kind = 'card';
  if (!result.kind) result.kind = 'permanent';
  return result;
}

export function selectorToTargetSpec(selector, { minTargets = null, maxTargets = null, optional = false } = {}) {
  const normalized = normalizeSelector(selector) || { kind: 'permanent' };
  const spec = { ...normalized, filter: structuredClone(normalized) };
  if (minTargets != null) spec.minTargets = Number(minTargets);
  if (maxTargets != null) spec.maxTargets = Number(maxTargets);
  if (optional) spec.optional = true;
  return spec;
}

export const SELECTOR_DSL_FIELDS = Object.freeze([...LEAF_KEYS, ...BOOLEAN_KEYS]);
