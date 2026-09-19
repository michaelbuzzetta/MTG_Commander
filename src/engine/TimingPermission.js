import { TIMING_SPEED } from './TimingTypes.js';

const KNOWN_SPEEDS = new Set(Object.values(TIMING_SPEED));
const INSTANT_ALIASES = new Set(['instant', 'flash', 'any']);

function list(value) {
  if (value == null) return [];
  return Array.isArray(value) ? [...value] : [value];
}

function normalizedStepBoundary(value) {
  if (value == null) return null;
  if (typeof value === 'string') return { step: value, occurrence: null };
  if (typeof value === 'object' && value.step) {
    return { step: String(value.step), occurrence: value.occurrence == null ? null : Number(value.occurrence) };
  }
  return null;
}

export function normalizeTimingPermission(input, defaults = {}) {
  let raw = input;
  if (raw == null) raw = {};
  if (typeof raw === 'string') {
    const lower = raw.trim().toLowerCase();
    raw = { speed: INSTANT_ALIASES.has(lower) ? TIMING_SPEED.INSTANT : lower };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) raw = {};

  let speed = String(raw.sorcerySpeed ? TIMING_SPEED.SORCERY : (raw.speed || raw.kind || defaults.speed || TIMING_SPEED.INSTANT)).toLowerCase();
  if (INSTANT_ALIASES.has(speed)) speed = TIMING_SPEED.INSTANT;
  if (!KNOWN_SPEEDS.has(speed)) speed = String(defaults.speed || TIMING_SPEED.INSTANT).toLowerCase();

  const phases = list(raw.phases ?? raw.phase ?? raw.steps ?? raw.step).map(String);
  const phaseGroups = list(raw.phaseGroups ?? raw.phaseGroup).map(String);
  const maxPerTurn = raw.oncePerTurn ? 1 : (raw.maxPerTurn == null ? null : Math.max(0, Number(raw.maxPerTurn)));
  const maxPerCombat = raw.oncePerCombat ? 1 : (raw.maxPerCombat == null ? null : Math.max(0, Number(raw.maxPerCombat)));

  return Object.freeze({
    speed,
    requiresPriority: raw.requiresPriority == null ? defaults.requiresPriority !== false : !!raw.requiresPriority,
    yourTurn: raw.yourTurn == null ? !!defaults.yourTurn : !!raw.yourTurn,
    combatOnly: !!(raw.combatOnly || raw.onlyDuringCombat),
    phases: Object.freeze(phases),
    phaseGroups: Object.freeze(phaseGroups),
    beforeStep: normalizedStepBoundary(raw.beforeStep ?? raw.onlyBeforeStep ?? raw.before),
    afterStep: normalizedStepBoundary(raw.afterStep ?? raw.onlyAfterStep ?? raw.after),
    notUsedSinceStep: normalizedStepBoundary(raw.notUsedSinceStep ?? raw.notActivatedSinceStep ?? raw.notUsedSince),
    maxPerTurn: Number.isFinite(maxPerTurn) ? maxPerTurn : null,
    maxPerCombat: Number.isFinite(maxPerCombat) ? maxPerCombat : null,
    condition: raw.condition ?? raw.customCondition ?? null,
    message: raw.message || defaults.message || null,
    source: raw.source || defaults.source || null,
    metadata: Object.freeze(structuredClone(raw.metadata || defaults.metadata || {}))
  });
}

export function mergeTimingPermission(baseInput, overlayInput) {
  const base = normalizeTimingPermission(baseInput);
  if (overlayInput == null) return base;
  const overlay = typeof overlayInput === 'string' ? { speed: overlayInput } : overlayInput;
  return normalizeTimingPermission({
    ...base,
    ...structuredClone(overlay || {}),
    phases: overlay?.phases ?? overlay?.phase ?? overlay?.steps ?? overlay?.step ?? base.phases,
    phaseGroups: overlay?.phaseGroups ?? overlay?.phaseGroup ?? base.phaseGroups,
    beforeStep: overlay?.beforeStep ?? overlay?.onlyBeforeStep ?? overlay?.before ?? base.beforeStep,
    afterStep: overlay?.afterStep ?? overlay?.onlyAfterStep ?? overlay?.after ?? base.afterStep,
    notUsedSinceStep: overlay?.notUsedSinceStep ?? overlay?.notActivatedSinceStep ?? overlay?.notUsedSince ?? base.notUsedSinceStep,
    maxPerTurn: overlay?.oncePerTurn ? 1 : (overlay?.maxPerTurn ?? base.maxPerTurn),
    maxPerCombat: overlay?.oncePerCombat ? 1 : (overlay?.maxPerCombat ?? base.maxPerCombat),
    condition: overlay?.condition ?? overlay?.customCondition ?? base.condition
  });
}
