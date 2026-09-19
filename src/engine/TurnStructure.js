import { PHASES } from '../constants.js';

export const TURN_PHASE_GROUP = Object.freeze({
  BEGINNING: 'BEGINNING',
  PRECOMBAT_MAIN: 'PRECOMBAT_MAIN',
  COMBAT: 'COMBAT',
  POSTCOMBAT_MAIN: 'POSTCOMBAT_MAIN',
  ENDING: 'ENDING'
});

export const STEP_DEFINITION = Object.freeze({
  UNTAP: Object.freeze({ key: 'UNTAP', phaseGroup: TURN_PHASE_GROUP.BEGINNING, grantsPriority: false, turnBasedAction: 'UNTAP' }),
  UPKEEP: Object.freeze({ key: 'UPKEEP', phaseGroup: TURN_PHASE_GROUP.BEGINNING, grantsPriority: true, turnBasedAction: null }),
  DRAW: Object.freeze({ key: 'DRAW', phaseGroup: TURN_PHASE_GROUP.BEGINNING, grantsPriority: true, turnBasedAction: 'DRAW' }),
  PRECOMBAT_MAIN: Object.freeze({ key: 'PRECOMBAT_MAIN', phaseGroup: TURN_PHASE_GROUP.PRECOMBAT_MAIN, grantsPriority: true, turnBasedAction: null }),
  BEGIN_COMBAT: Object.freeze({ key: 'BEGIN_COMBAT', phaseGroup: TURN_PHASE_GROUP.COMBAT, grantsPriority: true, turnBasedAction: null }),
  DECLARE_ATTACKERS: Object.freeze({ key: 'DECLARE_ATTACKERS', phaseGroup: TURN_PHASE_GROUP.COMBAT, grantsPriority: true, turnBasedAction: 'DECLARE_ATTACKERS' }),
  DECLARE_BLOCKERS: Object.freeze({ key: 'DECLARE_BLOCKERS', phaseGroup: TURN_PHASE_GROUP.COMBAT, grantsPriority: true, turnBasedAction: 'DECLARE_BLOCKERS' }),
  FIRST_STRIKE_DAMAGE: Object.freeze({ key: 'FIRST_STRIKE_DAMAGE', phaseGroup: TURN_PHASE_GROUP.COMBAT, grantsPriority: true, turnBasedAction: 'FIRST_STRIKE_DAMAGE', optional: true }),
  COMBAT_DAMAGE: Object.freeze({ key: 'COMBAT_DAMAGE', phaseGroup: TURN_PHASE_GROUP.COMBAT, grantsPriority: true, turnBasedAction: 'COMBAT_DAMAGE' }),
  END_COMBAT: Object.freeze({ key: 'END_COMBAT', phaseGroup: TURN_PHASE_GROUP.COMBAT, grantsPriority: true, turnBasedAction: null }),
  POSTCOMBAT_MAIN: Object.freeze({ key: 'POSTCOMBAT_MAIN', phaseGroup: TURN_PHASE_GROUP.POSTCOMBAT_MAIN, grantsPriority: true, turnBasedAction: null }),
  END_STEP: Object.freeze({ key: 'END_STEP', phaseGroup: TURN_PHASE_GROUP.ENDING, grantsPriority: true, turnBasedAction: null }),
  CLEANUP: Object.freeze({ key: 'CLEANUP', phaseGroup: TURN_PHASE_GROUP.ENDING, grantsPriority: false, turnBasedAction: 'CLEANUP' })
});

export const COMBAT_STEP_KEYS = Object.freeze([
  'BEGIN_COMBAT', 'DECLARE_ATTACKERS', 'DECLARE_BLOCKERS', 'FIRST_STRIKE_DAMAGE', 'COMBAT_DAMAGE', 'END_COMBAT'
]);

export const BASE_TURN_SEQUENCE = Object.freeze(PHASES.map(key => STEP_DEFINITION[key]));

export function stepDefinition(key) {
  const definition = STEP_DEFINITION[key];
  if (!definition) throw new Error(`Unknown turn step ${key}`);
  return definition;
}

export function makeTurnNode(key, {
  occurrence = 1,
  origin = 'normal',
  serial = 0,
  phaseGroup = null,
  metadata = null
} = {}) {
  const definition = stepDefinition(key);
  return {
    id: `${key}:${occurrence}:${origin}:${serial}`,
    key,
    phaseGroup: phaseGroup || definition.phaseGroup,
    grantsPriority: definition.grantsPriority,
    turnBasedAction: definition.turnBasedAction,
    optional: !!definition.optional,
    occurrence,
    origin,
    metadata: metadata ? structuredClone(metadata) : null
  };
}

export function buildBaseTurnSequence() {
  const occurrences = {};
  return BASE_TURN_SEQUENCE.map((definition, index) => {
    const occurrence = (occurrences[definition.key] || 0) + 1;
    occurrences[definition.key] = occurrence;
    return makeTurnNode(definition.key, { occurrence, serial: index + 1 });
  });
}

export function reindexSequence(sequence = []) {
  const occurrences = {};
  return sequence.map((node, index) => {
    const key = node.key;
    const occurrence = (occurrences[key] || 0) + 1;
    occurrences[key] = occurrence;
    return {
      ...node,
      id: `${key}:${occurrence}:${node.origin || 'normal'}:${index + 1}`,
      occurrence
    };
  });
}

export function combatSequence({ origin = 'extra-combat' } = {}) {
  return COMBAT_STEP_KEYS.map((key, index) => makeTurnNode(key, { origin, serial: index + 1 }));
}
