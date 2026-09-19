/**
 * Canonical player-intent vocabulary introduced in Step 3.
 * These values intentionally preserve the existing wire/action strings so
 * Step 1 callers and replay entries remain backward compatible.
 */
export const ACTION_TYPE = Object.freeze({
  CAST_SPELL: 'CAST_SPELL',
  CAST_COMMANDER: 'CAST_COMMANDER',
  PLAY_LAND: 'PLAY_LAND',
  ACTIVATE_ABILITY: 'ACTIVATE_ABILITY',
  ACTIVATE_MANA: 'ACTIVATE_MANA',
  DECLARE_ATTACKERS: 'DECLARE_ATTACKERS',
  DECLARE_BLOCKERS: 'DECLARE_BLOCKERS',
  PASS_PRIORITY: 'PASS_PRIORITY',
  MULLIGAN: 'MULLIGAN',
  KEEP_HAND: 'KEEP_HAND',
  BOTTOM_CARDS: 'BOTTOM_CARDS',
  DISCARD_CARDS: 'DISCARD_CARDS',
  FORETELL_CARD: 'FORETELL_CARD',
  ENCORE_CARD: 'ENCORE_CARD',
  LOOP_SHORTCUT: 'LOOP_SHORTCUT',
  CHOOSE_PREGAME_ACTION: 'CHOOSE_PREGAME_ACTION'
});

export const PLAYER_ACTION_TYPES = Object.freeze(new Set(Object.values(ACTION_TYPE)));

export function isPlayerActionType(type) {
  return PLAYER_ACTION_TYPES.has(type);
}
