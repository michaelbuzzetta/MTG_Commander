export const TIMING_SPEED = Object.freeze({
  INSTANT: 'instant',
  SORCERY: 'sorcery',
  SPECIAL: 'special',
  MANA: 'mana'
});

export const TIMING_ACTION = Object.freeze({
  CAST: 'CAST',
  ACTIVATE: 'ACTIVATE',
  PLAY_LAND: 'PLAY_LAND',
  FORETELL: 'FORETELL',
  ENCORE: 'ENCORE',
  PASS_PRIORITY: 'PASS_PRIORITY',
  LOOP_SHORTCUT: 'LOOP_SHORTCUT'
});

export const TIMING_RELEVANT_ACTIONS = Object.freeze(new Set([
  'CAST_SPELL', 'CAST_COMMANDER', 'ACTIVATE_ABILITY', 'ACTIVATE_MANA',
  'PLAY_LAND', 'FORETELL_CARD', 'ENCORE_CARD', 'PASS_PRIORITY', 'LOOP_SHORTCUT'
]));

export class TimingError extends Error {
  constructor(message, diagnostic = null) {
    super(message);
    this.name = 'TimingError';
    this.code = 'ILLEGAL_TIMING';
    this.diagnostic = diagnostic;
  }
}
