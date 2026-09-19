export const RULE_KIND = Object.freeze({
  PERMISSION: 'permission',
  RESTRICTION: 'restriction',
  REQUIREMENT: 'requirement'
});

export const LEGALITY_OPERATION = Object.freeze({
  CAST: 'CAST',
  PLAY_LAND: 'PLAY_LAND',
  SEARCH: 'SEARCH',
  DRAW: 'DRAW',
  GAIN_LIFE: 'GAIN_LIFE',
  ATTACK: 'ATTACK',
  BLOCK: 'BLOCK',
  TARGET: 'TARGET',
  ACTIVATE_ABILITY: 'ACTIVATE_ABILITY',
  UNTAP: 'UNTAP'
});

export const LEGALITY_OPERATIONS = Object.freeze(new Set(Object.values(LEGALITY_OPERATION)));

export function operationForAction(action = {}) {
  if (['CAST_SPELL', 'CAST_COMMANDER'].includes(action.type)) return LEGALITY_OPERATION.CAST;
  if (['PLAY_LAND', 'PLAY_HIDEAWAY_LAND'].includes(action.type)) return LEGALITY_OPERATION.PLAY_LAND;
  if (['ACTIVATE_ABILITY', 'ACTIVATE_MANA'].includes(action.type)) return LEGALITY_OPERATION.ACTIVATE_ABILITY;
  if (action.type === 'DECLARE_ATTACKERS') return LEGALITY_OPERATION.ATTACK;
  if (action.type === 'DECLARE_BLOCKERS') return LEGALITY_OPERATION.BLOCK;
  return null;
}
