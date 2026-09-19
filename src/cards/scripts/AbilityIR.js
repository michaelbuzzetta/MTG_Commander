export const CARD_SCRIPT_VERSION = 1;

export const ABILITY_KIND = Object.freeze({
  STATIC: 'static',
  ACTIVATED: 'activated',
  TRIGGERED: 'triggered',
  REPLACEMENT: 'replacement',
  SPELL: 'spell',
  CDA: 'characteristic'
});

export const ABILITY_KINDS = Object.freeze(new Set(Object.values(ABILITY_KIND)));

function clone(value, fallback = null) {
  return value == null ? fallback : structuredClone(value);
}

export function normalizeAbilityIR(input = {}, index = 0) {
  const kind = String(input.kind || input.type || '').trim().toLowerCase();
  if (!ABILITY_KINDS.has(kind)) throw new Error(`Unknown ability kind "${kind || '(missing)'}"`);
  return {
    id: input.id || `ability-${index + 1}`,
    kind,
    label: input.label || null,
    sourceZones: clone(input.sourceZones || input.sourceZone, null),
    event: clone(input.event, null),
    condition: clone(input.condition, null),
    interveningIf: clone(input.interveningIf, null),
    optional: !!input.optional,
    timing: clone(input.timing, null),
    cost: clone(input.cost, null),
    targets: clone(input.targets || input.target, null),
    minTargets: input.minTargets ?? null,
    maxTargets: input.maxTargets ?? null,
    filter: clone(input.filter, null),
    affectedFilter: clone(input.affectedFilter, null),
    replacement: clone(input.replacement, null),
    effect: clone(input.effect ?? input.effects, null),
    characteristic: clone(input.characteristic || input.derive, null),
    metadata: clone(input.metadata, {})
  };
}

export function createCardScript({ version = CARD_SCRIPT_VERSION, abilities = [], modes = [], metadata = {} } = {}) {
  return {
    version,
    abilities: abilities.map((ability, index) => normalizeAbilityIR(ability, index)),
    modes: structuredClone(modes || []),
    metadata: structuredClone(metadata || {})
  };
}
