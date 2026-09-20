import { uid } from './utils.js';

export const TRIGGER_KIND = Object.freeze({
  NORMAL: 'normal',
  DELAYED: 'delayed',
  REFLEXIVE: 'reflexive'
});

const INTERVENING_IF_KEYS = new Set([
  'controllerOtherCreatureWithCounter',
  'sourceCounterAtLeast'
]);

function array(value, fallback = []) {
  if (value == null) return [...fallback];
  return Array.isArray(value) ? [...value] : [value];
}

function clone(value, fallback = null) {
  return value == null ? fallback : structuredClone(value);
}

export function inferInterveningIf(condition = {}) {
  const inferred = {};
  for (const [key, value] of Object.entries(condition || {})) {
    if (INTERVENING_IF_KEYS.has(key)) inferred[key] = structuredClone(value);
  }
  return Object.keys(inferred).length ? inferred : null;
}

export function createTriggerDefinition(fields = {}) {
  const eventPattern = array(fields.eventPattern ?? fields.event ?? fields.events).filter(Boolean);
  if (!eventPattern.length) throw new Error('TriggerDefinition requires an event pattern');
  const kind = fields.kind || TRIGGER_KIND.NORMAL;
  if (!Object.values(TRIGGER_KIND).includes(kind)) throw new Error(`Unknown trigger kind ${kind}`);

  const condition = clone(fields.condition, {});
  const interveningIf = fields.interveningIf === false
    ? null
    : clone(fields.interveningIf, inferInterveningIf(condition));

  return {
    definitionId: fields.definitionId || uid(kind === TRIGGER_KIND.DELAYED ? 'delayed-trigger-def' : (kind === TRIGGER_KIND.REFLEXIVE ? 'reflexive-trigger-def' : 'trigger-def')),
    kind,
    eventPattern,
    sourceZones: array(fields.sourceZones ?? fields.sourceZone, kind === TRIGGER_KIND.NORMAL ? ['battlefield'] : ['any']),
    sourceCardId: fields.sourceCardId ?? null,
    sourceAbilityIndex: Number.isInteger(fields.sourceAbilityIndex) ? fields.sourceAbilityIndex : null,
    sourceObjectId: fields.sourceObjectId ?? null,
    sourceInstanceId: fields.sourceInstanceId ?? null,
    sourceSnapshot: clone(fields.sourceSnapshot, null),
    controller: fields.controller ?? null,
    controllerRelation: fields.controllerRelation ?? null,
    condition,
    sourceFilter: clone(fields.sourceFilter, null),
    affectedFilter: clone(fields.affectedFilter, null),
    interveningIf,
    optional: !!fields.optional,
    targets: clone(fields.targets, null),
    minTargets: fields.minTargets ?? null,
    maxTargets: fields.maxTargets ?? null,
    effect: clone(fields.effect, null),
    ability: clone(fields.ability, null),
    parentAbilityId: fields.parentAbilityId ?? null,
    createdTurn: fields.createdTurn ?? null,
    createdPhase: fields.createdPhase ?? null,
    expiresAfterFire: fields.expiresAfterFire !== false,
    expiresAtEvent: fields.expiresAtEvent ?? null,
    expiresAtTurn: fields.expiresAtTurn ?? null,
    expiresAtPhase: fields.expiresAtPhase ?? null,
    metadata: clone(fields.metadata, {})
  };
}

export function definitionFromCardAbility(cardId, ability, abilityIndex = 0) {
  if (!ability || ability.type !== 'triggered') return null;
  return createTriggerDefinition({
    definitionId: `card:${cardId}:trigger:${abilityIndex}`,
    kind: TRIGGER_KIND.NORMAL,
    eventPattern: ability.event,
    sourceZones: ability.sourceZones || ability.sourceZone || ['battlefield'],
    sourceCardId: cardId,
    sourceAbilityIndex: abilityIndex,
    controllerRelation: ability.controllerRelation || null,
    condition: ability.condition || {},
    sourceFilter: ability.sourceFilter || null,
    affectedFilter: ability.affectedFilter || null,
    interveningIf: ability.interveningIf,
    optional: !!ability.optional,
    targets: ability.targets || null,
    minTargets: ability.minTargets ?? null,
    maxTargets: ability.maxTargets ?? null,
    effect: ability.effect || null,
    ability
  });
}

export function triggerDefinitionPublicSnapshot(definition) {
  return structuredClone({
    definitionId: definition.definitionId,
    kind: definition.kind,
    eventPattern: definition.eventPattern,
    sourceZones: definition.sourceZones,
    sourceCardId: definition.sourceCardId,
    sourceAbilityIndex: definition.sourceAbilityIndex,
    controller: definition.controller,
    optional: definition.optional,
    interveningIf: definition.interveningIf,
    metadata: definition.metadata
  });
}
