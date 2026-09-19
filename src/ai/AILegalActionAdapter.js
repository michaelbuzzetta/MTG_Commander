const TEMPLATE_ACTIONS = new Set([
  'DECLARE_ATTACKERS',
  'DECLARE_BLOCKERS',
  'ORDER_BLOCKERS',
  'ORDER_TRIGGERS',
  'CHOOSE_PROLIFERATE',
  'CHOOSE_PHASE_OUT_PROLIFERATED',
  'ORDER_REPLACEMENTS',
  'CHOOSE_CULTIVATE',
  'CHOOSE_TRIGGER_TARGET',
  'CHOOSE_EFFECT_CARDS',
  'CHOOSE_LIBRARY_SEARCH',
  'BOTTOM_CARDS',
  'DISCARD_CARDS',
  'SUBMIT_CHOICE'
]);

const IDENTITY_FIELDS = [
  'cardInstanceId', 'permanentId', 'mode', 'castOption', 'retraceLandInstanceId',
  'manaColor', 'keepInstanceId', 'moveToCommand', 'accept', 'pay', 'choice',
  'triggerId', 'creatureType', 'hostId', 'landInstanceId', 'sourceId',
  'pregameActionId', 'exileCardInstanceId', 'putOnBottom', 'permanentId'
];

function sameIdentity(offered, candidate) {
  if (offered.type !== candidate?.type) return false;
  if (TEMPLATE_ACTIONS.has(offered.type)) return true;
  for (const field of IDENTITY_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(offered, field)) continue;
    if (offered[field] !== candidate[field]) return false;
  }
  // Activated abilities are engine-issued objects. Compare a stable identity
  // when available so strategy code cannot fabricate a different ability.
  if (offered.ability) {
    const offeredId = offered.ability.id ?? offered.ability.name ?? offered.ability.effect?.type ?? offered.ability.type;
    const candidateId = candidate?.ability?.id ?? candidate?.ability?.name ?? candidate?.ability?.effect?.type ?? candidate?.ability?.type;
    if (offeredId !== candidateId) return false;
  }
  return true;
}

export class AILegalActionAdapter {
  constructor(engineFacade, playerId) {
    this.engine = engineFacade;
    this.playerId = playerId;
    this.actions = Object.freeze([]);
  }

  refresh() {
    this.actions = this.engine.getLegalActions(this.playerId);
    return this.actions;
  }

  byType(type) { return this.actions.filter(action => action.type === type); }

  structured() {
    return Object.freeze({
      casts: this.actions.filter(action => ['CAST_SPELL', 'CAST_COMMANDER'].includes(action.type)),
      landPlays: this.byType('PLAY_LAND'),
      activations: this.actions.filter(action => ['ACTIVATE_ABILITY', 'ACTIVATE_MANA'].includes(action.type)),
      combat: this.actions.filter(action => ['DECLARE_ATTACKERS', 'DECLARE_BLOCKERS', 'ORDER_BLOCKERS'].includes(action.type)),
      special: this.actions.filter(action => ['FORETELL_CARD', 'ENCORE_CARD', 'LOOP_SHORTCUT'].includes(action.type)),
      choices: this.actions.filter(action => action.type.startsWith('CHOOSE_') || action.type.startsWith('ORDER_') || ['BOTTOM_CARDS', 'DISCARD_CARDS', 'SUBMIT_CHOICE'].includes(action.type)),
      pass: this.byType('PASS_PRIORITY')
    });
  }

  isAuthorized(candidate) {
    if (!candidate?.type) return false;
    if (!this.actions.some(offered => sameIdentity(offered, candidate))) return false;
    return this.engine.isActionLegal(this.playerId, candidate);
  }

  authorize(candidate) {
    if (this.isAuthorized(candidate)) return candidate;
    return null;
  }

  safeFallback() {
    const pass = this.actions.find(action => action.type === 'PASS_PRIORITY');
    if (pass && this.engine.isActionLegal(this.playerId, pass)) return pass;
    return null;
  }
}
