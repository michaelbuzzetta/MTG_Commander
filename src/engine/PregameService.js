import { FormatValidator } from './FormatValidator.js';
import { PregameActionService } from './PregameActionService.js';

function rotate(values, index) { return [...values.slice(index), ...values.slice(0, index)]; }
function normalizeCompanionId(deck = {}) { return typeof deck.companion === 'string' ? deck.companion : deck.companion?.id || deck.companionId || null; }

export class PregameService {
  constructor(engine, {
    formatRules = {},
    startingPlayer = 'first',
    validateDecks = true
  } = {}) {
    this.engine = engine;
    this.validateDecks = validateDecks;
    this.startingPlayer = startingPlayer;
    this.validator = new FormatValidator(engine.db, formatRules);
    this.actions = new PregameActionService(engine);
    this.lastValidation = [];
  }

  validateAll({ throwOnError = true } = {}) {
    const decks = [this.engine.initialDeckA, ...(Array.isArray(this.engine.initialDeckB) ? this.engine.initialDeckB : [this.engine.initialDeckB])].filter(Boolean);
    this.lastValidation = decks.map(deck => this.validator.validate(deck, { throwOnError }));
    return structuredClone(this.lastValidation);
  }

  chooseStartingPlayer() {
    const state = this.engine.state;
    let id = state.playerOrder[0];
    if (this.startingPlayer === 'random') id = state.playerOrder[this.engine.random.integer(state.playerOrder.length)];
    else if (typeof this.startingPlayer === 'string' && this.startingPlayer !== 'first') {
      if (!state.players[this.startingPlayer]) throw new Error(`Unknown configured starting player ${this.startingPlayer}`);
      id = this.startingPlayer;
    }
    const index = state.playerOrder.indexOf(id);
    state.playerOrder = rotate(state.playerOrder, index < 0 ? 0 : index);
    state.activePlayer = state.playerOrder[0];
    state.normalTurnPlayer = state.activePlayer;
    state.pregame.currentPlayer = state.activePlayer;
    state.pregame.startingPlayer = state.activePlayer;
    state.pregame.turnOrder = [...state.playerOrder];
    return state.activePlayer;
  }

  initialize() {
    const state = this.engine.state;
    const validation = this.validateDecks ? this.validateAll({ throwOnError: true }) : this.validateAll({ throwOnError: false });
    this.chooseStartingPlayer();
    state.pregame.active = true;
    state.pregame.stage = 'mulligan';
    state.pregame.validation = validation;
    state.pregame.freeMulligans = this.engine.playerIds().length > 1 ? 1 : 0;
    state.pregame.companions = {};
    const decks = [this.engine.initialDeckA, ...(Array.isArray(this.engine.initialDeckB) ? this.engine.initialDeckB : [this.engine.initialDeckB])].filter(Boolean);
    state.playerOrder.forEach(playerId => {
      const originalIndex = playerId === 'player' ? 0 : (playerId === 'ai' ? 1 : Number(playerId.replace('ai', '')) || 1);
      const deck = decks[originalIndex];
      const companionId = normalizeCompanionId(deck || {});
      state.pregame.companions[playerId] = companionId ? { cardId: companionId, revealed: true } : null;
    });
    state.priorityPlayer = state.pregame.currentPlayer;
    return structuredClone(state.pregame);
  }

  bottomCount(playerId) {
    const player = this.engine.state.players[playerId];
    const free = Number(this.engine.state.pregame.freeMulligans || 0);
    return Math.max(0, Number(player.mulligans || 0) - free);
  }

  completeMulligans() {
    const state = this.engine.state;
    state.pregame.active = false;
    state.pregame.stage = 'pregame-actions';
    state.priorityPlayer = null;
    const pending = this.actions.begin();
    if (!pending) this.finishPregameActions();
    return pending;
  }

  finishPregameActions() {
    const state = this.engine.state;
    state.pregame.stage = 'complete';
    state.pregame.actionsComplete = true;
    state.gameBegun = true;
    state.priorityPlayer = null;
    this.engine.turn.startFirstTurn(this.engine._internalToken());
    return true;
  }

  resolvePregameActionChoice(playerId, action) {
    const next = this.actions.resolveChoice(playerId, action);
    if (!next) return this.finishPregameActions();
    return next;
  }

  snapshot() {
    return {
      validation: structuredClone(this.lastValidation),
      startingPlayer: this.engine.state.pregame?.startingPlayer || null,
      turnOrder: [...(this.engine.state.playerOrder || [])],
      rng: this.engine.random.snapshot()
    };
  }
}
