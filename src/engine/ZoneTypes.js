export const PLAYER_ZONE = Object.freeze({
  LIBRARY: 'library',
  HAND: 'hand',
  BATTLEFIELD: 'battlefield',
  GRAVEYARD: 'graveyard',
  EXILE: 'exile',
  COMMAND: 'command'
});

export const STACK_ZONE = 'stack';
export const PLAYER_ZONES = Object.freeze(Object.values(PLAYER_ZONE));
export const ALL_ZONES = Object.freeze([...PLAYER_ZONES, STACK_ZONE]);
export const PUBLIC_ZONES = Object.freeze(new Set([
  PLAYER_ZONE.BATTLEFIELD,
  PLAYER_ZONE.GRAVEYARD,
  PLAYER_ZONE.EXILE,
  PLAYER_ZONE.COMMAND,
  STACK_ZONE
]));
export const HIDDEN_ZONES = Object.freeze(new Set([
  PLAYER_ZONE.HAND,
  PLAYER_ZONE.LIBRARY
]));

export function isPlayerZone(zone) { return PLAYER_ZONES.includes(zone); }
export function isZone(zone) { return ALL_ZONES.includes(zone); }
export function isPublicZone(zone) { return PUBLIC_ZONES.has(zone); }
export function isHiddenZone(zone) { return HIDDEN_ZONES.has(zone); }
