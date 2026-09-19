import { uid } from '../utils.js';

export const STACK_OBJECT_TYPE = Object.freeze({
  SPELL: 'spell',
  ACTIVATED_ABILITY: 'ability',
  TRIGGERED_ABILITY: 'trigger',
  WARD: 'ward'
});

export const STACK_OBJECT_TYPES = Object.freeze(Object.values(STACK_OBJECT_TYPE));

function clone(value, fallback) {
  if (value == null) return fallback;
  return structuredClone(value);
}

function normalizedModes(fields) {
  if (Array.isArray(fields.selectedModes)) return [...fields.selectedModes];
  if (Array.isArray(fields.modes)) return [...fields.modes];
  if (fields.mode != null) return [fields.mode];
  return [];
}

/**
 * Canonical Step 5 stack-object constructor.
 *
 * The engine historically used a small free-form object on GameState.stack.
 * Step 5 keeps compatibility with those fields while guaranteeing that every
 * new stack object carries the rules-relevant choices needed to reproduce and
 * revalidate it during resolution.
 */
export function createStackObject(fields = {}) {
  const type = fields.type || STACK_OBJECT_TYPE.ACTIVATED_ABILITY;
  if (!STACK_OBJECT_TYPES.includes(type)) throw new Error(`Unsupported stack object type ${type}`);

  const selectedModes = normalizedModes(fields);
  const isSpell = type === STACK_OBJECT_TYPE.SPELL;
  const id = fields.id || uid(isSpell ? 'spell' : 'stack');
  const isCopy = !!(fields.isCopy || fields.copyMetadata?.isCopy);
  const copyMetadata = {
    isCopy,
    copiedFromStackObjectId: fields.copyMetadata?.copiedFromStackObjectId ?? fields.copiedFromStackObjectId ?? null,
    retargetAllowed: !!(fields.copyMetadata?.retargetAllowed ?? fields.retargetAllowed),
    ...clone(fields.copyMetadata, {})
  };

  return {
    ...fields,
    id,
    type,
    objectKind: isSpell ? 'spell' : 'ability-on-stack',
    gameObjectId: fields.gameObjectId || uid(isSpell ? 'spellobj' : 'abilityobj'),
    controller: fields.controller ?? null,
    source: fields.source ?? (isSpell ? fields.card ?? null : null),
    card: fields.card ?? null,
    ability: fields.ability ? clone(fields.ability, null) : null,
    effect: fields.effect ? clone(fields.effect, null) : null,
    selectedModes,
    mode: fields.mode ?? selectedModes[0] ?? null,
    targets: Array.isArray(fields.targets) ? [...fields.targets] : [],
    xValue: fields.xValue ?? fields.x ?? null,
    divided: clone(fields.divided ?? fields.divisions, null),
    additionalCosts: clone(fields.additionalCosts, []),
    alternativeCost: clone(fields.alternativeCost, null),
    castOption: fields.castOption ?? null,
    isCopy,
    copyMetadata
  };
}

export function validateStackObject(item, { throwOnError = false } = {}) {
  const errors = [];
  const fail = message => errors.push(message);
  if (!item || typeof item !== 'object') fail('StackObject must be an object');
  else {
    if (!item.id) fail('StackObject.id is required');
    if (!STACK_OBJECT_TYPES.includes(item.type)) fail(`StackObject.type ${item.type} is not supported`);
    if (!item.gameObjectId) fail('StackObject.gameObjectId is required');
    if (!item.controller) fail('StackObject.controller is required');
    if (!Array.isArray(item.targets)) fail('StackObject.targets must be an array');
    if (!Array.isArray(item.selectedModes)) fail('StackObject.selectedModes must be an array');
    if (!Array.isArray(item.additionalCosts)) fail('StackObject.additionalCosts must be an array');
    if (!item.copyMetadata || typeof item.copyMetadata !== 'object') fail('StackObject.copyMetadata is required');
    if (item.type === STACK_OBJECT_TYPE.SPELL && !item.card) fail('Spell stack objects require card');
    if ([STACK_OBJECT_TYPE.ACTIVATED_ABILITY, STACK_OBJECT_TYPE.TRIGGERED_ABILITY].includes(item.type) && !item.source) {
      fail('Ability stack objects require source');
    }
  }
  if (throwOnError && errors.length) throw new Error(`Invalid StackObject:\n- ${errors.join('\n- ')}`);
  return { ok: errors.length === 0, errors };
}

export function stackObjectPublicSnapshot(item) {
  if (!item) return null;
  return structuredClone({
    id: item.id,
    gameObjectId: item.gameObjectId,
    type: item.type,
    controller: item.controller,
    source: item.source || null,
    card: item.card || null,
    ability: item.ability || null,
    selectedModes: item.selectedModes || [],
    mode: item.mode ?? null,
    targets: item.targets || [],
    xValue: item.xValue ?? null,
    divided: item.divided ?? null,
    additionalCosts: item.additionalCosts || [],
    alternativeCost: item.alternativeCost ?? null,
    lockedCost: item.lockedCost ?? null,
    paymentPlan: item.paymentPlan ?? null,
    castOption: item.castOption ?? null,
    isCopy: !!item.isCopy,
    copyMetadata: item.copyMetadata || { isCopy: !!item.isCopy }
  });
}
