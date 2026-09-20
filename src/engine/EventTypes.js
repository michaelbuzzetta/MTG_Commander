/**
 * Canonical state-transition vocabulary introduced in Step 3.
 * Trigger-facing legacy EVENT constants remain supported separately; these
 * event types describe authoritative engine mutations and operations.
 */
export const ENGINE_EVENT = Object.freeze({
  CAST: 'CAST',
  COPY: 'COPY',
  DRAW_CARD: 'DRAW_CARD',
  DISCARD_CARD: 'DISCARD_CARD',
  MILL_CARD: 'MILL_CARD',
  MOVE_ZONE: 'MOVE_ZONE',
  DEAL_DAMAGE: 'DEAL_DAMAGE',
  GAIN_LIFE: 'GAIN_LIFE',
  LOSE_LIFE: 'LOSE_LIFE',
  DESTROY: 'DESTROY',
  SACRIFICE: 'SACRIFICE',
  EXILE: 'EXILE',
  TAP: 'TAP',
  UNTAP: 'UNTAP',
  ADD_COUNTER: 'ADD_COUNTER',
  REMOVE_COUNTER: 'REMOVE_COUNTER',
  CREATE_TOKEN: 'CREATE_TOKEN',
  SEARCH: 'SEARCH',
  SHUFFLE: 'SHUFFLE',
  ATTACK: 'ATTACK',
  BLOCK: 'BLOCK',
  TRANSFORM: 'TRANSFORM',
  CONTROL_CHANGE: 'CONTROL_CHANGE',
  ATTACH: 'ATTACH',
  DETACH: 'DETACH',
  BECOME_MONARCH: 'BECOME_MONARCH'
});

export const ENGINE_EVENT_TYPES = Object.freeze(new Set(Object.values(ENGINE_EVENT)));

export function isEngineEventType(type) {
  return ENGINE_EVENT_TYPES.has(type);
}
