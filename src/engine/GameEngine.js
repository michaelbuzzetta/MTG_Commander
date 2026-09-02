import { createGameState } from './GameState.js';
import { PHASES, EVENT } from './constants.js';
import { ManaEngine } from './ManaEngine.js';
import { ZoneManager } from './ZoneManager.js';
import { EffectEngine } from './EffectEngine.js';
import { TriggerEngine } from './TriggerEngine.js';
import { StaticEngine } from './StaticEngine.js';
import { CombatEngine } from './CombatEngine.js';
import { LegalActions } from './LegalActions.js';
import { TargetingEngine } from './TargetingEngine.js';
import { isType, hasSubtype, hasKeyword, shuffle } from './utils.js';

const INTERNAL = Symbol('GameEngineInternal');
const MAIN_PHASES = ['PRECOMBAT_MAIN', 'POSTCOMBAT_MAIN'];

export class GameEngine {
  constructor(deckA, deckB, db, { rng = Math.random } = {}) {
    this.initialDeckA = structuredClone(deckA);
    this.initialDeckB = structuredClone(deckB);
    this.initialDb = structuredClone(db);
    this.rng = rng;
    this.db = structuredClone(db);
    this.state = createGameState(deckA, deckB, this.db, rng);
    this.mana = ManaEngine;
    this.effects = new EffectEngine(this);
    this.triggers = new TriggerEngine(this);
    this.static = new StaticEngine(this);
    this.combat = new CombatEngine(this, INTERNAL);
    this.targeting = new TargetingEngine(this);
    this.legal = new LegalActions(this);
    this._triggerDeferral = 0;
  }

  playerIds = () => [...(this.state.playerOrder || Object.keys(this.state.players))];

  livingPlayerIds = () => this.playerIds().filter(id => this.state.players[id] && !this.state.players[id].lost);

  opponents = id => this.livingPlayerIds().filter(other => other !== id);

  opponent = id => this.opponents(id)[0] || null;

  nextPlayer = id => {
    const order = this.playerIds();
    if (!order.length) return null;
    const start = Math.max(0, order.indexOf(id));
    for (let offset = 1; offset <= order.length; offset++) {
      const candidate = order[(start + offset) % order.length];
      if (this.state.players[candidate] && !this.state.players[candidate].lost) return candidate;
    }
    return null;
  };

  nextPriorityPlayer = id => this.nextPlayer(id);

  start() {
    if (this.state.started) throw new Error('Game already started; use reset() to begin a new match');
    this.state.started = true;
    this.state.pregame.active = true;
    this.state.pregame.currentPlayer = this.state.playerOrder[0];
    this.state.priorityPlayer = this.state.pregame.currentPlayer;
    for (const id of this.state.playerOrder) this.draw(id, 7);
    this.emit(EVENT.GAME_START, { controller: this.state.activePlayer, turn: this.state.turn, stage: 'pregame' });
    return this.state;
  }

  reset() {
    this.db = structuredClone(this.initialDb);
    this.state = createGameState(this.initialDeckA, this.initialDeckB, this.db, this.rng);
    return this.start();
  }

  log(type, data = {}) {
    this.state.history.push({ turn: this.state.turn, phase: this.state.phase, type, ...data });
  }

  emit(event, payload = {}) {
    this.log(event, payload);
    this.triggers.collect(event, payload);
    if (this._triggerDeferral === 0 && !this.state.pendingChoice) this.triggers.flush();
  }

  _withDeferredTriggers(callback) {
    this._triggerDeferral++;
    try {
      return callback();
    } finally {
      this._triggerDeferral--;
      if (this._triggerDeferral === 0 && !this.state.pendingChoice) this.triggers.flush();
    }
  }

  draw(pid, n = 1) {
    const p = this.state.players[pid];
    for (let i = 0; i < n; i++) {
      const c = p.library.shift();
      if (!c) {
        p.lost = true;
        this.checkWinner();
        return;
      }
      ZoneManager.place(this.state, c, 'hand', pid);
      const drawNumber = (this.state.cardsDrawnThisTurn[pid] || 0) + 1;
      this.state.cardsDrawnThisTurn[pid] = drawNumber;
      this.emit(EVENT.CARD_DRAWN, { controller: pid, card: c, drawNumber, firstDrawThisTurn: drawNumber === 1 });
    }
  }

  getLegalActions(pid) { return this.legal.get(pid); }

  isActionLegal(pid, action) {
    try { this.validateAction(pid, action); return true; }
    catch { return false; }
  }

  validateAction(pid, action) {
    const s = this.state;
    if (!s.started) throw new Error('Game has not started');
    if (s.winner) throw new Error('Game is over');
    if (!s.players[pid]) throw new Error('Unknown acting player');
    if (s.players[pid].lost) throw new Error('Eliminated players cannot take actions');
    if (!action?.type) throw new Error('Action type is required');

    if (s.pendingChoice) return this._validateChoiceAction(pid, action);
    if (s.pregame.active) return this._validatePregameAction(pid, action);
    if (!s.gameBegun) throw new Error('Game has not begun');

    if (s.turnActionPending) {
      if (s.turnActionPending === 'DECLARE_ATTACKERS') return this._validateDeclareAttackers(pid, action);
      if (s.turnActionPending === 'DECLARE_BLOCKERS') return this._validateDeclareBlockers(pid, action);
    }

    if (s.priorityPlayer !== pid) throw new Error('Acting player does not have priority');

    switch (action.type) {
      case 'PASS_PRIORITY': return true;
      case 'PLAY_LAND': return this._validateLand(pid, action);
      case 'CAST_SPELL':
      case 'CAST_COMMANDER': return this._validateCast(pid, action);
      case 'ACTIVATE_MANA': return this._validateAbility(pid, action, true);
      case 'ACTIVATE_ABILITY': return this._validateAbility(pid, action, false);
      case 'FORETELL_CARD': return this._validateForetell(pid, action);
      case 'ENCORE_CARD': return this._validateEncore(pid, action);
      case 'DECLARE_ATTACKERS': throw new Error('Attackers may only be declared during the declare attackers turn-based action');
      case 'DECLARE_BLOCKERS': throw new Error('Blockers may only be declared during the declare blockers turn-based action');
      case 'MULLIGAN':
      case 'KEEP_HAND':
      case 'BOTTOM_CARDS': throw new Error('Mulligan window is closed');
      case 'DISCARD_CARDS': throw new Error('No discard choice is pending');
      default: throw new Error(`Unknown action ${action.type}`);
    }
  }

  perform(pid, action) {
    this.validateAction(pid, action);
    if (action.type !== 'PASS_PRIORITY') this.state.passes = 0;
    const result = this._applyValidatedAction(pid, action, INTERNAL);
    if (this.state.pendingChoice) this.state.priorityPlayer = this.state.pendingChoice.playerId;
    return result;
  }

  _applyValidatedAction(pid, action, token) {
    if (token !== INTERNAL) throw new Error('Internal action dispatcher cannot be called externally');
    switch (action.type) {
      case 'MULLIGAN': return this._applyMulligan(pid);
      case 'KEEP_HAND': return this._applyKeepHand(pid);
      case 'BOTTOM_CARDS': return this._applyBottomCards(pid, action.cardInstanceIds);
      case 'DISCARD_CARDS': return this._applyDiscardCards(pid, action.cardInstanceIds);
      case 'ORDER_BLOCKERS': return this._applyOrderBlockers(pid, action.orders || {});
      case 'CHOOSE_LEGEND': return this._applyLegendChoice(pid, action.keepInstanceId);
      case 'CHOOSE_COMMANDER_ZONE': return this._applyCommanderZoneChoice(pid, !!action.moveToCommand);
      case 'PAY_WARD': return this._applyWardChoice(pid, true);
      case 'DECLINE_WARD': return this._applyWardChoice(pid, false);
      case 'CHOOSE_TRIGGER': return this._applyOptionalTriggerChoice(pid, !!action.accept);
      case 'CHOOSE_OPTIONAL_MANA_PAYMENT': return this._applyOptionalManaPaymentChoice(pid, !!action.pay);
      case 'CHOOSE_TAP_OR_UNTAP': return this._applyTapOrUntapChoice(pid, action.choice);
      case 'CHOOSE_OPTIONAL_EFFECT': return this._applyOptionalEffectChoice(pid, !!action.accept);
      case 'ORDER_TRIGGERS': return this._applyTriggerOrder(pid, action.triggerIds || []);
      case 'CHOOSE_PROLIFERATE': return this._applyProliferateChoice(pid, action.targetIds || []);
      case 'CHOOSE_PHASE_OUT_PROLIFERATED': return this._applyPhaseOutProliferatedChoice(pid, action.permanentIds || []);
      case 'ORDER_REPLACEMENTS': return this._applyReplacementOrder(pid, action.replacementIds || []);
      case 'CHOOSE_EXPLORE': return this._applyExploreChoice(pid, !!action.putInGraveyard);
      case 'ORDER_EXPLORES': return this._applyExploreOrder(pid, action.permanentIds || []);
      case 'CHOOSE_HAKBAL_ATTACK': return this._applyHakbalAttackChoice(pid, action.landInstanceId || null);
      case 'CHOOSE_CULTIVATE': return this._applyCultivateChoice(pid, action.cardInstanceIds || []);
      case 'CHOOSE_SISAY_TUTOR': return this._applySisayTutorChoice(pid, action.cardInstanceId || null);
      case 'CHOOSE_SCRY': return this._applyScryChoice(pid, !!action.putOnBottom);
      case 'CHOOSE_TRIGGER_TARGET': return this._applyTriggerTargetChoice(pid, action.targetIds || []);
      case 'CHOOSE_CREATURE_TYPE': return this._applyCreatureTypeChoice(pid, action.creatureType);
      case 'CHOOSE_EFFECT_CARDS': return this._applyEffectCardChoice(pid, action.cardInstanceIds || []);
      case 'CHOOSE_COPY_TARGETS': return this._applyCopyTargetChoice(pid, action.targetIds || []);
      case 'CHOOSE_ENTRY_REVEAL': return this._applyEntryRevealChoice(pid, action.cardInstanceId || null);
      case 'CHOOSE_HIDEAWAY': return this._applyHideawayChoice(pid, action.cardInstanceId || null);
      case 'DECLINE_HIDEAWAY_PLAY': return this._applyHideawayDecline(pid);
      case 'PLAY_HIDEAWAY_LAND': return this._applyHideawayLand(pid, action.cardInstanceId);
      case 'PLAY_LAND': return this._applyPlayLand(pid, action.cardInstanceId);
      case 'CAST_SPELL':
        if (action.castOption === 'hideaway') return this._applyHideawayCast(pid, action);
        return this._applyCast(pid, action.cardInstanceId, action.targets || [], action.mode || null, action.castOption || null, action.retraceLandInstanceId || null);
      case 'CAST_COMMANDER': return this._applyCast(pid, action.cardInstanceId, action.targets || [], action.mode || null, action.castOption || null, action.retraceLandInstanceId || null);
      case 'ACTIVATE_MANA': return this._applyActivateMana(pid, action.permanentId, action.ability, action.manaColor); 
      case 'ACTIVATE_ABILITY': return this._applyActivateAbility(pid, action.permanentId, action.ability, action.targets || [], action.selections || []);
      case 'FORETELL_CARD': return this._applyForetell(pid, action.cardInstanceId);
      case 'ENCORE_CARD': return this._applyEncore(pid, action.cardInstanceId);
      case 'PASS_PRIORITY': return this._applyPassPriority(pid);
      case 'DECLARE_ATTACKERS': return this._applyDeclareAttackers(pid, action.attackers || [], action.attackTargets || {});
      case 'DECLARE_BLOCKERS': return this._applyDeclareBlockers(pid, action.blockers || {});
      default: throw new Error(`Unknown action ${action.type}`);
    }
  }

  _validatePregameAction(pid, action) {
    const s = this.state;
    if (s.pregame.currentPlayer !== pid) throw new Error('It is not this player’s mulligan decision');
    if (action.type === 'MULLIGAN' || action.type === 'KEEP_HAND') return true;
    throw new Error('Only mulligan or keep-hand actions are legal during this pregame window');
  }

  _validateChoiceAction(pid, action) {
    const choice = this.state.pendingChoice;
    if (choice.playerId !== pid) throw new Error('This choice belongs to the other player');
    if (choice.type === 'COMBAT_DAMAGE_ORDER') {
      if (action.type !== 'ORDER_BLOCKERS') throw new Error('Choose blocker damage assignment order before taking another action');
      return this.combat.validateDamageAssignmentOrder(pid, action.orders || {});
    }
    if (choice.type === 'LEGEND_RULE') {
      if (action.type !== 'CHOOSE_LEGEND') throw new Error('Choose one legendary permanent to keep');
      if (!choice.permanentIds.includes(action.keepInstanceId)) throw new Error('The chosen permanent is not part of this legend-rule choice');
      if (!this.findPermanent(action.keepInstanceId)) throw new Error('The chosen legendary permanent is no longer on the battlefield');
      return true;
    }
    if (choice.type === 'COMMANDER_ZONE') {
      if (action.type !== 'CHOOSE_COMMANDER_ZONE' || typeof action.moveToCommand !== 'boolean') {
        throw new Error('Choose whether to move the commander to the command zone');
      }
      return true;
    }
    if (choice.type === 'WARD_PAYMENT') {
      if (action.type === 'DECLINE_WARD') return true;
      if (action.type !== 'PAY_WARD') throw new Error('Choose whether to pay the ward cost');
      if (!this.canPayWard(choice)) throw new Error('Ward cost cannot be paid');
      return true;
    }
    if (choice.type === 'OPTIONAL_TRIGGER') {
      if (action.type !== 'CHOOSE_TRIGGER' || typeof action.accept !== 'boolean') throw new Error('Choose whether to use the optional trigger');
      if (action.triggerId && action.triggerId !== choice.triggerId) throw new Error('That optional trigger is not the pending choice');
      return true;
    }
    if (choice.type === 'OPTIONAL_MANA_PAYMENT') {
      if (action.type !== 'CHOOSE_OPTIONAL_MANA_PAYMENT' || typeof action.pay !== 'boolean') throw new Error('Choose whether to pay the optional mana cost');
      if (action.pay && !this.mana.canAfford(this.state.players[pid], this.db, choice.mana || '', 0, this, { kind: 'other' })) throw new Error('The optional mana cost cannot be paid');
      return true;
    }
    if (choice.type === 'TAP_OR_UNTAP') {
      if (action.type !== 'CHOOSE_TAP_OR_UNTAP' || !['tap','untap','none'].includes(action.choice)) throw new Error('Choose whether to tap, untap, or leave the target unchanged');
      return true;
    }
    if (choice.type === 'OPTIONAL_EFFECT') {
      if (action.type !== 'CHOOSE_OPTIONAL_EFFECT' || typeof action.accept !== 'boolean') throw new Error('Choose whether to use the optional effect');
      return true;
    }
    if (choice.type === 'TRIGGER_ORDER') {
      if (action.type !== 'ORDER_TRIGGERS') throw new Error('Order the simultaneous triggers before taking another action');
      const ids = action.triggerIds;
      if (!Array.isArray(ids) || ids.length !== choice.triggerIds.length || new Set(ids).size !== ids.length) throw new Error('Order every simultaneous trigger exactly once');
      if (ids.some(id => !choice.triggerIds.includes(id))) throw new Error('Trigger order contains an invalid trigger');
      return true;
    }
    if (choice.type === 'PROLIFERATE') {
      if (action.type !== 'CHOOSE_PROLIFERATE') throw new Error('Choose the permanents and players to proliferate');
      const ids = action.targetIds;
      if (!Array.isArray(ids) || new Set(ids).size !== ids.length) throw new Error('Proliferate choices must be unique');
      if (ids.some(id => !choice.eligibleIds.includes(id))) throw new Error('Proliferate selection contains an ineligible object');
      return true;
    }
    if (choice.type === 'PHASE_OUT_PROLIFERATED') {
      if (action.type !== 'CHOOSE_PHASE_OUT_PROLIFERATED') throw new Error('Choose which proliferated permanents phase out');
      const ids = action.permanentIds;
      if (!Array.isArray(ids) || new Set(ids).size !== ids.length) throw new Error('Phase-out choices must be unique');
      if (ids.some(id => !choice.eligibleIds.includes(id))) throw new Error('Only permanents that received counters from this proliferate may phase out');
      return true;
    }
    if (choice.type === 'REPLACEMENT_ORDER') {
      if (action.type !== 'ORDER_REPLACEMENTS') throw new Error('Choose the order of applicable replacement effects');
      const ids = action.replacementIds;
      if (!Array.isArray(ids) || ids.length !== choice.replacementIds.length || new Set(ids).size !== ids.length) throw new Error('Order every replacement effect exactly once');
      if (ids.some(id => !choice.replacementIds.includes(id))) throw new Error('Replacement order contains an invalid effect');
      return true;
    }
    if (choice.type === 'EXPLORE_NONLAND') {
      if (action.type !== 'CHOOSE_EXPLORE' || typeof action.putInGraveyard !== 'boolean') {
        throw new Error('Choose whether the revealed nonland stays on top or goes to the graveyard');
      }
      const top = this.state.players[pid].library[0];
      if (!top || top.instanceId !== choice.cardInstanceId) throw new Error('The revealed explore card is no longer on top of the library');
      return true;
    }
    if (choice.type === 'EXPLORE_ORDER') {
      if (action.type !== 'ORDER_EXPLORES') throw new Error('Choose the order in which your creatures explore');
      const ids = action.permanentIds;
      if (!Array.isArray(ids) || ids.length !== choice.permanentIds.length || new Set(ids).size !== ids.length) throw new Error('Order every exploring creature exactly once');
      if (ids.some(id => !choice.permanentIds.includes(id))) throw new Error('Explore order contains an invalid creature');
      return true;
    }
    if (choice.type === 'HAKBAL_ATTACK') {
      if (action.type !== 'CHOOSE_HAKBAL_ATTACK') throw new Error('Choose a land to put onto the battlefield or draw a card');
      if (action.landInstanceId != null && !choice.landInstanceIds.includes(action.landInstanceId)) throw new Error('That card is not an eligible land in your hand');
      return true;
    }
    if (choice.type === 'CULTIVATE_SEARCH') {
      if (action.type !== 'CHOOSE_CULTIVATE') throw new Error('Choose up to two basic lands for Cultivate');
      const ids = action.cardInstanceIds;
      if (!Array.isArray(ids) || ids.length > 2 || new Set(ids).size !== ids.length) throw new Error('Cultivate selects up to two distinct basic lands');
      if (ids.some(id => !choice.eligibleIds.includes(id))) throw new Error('Cultivate selection contains a nonbasic or unavailable card');
      return true;
    }
    if (choice.type === 'SISAY_TUTOR') {
      if (action.type !== 'CHOOSE_SISAY_TUTOR') throw new Error('Choose a legal legendary permanent for Sisay');
      if (action.cardInstanceId != null && !choice.eligibleIds.includes(action.cardInstanceId)) throw new Error('That card is not a legal Sisay search result');
      return true;
    }
    if (choice.type === 'SCRY') {
      if (action.type !== 'CHOOSE_SCRY' || typeof action.putOnBottom !== 'boolean') throw new Error('Choose whether to keep the scry card on top or put it on the bottom');
      const top = this.state.players[pid].library[0];
      if (!top || top.instanceId !== choice.cardInstanceId) throw new Error('The scry card is no longer on top of the library');
      return true;
    }
    if (choice.type === 'TRIGGER_TARGET') {
      if (action.type !== 'CHOOSE_TRIGGER_TARGET') throw new Error('Choose targets for the triggered ability');
      const ids = action.targetIds;
      if (!Array.isArray(ids) || ids.length < choice.minTargets || ids.length > choice.maxTargets || new Set(ids).size !== ids.length) throw new Error('Choose a legal number of unique trigger targets');
      if (ids.some(id => !choice.candidateIds.includes(id))) throw new Error('Triggered ability target is not legal');
      return true;
    }
    if (choice.type === 'CREATURE_TYPE') {
      if (action.type !== 'CHOOSE_CREATURE_TYPE' || typeof action.creatureType !== 'string') throw new Error('Choose a creature type');
      if (!choice.options.includes(action.creatureType)) throw new Error('That creature type is not available');
      return true;
    }
    if (choice.type === 'EFFECT_CARD_CHOICE') {
      if (action.type !== 'CHOOSE_EFFECT_CARDS') throw new Error('Choose the requested cards');
      const ids = action.cardInstanceIds;
      if (!Array.isArray(ids) || ids.length < choice.min || ids.length > choice.max || new Set(ids).size !== ids.length) throw new Error(`Choose between ${choice.min} and ${choice.max} cards`);
      if (ids.some(id => !choice.candidateIds.includes(id))) throw new Error('Selected card is not eligible for this effect');
      if (choice.continuation?.type === 'myriadLandscape' && ids.length > 1) {
        const defs = ids.map(id => this.db[ZoneManager.find(this.state, id)?.card?.cardId] || {});
        const basicTypes = ['Plains','Island','Swamp','Mountain','Forest'];
        const shared = basicTypes.some(type => defs.every(def => hasSubtype(def, type)));
        if (!shared) throw new Error('Myriad Landscape requires the chosen basic lands to share a land type');
      }
      return true;
    }
    if (choice.type === 'COPY_TARGETS') {
      if (action.type !== 'CHOOSE_COPY_TARGETS') throw new Error('Choose targets for the spell copy');
      const ids = action.targetIds;
      if (!Array.isArray(ids) || ids.length !== choice.originalTargets.length) throw new Error('A spell copy keeps the same number of targets');
      this.targeting.validateTargetMultiplicity(choice.targetSource, ids);
      ids.forEach((id, index) => {
        if (id === choice.originalTargets[index]) return; // An unchanged target need not currently be legal.
        this.targeting.validateTarget(pid, id, this.targeting.specFor(choice.targetSource, index), { sourceObject: choice.copyItem.card, selectedTargets: ids });
      });
      return true;
    }
    if (choice.type === 'ENTRY_REVEAL') {
      if (action.type !== 'CHOOSE_ENTRY_REVEAL') throw new Error('Choose whether to reveal a qualifying land card');
      if (action.cardInstanceId != null && !choice.candidateIds.includes(action.cardInstanceId)) throw new Error('That card cannot be revealed for this land');
      return true;
    }
    if (choice.type === 'HIDEAWAY') {
      if (action.type !== 'CHOOSE_HIDEAWAY') throw new Error('Choose a card for hideaway');
      if (choice.candidateIds.length && !choice.candidateIds.includes(action.cardInstanceId)) throw new Error('Choose one of the cards looked at with hideaway');
      return true;
    }
    if (choice.type === 'HIDEAWAY_PLAY') {
      if (action.type === 'DECLINE_HIDEAWAY_PLAY') return true;
      if (action.cardInstanceId !== choice.cardInstanceId) throw new Error('Only the card hidden with this permanent may be played');
      if (action.type === 'PLAY_HIDEAWAY_LAND') return this._validateHideawayLand(pid, action);
      if (action.type === 'CAST_SPELL' && action.castOption === 'hideaway') return this._validateCast(pid, action);
      throw new Error('Choose whether to play the hideaway card');
    }
    const expected = choice.type === 'MULLIGAN_BOTTOM' ? 'BOTTOM_CARDS' : 'DISCARD_CARDS';
    if (action.type !== expected) throw new Error(`Must complete ${choice.type} before taking another action`);
    const ids = action.cardInstanceIds;
    if (!Array.isArray(ids) || ids.length !== choice.count) throw new Error(`Select exactly ${choice.count} card(s)`);
    if (new Set(ids).size !== ids.length) throw new Error('A card cannot be selected twice');
    const handIds = new Set(this.state.players[pid].hand.map(c => c.instanceId));
    if (ids.some(id => !handIds.has(id))) throw new Error('All selected cards must be in the acting player’s hand');
    return true;
  }

  _validateLand(pid, action) {
    const s = this.state, p = s.players[pid];
    if (pid !== s.activePlayer || !MAIN_PHASES.includes(s.phase) || s.stack.length !== 0) throw new Error('Illegal land timing');
    if (p.landPlaysRemaining < 1) throw new Error('No land plays remaining');
    const f = ZoneManager.find(s, action.cardInstanceId);
    if (!f || f.zone !== 'hand' || f.player?.id !== pid || f.card.owner !== pid) throw new Error('Land must be in the acting player’s hand');
    if (!isType(this.db[f.card.cardId], 'Land')) throw new Error('Selected card is not a land');
    return true;
  }

  _validateHideawayLand(pid, action) {
    const s = this.state, p = s.players[pid], choice = s.pendingChoice;
    if (!choice || choice.type !== 'HIDEAWAY_PLAY' || choice.playerId !== pid) throw new Error('No hideaway play choice is pending');
    if (pid !== s.activePlayer) throw new Error('A land hidden with Mosswort Bridge may only be played on your turn');
    if (p.landPlaysRemaining < 1) throw new Error('No land plays remaining');
    const f = ZoneManager.find(s, action.cardInstanceId);
    if (!f || f.zone !== 'exile' || f.player?.id !== pid || f.card.owner !== pid || f.card.exiledBy !== choice.sourceId) throw new Error('The hidden land is not available to play');
    if (!isType(this.db[f.card.cardId], 'Land')) throw new Error('The hideaway card is not a land');
    return true;
  }

  _modeFor(definition, modeId = null) {
    if (!definition || !modeId) return null;
    const explicit = Array.isArray(definition.modes) ? definition.modes.find(mode => mode.id === modeId) : null;
    if (explicit) return explicit;
    const xMode = definition.xMode;
    if (!xMode?.prefix || !String(modeId).startsWith(xMode.prefix)) return null;
    const raw = String(modeId).slice(String(xMode.prefix).length);
    if (!/^\d+$/.test(raw)) return null;
    const x = Number(raw);
    if (x < Number(xMode.min ?? 0)) return null;
    const mode = {
      id: String(modeId),
      label: String(xMode.label || `${xMode.prefix}X={X}`).replaceAll('{X}', String(x)),
      fromZone: xMode.fromZone || 'hand',
      manaCost: xMode.manaCost ?? definition.manaCost ?? '',
      extraGeneric: xMode.extraGenericFromX === false ? Number(xMode.extraGeneric || 0) : x,
      effects: structuredClone(xMode.effects || definition.spellEffects || []),
      xValue: x
    };
    if (xMode.timing) mode.timing = xMode.timing;
    if (xMode.target) {
      mode.targets = structuredClone(xMode.target);
      if (xMode.targetCountFromX) {
        mode.minTargets = x;
        mode.maxTargets = x;
        if (typeof mode.targets === 'object' && !Array.isArray(mode.targets)) {
          mode.targets.minTargets = x;
          mode.targets.maxTargets = x;
        }
      }
    }
    return mode;
  }

  dynamicXModesFor(pid, card, zone, castOption = null) {
    const definition = this.db[card?.cardId] || {};
    const xMode = definition.xMode;
    if (!xMode?.prefix) return [];
    const out = [];
    const min = Math.max(0, Number(xMode.min ?? 0));
    // Costs only increase as X increases in the supported schema, so the first
    // unaffordable X is a safe stopping point. Free casts can only choose X=0.
    for (let x = min; x <= 1000; x++) {
      if ((card.freeCast || castOption === 'hideaway') && String(xMode.prefix || '').startsWith('x-') && x > 0) break;
      const mode = this._modeFor(definition, `${xMode.prefix}${x}`);
      if (!mode) break;
      if (xMode.targetCountFromX) {
        const candidates = this.targeting.getCandidates(pid, mode, [], { sourceObject: card });
        if (candidates.length < x) break;
      }
      const info = this._castCostInfo(pid, card, zone, mode.id, [], castOption);
      if (!this.mana.canAfford(this.state.players[pid], this.db, info.cost, 0, this, { kind: 'cast', card })) break;
      out.push(mode);
    }
    return out;
  }

  _adjustGenericCost(cost = '', adjustment = 0) {
    const symbols = [...String(cost).matchAll(/\{([^}]+)\}/g)].map(match => match[1]);
    let generic = 0;
    const rest = [];
    for (const symbol of symbols) {
      if (/^\d+$/.test(symbol)) generic += Number(symbol);
      else if (!['X','Y','Z'].includes(symbol.toUpperCase())) rest.push(`{${symbol}}`);
    }
    generic = Math.max(0, generic + Number(adjustment || 0));
    return `${generic ? `{${generic}}` : ''}${rest.join('')}`;
  }

  _castCostInfo(pid, card, zone, mode, targets = [], castOption = null) {
    const d = this.db[card.cardId] || {};
    const selectedMode = this._modeFor(d, mode);
    const withoutManaCost = card.freeCast || castOption === 'hideaway';
    const baseCost = withoutManaCost ? '' : (castOption === 'foretold' && d.foretellCost ? d.foretellCost : (selectedMode?.manaCost ?? d.manaCost ?? ''));
    const commanderTax = card.isCommander && zone === 'command' ? this.state.players[pid].commanderTax : 0;
    const extraGeneric = Number(selectedMode?.extraGeneric || 0);
    const targetTax = this.static.targetingTax(pid, targets);
    const reduction = this.static.spellGenericCostReduction(pid, card);
    return {
      mode: selectedMode,
      cost: this._adjustGenericCost(baseCost, commanderTax + extraGeneric + targetTax - reduction),
      commanderTax,
      extraGeneric,
      targetTax,
      reduction
    };
  }

  _validateCast(pid, action) {
    const s = this.state;
    const f = ZoneManager.find(s, action.cardInstanceId);
    if (!f) throw new Error('Card is not in a castable zone');
    const d = this.db[f.card.cardId];
    const mode = this._modeFor(d, action.mode);
    const allowedModeZone = mode?.fromZone || null;
    const retrace = action.castOption === 'retrace';
    const topCast = action.castOption === 'top';
    const hideaway = action.castOption === 'hideaway';
    const foretold = action.castOption === 'foretold' || mode?.foretold;
    const allowed = ['hand','command'].includes(f.zone)
      || (allowedModeZone && f.zone === allowedModeZone)
      || (retrace && f.zone === 'graveyard' && this.static.hasRetrace(pid, f.card))
      || (foretold && f.zone === 'exile' && f.card.foretold)
      || (topCast && f.zone === 'library' && this.canCastTopCard(pid, f.card))
      || (hideaway && f.zone === 'exile' && this.state.pendingChoice?.type === 'HIDEAWAY_PLAY' && this.state.pendingChoice.playerId === pid && this.state.pendingChoice.cardInstanceId === f.card.instanceId && f.card.exiledBy === this.state.pendingChoice.sourceId);
    if (!allowed) throw new Error('Card is not in a castable zone');
    if (f.player?.id !== pid || f.card.owner !== pid) throw new Error('Cannot cast a card owned by another player from their zone');
    if (action.type === 'CAST_COMMANDER' && (f.zone !== 'command' || !f.card.isCommander)) throw new Error('CAST_COMMANDER requires your commander in the command zone');
    if (action.type === 'CAST_SPELL' && f.zone === 'command') throw new Error('Use CAST_COMMANDER for a commander in the command zone');
    if (!d || isType(d, 'Land')) throw new Error('Lands are not cast as spells');
    if (d.castOnlyFromSuspend && !f.card.suspended) throw new Error('This card has no mana cost and must be cast from suspend');
    if (hideaway && mode?.fromZone && mode.fromZone !== 'hand') throw new Error('That face of the card cannot be cast from hideaway');
    if (foretold && Number(f.card.foretoldTurn ?? s.turn) >= Number(s.turn)) throw new Error('A foretold card may only be cast on a later turn');
    if (((Array.isArray(d.modes) && d.modes.length) || d.xMode) && !mode) throw new Error('A valid spell mode is required');
    if (mode?.condition?.descend8) {
      const count = this.state.players[pid].graveyard.filter(card => {
        const def = this.db[card.cardId];
        return def && !isType(def,'Instant') && !isType(def,'Sorcery');
      }).length;
      if (count < 8) throw new Error('Descend 8 is not satisfied');
    }
    if (!hideaway && !this._canCastAtCurrentTiming(pid, f.card, f.zone, action.mode)) throw new Error('Spell cannot be cast at this time');
    if (retrace) {
      const discard = ZoneManager.find(s, action.retraceLandInstanceId);
      if (!discard || discard.zone !== 'hand' || discard.player?.id !== pid || !isType(this.db[discard.card.cardId], 'Land')) throw new Error('Retrace requires choosing a land card from your hand to discard');
    }
    const targetSource = this.targetSourceForAction(action, d);
    this._validateTargets(pid, targetSource, action.targets || [], { sourceObject: f.card });
    const info = this._castCostInfo(pid, f.card, f.zone, action.mode, action.targets || [], action.castOption || null);
    if (!this.mana.canAfford(this.state.players[pid], this.db, info.cost, 0, this, { kind: 'cast', card: f.card })) throw new Error('Insufficient mana');
    return true;
  }

  targetSourceForAction(action, definition = null) {
    const d = definition || (() => {
      const found = action?.cardInstanceId ? ZoneManager.find(this.state, action.cardInstanceId) : null;
      return found?.card ? this.db[found.card.cardId] : null;
    })();
    if (!d) return d;
    if ((Array.isArray(d.modes) && d.modes.length) || d.xMode) {
      const mode = this._modeFor(d, action?.mode);
      if (!mode) throw new Error('A valid spell mode is required');
      return mode;
    }
    if (action?.mode) throw new Error('This spell has no selectable modes');
    return d;
  }

  _canCastAtCurrentTiming(pid, card, zone, modeId = null) {
    const s = this.state, d = this.db[card.cardId];
    const selectedMode = this._modeFor(d, modeId);
    const grants = s.castingPermissions || [];
    const hasGrant = grants.some(g =>
      (!g.playerId || g.playerId === pid) &&
      (!g.cardId || g.cardId === card.cardId) &&
      (!g.fromZone || g.fromZone === zone) &&
      ['any', 'flash'].includes(g.timing)
    );
    if (hasGrant || this.static.canCastAsFlash(pid, card) || selectedMode?.timing === 'instant' || (!selectedMode?.timing && (hasKeyword(d, 'Flash') || isType(d, 'Instant')))) return true;
    if (selectedMode?.timing === 'sorcery') return pid === s.activePlayer && MAIN_PHASES.includes(s.phase) && s.stack.length === 0;
    return pid === s.activePlayer && MAIN_PHASES.includes(s.phase) && s.stack.length === 0;
  }

  _findDefinedAbility(permanent, supplied) {
    const d = this.db[permanent.cardId];
    if (!supplied || !d) return null;
    const key = JSON.stringify(supplied);
    return this.static.effectiveAbilities(permanent).find(a => JSON.stringify(a) === key) || null;
  }

  _validateAbility(pid, action, manaAbility) {
    const perm = this.findPermanent(action.permanentId);
    if (!perm || perm.controller !== pid || perm.zone !== 'battlefield') throw new Error('Ability source is not a permanent you control');
    const ability = this._findDefinedAbility(perm, action.ability);
    if (!ability) throw new Error('Ability is not printed on the selected permanent');
    if (manaAbility ? ability.type !== 'mana' : ability.type !== 'activated') throw new Error(manaAbility ? 'Not a mana ability' : 'Not an activated ability');
    if (manaAbility && ability.autoOnly) throw new Error('This restricted mana ability is used automatically only for legal payments');
    const requiresTap = manaAbility ? ability.tap !== false : !!ability.tap;
    if (requiresTap && perm.tapped) throw new Error('Permanent is already tapped');
    if (requiresTap && this.static.isType(perm, 'Creature') && perm.summoningSick) {
      const keywords = this.static.derivedStats(perm).keywords.map(x => x.toLowerCase());
      if (!keywords.includes('haste')) throw new Error('Summoning-sick creature cannot pay a tap cost');
    }
    if (manaAbility && ability.anyColor) {
      const choices = this.mana.anyColorChoices(this.state.players[pid], ability);
      if (!action.manaColor) throw new Error('A mana color choice is required');
      if (!choices.includes(action.manaColor)) throw new Error('Illegal mana color choice');
    } else if (manaAbility && action.manaColor) {
      throw new Error('This mana ability does not require a color choice');
    }
    if (!manaAbility && ability.sorcerySpeed && !(pid === this.state.activePlayer && MAIN_PHASES.includes(this.state.phase) && this.state.stack.length === 0)) {
      throw new Error('Ability may only be activated at sorcery speed');
    }
    const lifeCost = ability.cost?.life || 0;
    if (lifeCost > this.state.players[pid].life) throw new Error('Cannot pay life cost');
    if (ability.condition?.noPlusOneCounters && Number(perm.counters?.['+1/+1'] || 0) > 0) throw new Error('Adapt can only be activated if this creature has no +1/+1 counters');
    if (ability.condition?.controlLandsMin != null && this.state.players[pid].battlefield.filter(card => this.static.isType(card, 'Land')).length < Number(ability.condition.controlLandsMin)) throw new Error('Not enough lands to activate this ability');
    if (ability.selection) this._validateAbilitySelections(pid, perm, ability.selection, action.selections || []);
    this._validateTargets(pid, ability, action.targets || [], { sourceObject: perm });
    const manaCost = ability.cost?.mana || ability.manaCost || '';
    const tax = this.static.targetingTax(pid, action.targets || []);
    if (manaCost || tax) {
      const adjusted = this._adjustGenericCost(manaCost, tax);
      if (!this.mana.canAfford(this.state.players[pid], this.db, adjusted, 0, this, { kind: 'ability', source: perm, ability })) throw new Error('Insufficient mana for ability');
    }
    if (ability.cost?.removeCounterSelf) {
      const spec = ability.cost.removeCounterSelf;
      if (Number(perm.counters?.[spec.counter || '+1/+1'] || 0) < Number(spec.amount || 1)) throw new Error('Not enough counters to pay ability cost');
    }
    if (ability.cost?.removeCounterFromSelection) {
      const spec = ability.cost.removeCounterFromSelection;
      const type = spec.counter || '+1/+1';
      const amount = Number(spec.amount || 1);
      for (const id of action.selections || []) {
        const selected = this.findPermanent(id);
        if (!selected || Number(selected.counters?.[type] || 0) < amount) throw new Error('Selected permanent lacks the required counter');
      }
    }
    return true;
  }

  _selectionCandidates(pid, source, spec = {}) {
    const player = this.state.players[pid];
    return player.battlefield.filter(permanent => {
      if (permanent.phasedOut || (spec.tap !== false && permanent.tapped)) return false;
      if (spec.other && permanent.instanceId === source.instanceId) return false;
      if (spec.type && !this.static.isType(permanent, spec.type)) return false;
      if (spec.subtype && !this.static.hasSubtype(permanent, spec.subtype)) return false;
      if (spec.hasCounter && Number(permanent.counters?.[spec.hasCounter] || 0) <= 0) return false;
      return true;
    });
  }

  _validateAbilitySelections(pid, source, spec, ids = []) {
    const count = Number(spec.count || 0);
    if (!Array.isArray(ids) || ids.length !== count || new Set(ids).size !== ids.length) throw new Error(`Choose exactly ${count} permanent(s) for the ability cost`);
    const legal = new Set(this._selectionCandidates(pid, source, spec).map(card => card.instanceId));
    if (ids.some(id => !legal.has(id))) throw new Error('An illegal permanent was selected for the ability cost');
    return true;
  }

  _validateTargets(pid, source, targets, context = {}) {
    return this.targeting.validateTargets(pid, source, targets, context);
  }

  _validateTarget(pid, targetId, spec, context = {}) {
    return this.targeting.validateTarget(pid, targetId, spec, context);
  }

  _validateDeclareAttackers(pid, action) {
    if (action.type !== 'DECLARE_ATTACKERS') throw new Error('Attackers must be declared before priority is given');
    if (this.state.phase !== 'DECLARE_ATTACKERS' || pid !== this.state.activePlayer) throw new Error('Not time to declare attackers');
    const ids = action.attackers || [];
    if (!Array.isArray(ids) || new Set(ids).size !== ids.length) throw new Error('Invalid attacker list');
    const legal = new Set(this.combat.legalAttackers(pid).map(x => x.instanceId));
    if (ids.some(id => !legal.has(id))) throw new Error('Illegal attacker');
    this.combat.normalizeAttackTargets(pid, ids, action.attackTargets || {});
    return true;
  }

  _validateDeclareBlockers(pid, action) {
    if (action.type !== 'DECLARE_BLOCKERS') throw new Error('Blockers must be declared before priority is given');
    if (this.state.phase !== 'DECLARE_BLOCKERS' || pid === this.state.activePlayer) throw new Error('Not time to declare blockers');
    if (this.state.combat.currentDefender && pid !== this.state.combat.currentDefender) throw new Error('It is not this defending player’s blocker declaration');
    this.combat.validateBlockers(pid, action.blockers || {});
    return true;
  }

  _applyMulligan(pid) {
    const p = this.state.players[pid];
    const returned = p.hand.map(c => ({ ...c, zone: 'library', controller: c.owner }));
    p.hand = [];
    p.library = shuffle([...p.library, ...returned], this.rng);
    p.mulligans++;
    this.draw(pid, 7);
    this.state.priorityPlayer = pid;
    return p.hand;
  }

  _applyKeepHand(pid) {
    const p = this.state.players[pid];
    const bottoms = Math.max(0, p.mulligans - 1);
    if (bottoms > 0) {
      this.state.pendingChoice = { type: 'MULLIGAN_BOTTOM', playerId: pid, count: bottoms };
      this.state.priorityPlayer = pid;
      return this.state.pendingChoice;
    }
    this._markPregameKept(pid, INTERNAL);
    return true;
  }

  _applyBottomCards(pid, ids) {
    for (const id of ids) {
      const found = ZoneManager.find(this.state, id);
      this._moveZoneNow(found.card, 'library', pid);
    }
    this.state.pendingChoice = null;
    this._markPregameKept(pid, INTERNAL);
    return ids;
  }

  _markPregameKept(pid, token) {
    if (token !== INTERNAL) throw new Error('Pregame transition is internal');
    const s = this.state;
    s.pregame.kept[pid] = true;
    const next = s.playerOrder.find(id => !s.pregame.kept[id]);
    if (next) {
      s.pregame.currentPlayer = next;
      s.priorityPlayer = next;
      return;
    }
    s.pregame.active = false;
    s.gameBegun = true;
    s.priorityPlayer = null;
    s.phaseIndex = 0;
    s.phase = PHASES[0];
    s.turn = 1;
    s.activePlayer = s.playerOrder.find(id => !s.players[id].lost) || 'player';
    this._beginPhase(INTERNAL);
  }

  _applyDiscardCards(pid, ids) {
    for (const id of ids) {
      const found = ZoneManager.find(this.state, id);
      const c = this._moveZoneNow(found.card, 'graveyard', found.card.owner);
      this.emit(EVENT.CARD_DISCARDED, { controller: pid, card: c });
    }
    this.state.pendingChoice = null;
    this._completeCleanupTurnBased(INTERNAL);
    return ids;
  }

  _beginPhase(token) {
    if (token !== INTERNAL) throw new Error('Phase transitions are internal; pass priority instead');
    const s = this.state, p = s.players[s.activePlayer];
    s.passes = 0;
    s.turnActionPending = null;
    s.cleanupPriority = false;
    s.priorityPlayer = s.activePlayer;
    if (s.phase === 'UNTAP') {
      this.emit(EVENT.TURN_START, { controller: s.activePlayer, playerId: s.activePlayer, turn: s.turn });
    }
    this.emit(EVENT.PHASE_BEGIN, { controller: s.activePlayer, phase: s.phase });

    switch (s.phase) {
      case 'UNTAP':
        s.cardsDrawnThisTurn[s.activePlayer] = 0;
        s.priorityPlayer = null;
        for (const c of p.battlefield) {
          if (c.phasedOut) c.phasedOut = false;
          c.tapped = false;
          const controlledSince = c.controlledSinceTurn ?? c.createdTurn;
          if (c.summoningSick && controlledSince != null && controlledSince < s.turn) c.summoningSick = false;
        }
        p.landPlaysRemaining = 1 + Number(p.additionalLandPlays || 0);
        p.additionalLandPlays = 0;
        s.castingPermissions = (s.castingPermissions || []).filter(permission => permission.untilTurn != null && permission.untilTurn >= s.turn);
        this._advancePhase(INTERNAL);
        break;
      case 'DRAW':
        this.draw(s.activePlayer);
        s.priorityPlayer = s.activePlayer;
        break;
      case 'UPKEEP':
        this._processSuspendUpkeep(s.activePlayer);
        break;
      case 'PRECOMBAT_MAIN':
        this._advanceSagas(s.activePlayer);
        break;
      case 'BEGIN_COMBAT':
        this.emit(EVENT.BEGIN_COMBAT, { controller: s.activePlayer });
        break;
      case 'DECLARE_ATTACKERS':
        s.turnActionPending = 'DECLARE_ATTACKERS';
        s.priorityPlayer = s.activePlayer;
        break;
      case 'DECLARE_BLOCKERS': {
        const declaredDefenders = (s.combat.defendingPlayers || []).filter(id => s.players[id] && !s.players[id].lost);
        s.combat.blockerQueue = [...declaredDefenders];
        s.combat.currentDefender = s.combat.blockerQueue[0] || null;
        if (s.combat.currentDefender) {
          s.turnActionPending = 'DECLARE_BLOCKERS';
          s.priorityPlayer = s.combat.currentDefender;
        } else {
          s.turnActionPending = null;
          s.priorityPlayer = s.activePlayer;
        }
        break;
      }
      case 'FIRST_STRIKE_DAMAGE':
        this.combat.damageStep(true, INTERNAL);
        s.priorityPlayer = s.winner ? null : s.activePlayer;
        break;
      case 'COMBAT_DAMAGE':
        this.combat.damageStep(false, INTERNAL);
        s.priorityPlayer = s.winner ? null : s.activePlayer;
        break;
      case 'END_COMBAT':
        this.combat.cleanup(INTERNAL);
        break;
      case 'END_STEP':
        this.emit(EVENT.END_STEP, { controller: s.activePlayer });
        for (const player of Object.values(s.players)) {
          for (const permanent of [...player.battlefield]) {
            if (Number(permanent.exileAtEndTurn) === Number(s.turn)) this.exile(permanent);
            else if (Number(permanent.sacrificeAtEndTurn) === Number(s.turn)) this.sacrifice(permanent);
          }
        }
        break;
      case 'CLEANUP':
        this._beginCleanup(INTERNAL);
        break;
      default:
        break;
    }
  }

  _advancePhase(token) {
    if (token !== INTERNAL) throw new Error('Phase transitions are internal; pass priority instead');
    const s = this.state;
    if (s.winner) { s.priorityPlayer = null; return; }
    for (const p of Object.values(s.players)) this.mana.clear(p);
    s.passes = 0;
    s.priorityPlayer = null;
    s.turnActionPending = null;
    s.phaseIndex++;
    if (s.phaseIndex >= PHASES.length) return this._finishTurn(INTERNAL);
    if (PHASES[s.phaseIndex] === 'FIRST_STRIKE_DAMAGE' && !this.combat.needsFirstStrikeStep()) s.phaseIndex++;
    s.phase = PHASES[s.phaseIndex];
    this._beginPhase(INTERNAL);
  }

  _finishTurn(token) {
    if (token !== INTERNAL) throw new Error('Turn transition is internal');
    const s = this.state;
    if (s.winner) { s.priorityPlayer = null; return; }
    for (const p of Object.values(s.players)) this.mana.clear(p);
    const finishingPlayer = s.activePlayer;
    s.turn++;
    if (Number(s.extraTurns?.[finishingPlayer] || 0) > 0) {
      s.extraTurns[finishingPlayer]--;
      s.activePlayer = finishingPlayer;
    } else {
      s.activePlayer = this.nextPlayer(finishingPlayer);
    }
    s.phaseIndex = 0;
    s.phase = PHASES[0];
    s.passes = 0;
    s.priorityPlayer = null;
    s.turnActionPending = null;
    s.cleanupPriority = false;
    this._beginPhase(INTERNAL);
  }

  _castSuspendedCard(card, controller) {
    const found = ZoneManager.find(this.state, card?.instanceId);
    if (!found || found.zone !== 'exile' || !card.suspended) return false;
    found.player?.exile.splice(found.index, 1);
    card.zone = 'stack';
    card.controller = controller;
    card.suspended = false;
    delete card.counters.time;
    const item = { id: `suspend-${card.instanceId}`, type: 'spell', controller, card, targets: [], mode: null, castOption: 'suspend' };
    this.state.stack.push(item);
    this.emit(EVENT.SPELL_CAST, { controller, card, targets: [], castOption: 'suspend' });
    this.log('SUSPEND_CAST', { controller, card: card.cardId, instanceId: card.instanceId });
    return true;
  }

  _processSuspendUpkeep(playerId) {
    const player = this.state.players[playerId];
    for (const card of [...(player?.exile || [])]) {
      if (!card.suspended || Number(card.counters?.time || 0) <= 0) continue;
      card.counters.time--;
      this.log('TIME_COUNTER_REMOVED', { controller: playerId, card: card.cardId, remaining: card.counters.time });
      if (card.counters.time <= 0) this._castSuspendedCard(card, playerId);
    }
  }

  _advanceSagas(playerId) {
    const sagas = [...(this.state.players[playerId]?.battlefield || [])].filter(card => this.static.hasSubtype(card, 'Saga'));
    for (const saga of sagas) this.effects.addCounters(playerId, saga, 'lore', 1);
  }

  _queueSagaChapters(saga, fromChapter, throughChapter) {
    const definition = this.db[saga?.cardId] || {};
    const chapters = definition.sagaChapters || [];
    for (const chapter of chapters.filter(item => item.number >= fromChapter && item.number <= throughChapter)) {
      this.state.stack.push({
        id: `saga-${saga.instanceId}-${chapter.number}-${Date.now()}-${Math.random()}`,
        type: 'trigger', controller: saga.controller, source: structuredClone(saga),
        ability: { type: 'triggered', event: 'LORE_COUNTER_ADDED' },
        effect: { type: 'resolveSagaChapter', chapter: structuredClone(chapter) }, targets: []
      });
      this.log('SAGA_CHAPTER_TRIGGERED', { controller: saga.controller, card: saga.cardId, chapter: chapter.number });
    }
  }

  _beginCleanup(token) {
    if (token !== INTERNAL) throw new Error('Cleanup transition is internal');
    const s = this.state, p = s.players[s.activePlayer];
    s.priorityPlayer = null;
    s.passes = 0;
    s.cleanupPriority = false;
    const maxHand = this.static.maximumHandSize(s.activePlayer);
    const excess = Number.isFinite(maxHand) ? Math.max(0, p.hand.length - maxHand) : 0;
    if (excess > 0) {
      s.pendingChoice = { type: 'CLEANUP_DISCARD', playerId: s.activePlayer, count: excess };
      s.priorityPlayer = s.activePlayer;
      return;
    }
    this._completeCleanupTurnBased(INTERNAL);
  }

  _completeCleanupTurnBased(token) {
    if (token !== INTERNAL) throw new Error('Cleanup transition is internal');
    const s = this.state;
    for (const pp of Object.values(s.players)) {
      pp.damagePrevention = 0;
      for (const c of pp.battlefield) {
        c.damagePrevention = 0;
        c.damageMarked = 0;
        c.deathtouchMarked = false;
        c.modifiers = { power: 0, toughness: 0, keywords: [] };
      }
    }
    this.stateBasedActions();
    if (s.pendingChoice) {
      s.pendingChoice.resume = 'CLEANUP';
      s.priorityPlayer = s.pendingChoice.playerId;
      return;
    }
    if (s.winner) { s.priorityPlayer = null; return; }
    if (s.stack.length) {
      s.cleanupPriority = true;
      s.priorityPlayer = s.activePlayer;
      s.passes = 0;
      return;
    }
    this._finishTurn(INTERNAL);
  }

  _applyPassPriority(pid) {
    const s = this.state;
    s.passes++;
    const requiredPasses = this.livingPlayerIds().length;
    if (s.passes < requiredPasses) {
      s.priorityPlayer = this.nextPriorityPlayer(pid);
      return true;
    }
    s.passes = 0;
    if (s.stack.length) {
      this._resolveTop(INTERNAL);
      if (!s.winner) s.priorityPlayer = s.pendingChoice?.playerId || s.activePlayer;
      return true;
    }
    if (s.phase === 'CLEANUP' && s.cleanupPriority) {
      this._beginCleanup(INTERNAL);
      return true;
    }
    this._advancePhase(INTERNAL);
    return true;
  }

  _resolveTop(token) {
    if (token !== INTERNAL) throw new Error('Stack resolution is internal and occurs after all players pass');
    return this._withDeferredTriggers(() => {
      const item = this.state.stack.pop();
      if (!item) return null;

      if (item.type === 'ward') {
        const targetStillExists = this.state.stack.some(stackItem => stackItem.id === item.targetStackItemId);
        if (targetStillExists) {
          this.state.pendingChoice = {
            type: 'WARD_PAYMENT',
            playerId: item.payingPlayer,
            wardItemId: item.id,
            targetStackItemId: item.targetStackItemId,
            protectedPermanentId: item.protectedPermanentId,
            sourceName: this.db[item.source?.cardId]?.name || 'permanent',
            cost: { ...item.cost }
          };
          this.state.priorityPlayer = item.payingPlayer;
          this.log('WARD_PAYMENT_REQUIRED', {
            controller: item.controller,
            payingPlayer: item.payingPlayer,
            protectedPermanentId: item.protectedPermanentId,
            targetStackItemId: item.targetStackItemId,
            cost: { ...item.cost }
          });
        }
        return item;
      }

      const spellDefinition = item.type === 'spell' ? this.db[item.card.cardId] : null;
      const targetSource = item.type === 'spell' ? this.targetSourceForAction({ mode: item.mode }, spellDefinition) : (item.ability || item.targetSource);
      const sourceObject = item.type === 'spell' ? item.card : item.source;
      let resolutionTargets = item.targets || [];
      const targetedResolution = !!(targetSource && this.targeting.hasTargets(targetSource));
      if (targetedResolution) {
        const checked = this.targeting.recheckTargets(item.controller, targetSource, resolutionTargets, { sourceObject });
        if (checked.allIllegal) {
          if (item.type === 'spell') ZoneManager.place(this.state, item.card, 'graveyard', item.card.owner);
          this.log('COUNTERED_ON_RESOLUTION', {
            stackItemId: item.id,
            controller: item.controller,
            illegalTargets: checked.illegalTargets,
            reason: 'all targets illegal'
          });
          this.stateBasedActions();
          return item;
        }
        resolutionTargets = checked.resolutionTargets;
      }

      if (item.type === 'trigger' || item.type === 'ability') {
        this.effects.resolve(item.effect, { controller: item.controller, source: item.source, sourcePowerAtActivation: item.sourcePowerAtActivation, eventPayload: item.eventPayload, targets: resolutionTargets, selections: item.selections || [], targeted: targetedResolution });
        this.stateBasedActions();
        return item;
      }

      const card = item.card, d = this.db[card.cardId];
      const selectedMode = item.mode ? this._modeFor(d, item.mode) : null;
      const spellEffects = selectedMode ? (selectedMode.effects || []) : (d.spellEffects || []);
      for (const eff of spellEffects) {
        this.effects.resolve(eff, { controller: item.controller, source: card, targets: resolutionTargets, targeted: targetedResolution, mode: item.mode, castOption: item.castOption });
        if (this.state.pendingChoice) break;
      }
      if (this.state.pendingChoice) {
        this.state.pendingResolution = { kind: 'finishSpell', item: structuredClone(item), resolutionTargets: [...resolutionTargets] };
        return item;
      }
      if (item.isCopy && (isType(d, 'Instant') || isType(d, 'Sorcery'))) {
        this.emit(EVENT.SPELL_RESOLVED, { controller: item.controller, card, targets: resolutionTargets.filter(Boolean), copy: true });
        this.stateBasedActions();
        return item;
      }
      if (isType(d, 'Instant') || isType(d, 'Sorcery')) {
        const afterZone = selectedMode?.afterResolutionZone || d.afterResolutionZone || 'graveyard';
        ZoneManager.place(this.state, card, afterZone, card.owner);
      } else {
        if (item.isCopy) {
          card.isToken = true;
          card.owner = item.controller;
        }
        if (d.asEntersChooseType && !card.chosenType) {
          this.state.pendingResolution = { kind: 'permanent', item: structuredClone(item), resolutionTargets: [...resolutionTargets] };
          const options = this.creatureTypeOptions(item.controller);
          this.state.pendingChoice = { type: 'CREATURE_TYPE', playerId: item.controller, cardInstanceId: card.instanceId, cardName: d.name, options, resume: this.state.phase === 'CLEANUP' ? 'CLEANUP' : 'PRIORITY' };
          this.state.priorityPlayer = item.controller;
          return item;
        }
        this._finishPermanentResolution(item, resolutionTargets);
      }
      this.emit(EVENT.SPELL_RESOLVED, { controller: item.controller, card, targets: resolutionTargets });
      this.stateBasedActions();
      return item;
    });
  }

  creatureTypeOptions(pid) {
    const seen = new Set(['Merfolk','Wizard','Druid','Scout','Shaman','Warrior','Rogue','Noble','Soldier','Mutant']);
    const p = this.state.players[pid];
    for (const zone of ['library','hand','battlefield','graveyard','exile','command']) {
      for (const card of p?.[zone] || []) for (const subtype of this.db[card.cardId]?.subtypes || []) seen.add(subtype);
    }
    return [...seen].filter(Boolean).sort((a,b) => (a === 'Merfolk' ? -1 : b === 'Merfolk' ? 1 : a.localeCompare(b)));
  }

  _permanentEntersTapped(card, controller) {
    const d = this.db[card.cardId] || {};
    if (d.entersTapped) return true;
    const rule = d.entersTappedUnless;
    if (!rule) return false;
    const player = this.state.players[controller];
    if (rule.controlLandSubtypes) {
      const has = player.battlefield.some(land => this.static.isType(land, 'Land') && rule.controlLandSubtypes.some(type => this.static.hasSubtype(land, type)));
      return !has;
    }
    if (rule.revealLandSubtypes) return card.entryRevealSucceeded !== true;
    return false;
  }

  _applyEntryCounters(card, controller) {
    const d = this.db[card.cardId] || {};
    if (d.entersWithCounters) {
      const rule = d.entersWithCounters;
      let amount = Number(rule.amount || 0);
      if (rule.amount === 'greatestPowerOther') {
        amount = Math.max(0, ...this.state.players[controller].battlefield.filter(p => p.instanceId !== card.instanceId && this.static.isType(p, 'Creature')).map(p => this.static.derivedStats(p).power));
      }
      if (amount > 0) this.effects.addCounters(controller, card, rule.counter || '+1/+1', amount);
    }
    for (const source of this.state.players[controller].battlefield) {
      if (source.instanceId === card.instanceId || source.phasedOut) continue;
      const sourceDef = this.db[source.cardId] || {};
      for (const ability of sourceDef.abilities || []) {
        if (ability.type !== 'static' || !ability.effect?.entersWithCounter) continue;
        const filter = ability.filter || {};
        if (filter.subtype && !hasSubtype(d, filter.subtype)) continue;
        if (filter.chosenTypeOfSource && (!source.chosenType || !hasSubtype(d, source.chosenType))) continue;
        if (filter.other && source.instanceId === card.instanceId) continue;
        this.effects.addCounters(controller, card, ability.effect.entersWithCounter, Number(ability.effect.amount || 1));
      }
    }
  }

  _finishPermanentResolution(item, resolutionTargets = []) {
    const card = item.card, d = this.db[card.cardId] || {};
    const chosenType = card.chosenType || null;
    const castMode = item.mode || item.castOption || card.castMode || null;
    ZoneManager.place(this.state, card, 'battlefield', item.controller);
    card.chosenType = chosenType;
    card.castMode = castMode;
    card.summoningSick = isType(d, 'Creature') && !hasKeyword(d, 'Haste');
    card.createdTurn = this.state.turn;
    card.controlledSinceTurn = this.state.turn;
    if (this.static.hasSubtype(card, 'Aura') && resolutionTargets[0]) card.attachedTo = resolutionTargets[0];
    card.tapped = this._permanentEntersTapped(card, item.controller);
    this._applyEntryCounters(card, item.controller);
    this.emit(EVENT.ENTER_BATTLEFIELD, { controller: item.controller, target: card, castMode: card.castMode });
    for (const eff of d.onEnterEffects || []) {
      this.effects.resolve(eff, { controller: item.controller, source: card, targets: resolutionTargets, mode: item.mode, castOption: item.castOption });
      if (this.state.pendingChoice) break;
    }
    return card;
  }

  _resumePendingResolution() {
    const pending = this.state.pendingResolution;
    if (!pending || this.state.pendingChoice) return false;
    this.state.pendingResolution = null;
    if (pending.kind === 'permanent') {
      const item = pending.item;
      this._finishPermanentResolution(item, pending.resolutionTargets || []);
      this.emit(EVENT.SPELL_RESOLVED, { controller: item.controller, card: item.card, targets: pending.resolutionTargets || [] });
      this.stateBasedActions();
      return true;
    }
    if (pending.kind === 'finishSpell') {
      const item = pending.item, card = item.card, d = this.db[card.cardId] || {};
      const selectedMode = item.mode ? this._modeFor(d, item.mode) : null;
      if (!item.isCopy) ZoneManager.place(this.state, card, selectedMode?.afterResolutionZone || d.afterResolutionZone || 'graveyard', card.owner);
      this.emit(EVENT.SPELL_RESOLVED, { controller: item.controller, card, targets: pending.resolutionTargets || [], copy: !!item.isCopy });
      this.stateBasedActions();
      return true;
    }
    if (pending.kind === 'land') {
      this._finishLandPlay(pending.playerId, pending.cardInstanceId);
      return true;
    }
    if (pending.kind === 'hideawayLand') {
      this._finishLandPlay(pending.playerId, pending.cardInstanceId, 'exile');
      return true;
    }
    return false;
  }

  canCastTopCard(pid, card) {
    const p = this.state.players[pid];
    if (!p || p.library[0]?.instanceId !== card?.instanceId) return false;
    const def = this.db[card.cardId] || {};
    for (const source of p.battlefield) {
      const sourceDef = this.db[source.cardId] || {};
      for (const ability of sourceDef.abilities || []) {
        if (ability.type !== 'static' || !ability.effect?.castFromTop) continue;
        if (ability.filter?.chosenTypeOfSource && (!source.chosenType || !hasSubtype(def, source.chosenType))) continue;
        if (ability.filter?.subtype && !hasSubtype(def, ability.filter.subtype)) continue;
        if (ability.filter?.type && !isType(def, ability.filter.type)) continue;
        return true;
      }
    }
    return false;
  }

  _validateEncore(pid, action) {
    const found = ZoneManager.find(this.state, action.cardInstanceId);
    if (!found || found.zone !== 'graveyard' || found.player?.id !== pid || found.card.owner !== pid) throw new Error('Encore card must be in your graveyard');
    const definition = this.db[found.card.cardId] || {};
    if (!definition.encoreCost) throw new Error('This card does not have encore');
    if (pid !== this.state.activePlayer || !MAIN_PHASES.includes(this.state.phase) || this.state.stack.length) throw new Error('Encore may only be activated as a sorcery');
    if (!this.mana.canAfford(this.state.players[pid], this.db, definition.encoreCost, 0, this, { kind: 'ability', source: found.card })) throw new Error('Insufficient mana for encore');
    return true;
  }

  _applyEncore(pid, instanceId) {
    const player = this.state.players[pid];
    const found = ZoneManager.find(this.state, instanceId);
    const definition = this.db[found.card.cardId] || {};
    if (!this.mana.autoTapAndPay(player, this.db, definition.encoreCost, 0, this, { kind: 'ability', source: found.card })) throw new Error('Insufficient mana for encore');
    const source = structuredClone(found.card);
    this._moveZoneNow(found.card, 'exile', found.card.owner);
    this.state.stack.push({
      id: `encore-${instanceId}-${Date.now()}`,
      type: 'ability',
      controller: pid,
      source,
      ability: { type: 'activated', effect: { type: 'encore', cardId: source.cardId } },
      effect: { type: 'encore', cardId: source.cardId },
      targets: []
    });
    this.state.priorityPlayer = pid;
    this.state.passes = 0;
    return true;
  }

  _validateForetell(pid, action) {
    const f = ZoneManager.find(this.state, action.cardInstanceId);
    if (!f || f.zone !== 'hand' || f.player?.id !== pid) throw new Error('Foretell card must be in your hand');
    const d = this.db[f.card.cardId];
    if (!d?.foretellCost) throw new Error('This card does not have foretell');
    if (pid !== this.state.activePlayer || !MAIN_PHASES.includes(this.state.phase) || this.state.stack.length) throw new Error('Foretell may only be used during your turn at sorcery speed');
    if (!this.mana.canAfford(this.state.players[pid], this.db, '{2}', 0, this, { kind: 'other' })) throw new Error('Insufficient mana to foretell');
    return true;
  }

  _applyForetell(pid, instanceId) {
    const p = this.state.players[pid];
    if (!this.mana.autoTapAndPay(p, this.db, '{2}', 0, this, { kind: 'other' })) throw new Error('Insufficient mana to foretell');
    const found = ZoneManager.find(this.state, instanceId);
    const card = this._moveZoneNow(found.card, 'exile', pid);
    card.foretold = true;
    card.faceDown = true;
    card.foretoldTurn = this.state.turn;
    this.state.priorityPlayer = pid;
    this.state.passes = 0;
    return card;
  }

  canCast(pid, card, zone = null, { mode = null, targets = [], castOption = null } = {}) {
    if (!card || !this.db[card.cardId] || !this.state.players[pid]) return false;
    const actualZone = zone || ZoneManager.find(this.state, card.instanceId)?.zone || card.zone;
    const info = this._castCostInfo(pid, card, actualZone, mode, targets, castOption);
    return this.mana.canAfford(this.state.players[pid], this.db, info.cost, 0, this, { kind: 'cast', card });
  }

  _applyCast(pid, instanceId, targets, mode = null, castOption = null, retraceLandInstanceId = null) {
    const p = this.state.players[pid], loc = ZoneManager.find(this.state, instanceId), c = loc.card, d = this.db[c.cardId];
    const info = this._castCostInfo(pid, c, loc.zone, mode, targets, castOption);
    this._lastPaymentPlan = [];
    if (!this.mana.autoTapAndPay(p, this.db, info.cost, 0, this, { kind: 'cast', card: c })) throw new Error('Insufficient mana');
    if (c.freeCast) delete c.freeCast;
    if (castOption === 'hideaway') { delete c.faceDown; delete c.exiledBy; }
    if (castOption === 'foretold') delete c.faceDown;
    if (castOption === 'retrace') {
      const land = p.hand.find(card => card.instanceId === retraceLandInstanceId && isType(this.db[card.cardId], 'Land'));
      if (!land) throw new Error('Retrace requires the chosen land card to remain in your hand');
      this._moveZoneNow(land, 'graveyard', land.owner);
      this.emit(EVENT.CARD_DISCARDED, { controller: pid, card: land });
    }
    loc.player?.[loc.zone]?.splice(loc.index, 1);
    if (loc.zone === 'stack') throw new Error('Cannot cast a spell already on the stack');
    c.zone = 'stack';
    c.castMode = mode || castOption || null;
    c.foretold = false;
    delete c.foretoldTurn;
    const item = { id: `spell-${c.instanceId}`, type: 'spell', controller: pid, card: c, targets: [...targets], mode, castOption };
    this.state.stack.push(item);
    if (c.isCommander && loc.zone === 'command') p.commanderTax += 2;
    this.emit(EVENT.SPELL_CAST, { controller: pid, card: c, targets: [...targets], mode, castOption });
    if (d.castCopyCondition?.permanentCardsMin != null) {
      const permanentCards = p.graveyard.filter(card => {
        const definition = this.db[card.cardId] || {};
        return !isType(definition, 'Instant') && !isType(definition, 'Sorcery');
      }).length;
      if (permanentCards >= Number(d.castCopyCondition.permanentCardsMin)) {
        this.state.stack.push({
          id: `cast-copy-trigger-${c.instanceId}-${Date.now()}`,
          type: 'trigger', controller: pid, source: structuredClone(c),
          ability: { type: 'triggered', event: EVENT.SPELL_CAST },
          effect: { type: 'copySpellByInstance', spellInstanceId: c.instanceId, copies: Number(d.castCopyCondition.copies || 1) },
          targets: []
        });
      }
    }
    if (this._lastPaymentPlan?.length) this.emit(EVENT.MANA_SPENT_TO_CAST, { controller: pid, card: c, manaSourceIds: [...this._lastPaymentPlan] });
    this._queueWardTriggers(item, pid, targets);
    this.state.priorityPlayer = pid;
    this.state.passes = 0;
    return c;
  }

  _revealEntryCandidates(pid, definition, excludeInstanceId = null) {
    const subtypes = definition?.entersTappedUnless?.revealLandSubtypes || [];
    if (!subtypes.length) return [];
    return this.state.players[pid].hand.filter(card => card.instanceId !== excludeInstanceId && isType(this.db[card.cardId], 'Land') && subtypes.some(type => hasSubtype(this.db[card.cardId], type)));
  }

  _openEntryRevealChoice(pid, card, definition, extra = {}) {
    const candidates = this._revealEntryCandidates(pid, definition, card.instanceId);
    if (!definition?.entersTappedUnless?.revealLandSubtypes || !candidates.length || card.entryRevealResolved) return false;
    this.state.pendingChoice = {
      type: 'ENTRY_REVEAL',
      playerId: pid,
      cardInstanceId: card.instanceId,
      cardName: definition.name,
      candidateIds: candidates.map(candidate => candidate.instanceId),
      ...extra,
      resume: extra.resume || (this.state.phase === 'CLEANUP' ? 'CLEANUP' : 'PRIORITY')
    };
    this.state.priorityPlayer = pid;
    this.state.passes = 0;
    return true;
  }

  _applyCopyTargetChoice(pid, targetIds) {
    const choice = this.state.pendingChoice;
    if (!choice || choice.type !== 'COPY_TARGETS' || choice.playerId !== pid) throw new Error('No spell-copy target choice is pending');
    this.state.pendingChoice = null;
    const result = this.effects.resolveCopyTargetChoice(choice, targetIds);
    if (!this.state.pendingChoice) this._resumeAfterRulesChoice(choice);
    return result;
  }

  _applyEntryRevealChoice(pid, revealedCardInstanceId) {
    const choice = this.state.pendingChoice;
    if (!choice || choice.type !== 'ENTRY_REVEAL' || choice.playerId !== pid) throw new Error('No entry reveal choice is pending');
    this.state.pendingChoice = null;
    const found = ZoneManager.find(this.state, choice.cardInstanceId);
    if (!found?.card) throw new Error('The entering land is no longer available');
    found.card.entryRevealResolved = true;
    found.card.entryRevealSucceeded = revealedCardInstanceId != null;
    this.log('ENTRY_REVEAL_CHOICE', { controller: pid, cardInstanceId: choice.cardInstanceId, revealedCardInstanceId: revealedCardInstanceId || null });
    if (choice.landEffect) this._finishPutLandEffect(pid, choice.cardInstanceId, choice.landEffect);
    else this._resumePendingResolution();
    if (!this.state.pendingChoice) this._resumeAfterRulesChoice(choice);
    return revealedCardInstanceId;
  }

  _finishPutLandEffect(pid, instanceId, { tapped = false } = {}) {
    const found = ZoneManager.find(this.state, instanceId);
    if (!found || found.zone !== 'hand' || found.player?.id !== pid || !isType(this.db[found.card.cardId], 'Land')) return null;
    const definition = this.db[found.card.cardId] || {};
    const chosenType = found.card.chosenType || null;
    const naturalTapped = this._permanentEntersTapped(found.card, pid);
    const card = this._moveZoneNow(found.card, 'battlefield', pid);
    card.chosenType = chosenType;
    card.createdTurn = this.state.turn;
    card.controlledSinceTurn = this.state.turn;
    card.tapped = !!tapped || naturalTapped;
    this._applyEntryCounters(card, pid);
    this.emit(EVENT.ENTER_BATTLEFIELD, { controller: pid, target: card });
    for (const effect of definition.onEnterEffects || []) {
      this.effects.resolve(effect, { controller: pid, source: card });
      if (this.state.pendingChoice) break;
    }
    return card;
  }

  _beginPutLandEffect(pid, instanceId, { tapped = false, resume = null } = {}) {
    const found = ZoneManager.find(this.state, instanceId);
    if (!found || found.zone !== 'hand' || found.player?.id !== pid || !isType(this.db[found.card.cardId], 'Land')) {
      throw new Error('The selected land is no longer available in your hand');
    }
    const definition = this.db[found.card.cardId] || {};
    const resumeMode = resume || (this.state.phase === 'CLEANUP' ? 'CLEANUP' : 'PRIORITY');

    if (definition.asEntersChooseType && !found.card.chosenType) {
      this.state.pendingChoice = {
        type: 'CREATURE_TYPE',
        playerId: pid,
        cardInstanceId: instanceId,
        cardName: definition.name,
        options: this.creatureTypeOptions(pid),
        landEffect: { tapped: !!tapped },
        resume: resumeMode
      };
      this.state.priorityPlayer = pid;
      this.state.passes = 0;
      return found.card;
    }

    if (definition.entersTappedUnless?.revealLandSubtypes && !found.card.entryRevealResolved) {
      const candidates = this._revealEntryCandidates(pid, definition, found.card.instanceId);
      if (candidates.length) {
        this._openEntryRevealChoice(pid, found.card, definition, { landEffect: { tapped: !!tapped }, resume: resumeMode });
        return found.card;
      }
      found.card.entryRevealResolved = true;
      found.card.entryRevealSucceeded = false;
    }

    return this._finishPutLandEffect(pid, instanceId, { tapped: !!tapped });
  }

  _applyPlayLand(pid, instanceId) {
    const found = ZoneManager.find(this.state, instanceId);
    const definition = this.db[found?.card?.cardId] || {};
    if (definition.asEntersChooseType && !found.card.chosenType) {
      this.state.pendingResolution = { kind: 'land', playerId: pid, cardInstanceId: instanceId };
      this.state.pendingChoice = {
        type: 'CREATURE_TYPE',
        playerId: pid,
        cardInstanceId: instanceId,
        cardName: definition.name,
        options: this.creatureTypeOptions(pid),
        resume: this.state.phase === 'CLEANUP' ? 'CLEANUP' : 'PRIORITY'
      };
      this.state.priorityPlayer = pid;
      this.state.passes = 0;
      return found.card;
    }
    if (definition.entersTappedUnless?.revealLandSubtypes && !found.card.entryRevealResolved) {
      const candidates = this._revealEntryCandidates(pid, definition, found.card.instanceId);
      if (candidates.length) {
        this.state.pendingResolution = { kind: 'land', playerId: pid, cardInstanceId: instanceId };
        this._openEntryRevealChoice(pid, found.card, definition);
        return found.card;
      }
      found.card.entryRevealResolved = true;
      found.card.entryRevealSucceeded = false;
    }
    return this._finishLandPlay(pid, instanceId);
  }

  _finishLandPlay(pid, instanceId, fromZone = 'hand') {
    return this._withDeferredTriggers(() => {
      const p = this.state.players[pid];
      const found = ZoneManager.find(this.state, instanceId);
      if (!found || found.zone !== fromZone || found.player?.id !== pid) throw new Error('Land is no longer available to play');
      const definition = this.db[found.card.cardId] || {};
      if (fromZone === 'exile') { delete found.card.faceDown; delete found.card.exiledBy; }
      const chosenType = found.card.chosenType || null;
      const entersTapped = this._permanentEntersTapped(found.card, pid);
      const c = this._moveZoneNow(found.card, 'battlefield', pid);
      c.chosenType = chosenType;
      c.createdTurn = this.state.turn;
      c.controlledSinceTurn = this.state.turn;
      c.tapped = entersTapped;
      this._applyEntryCounters(c, pid);
      p.landPlaysRemaining--;
      this.emit(EVENT.LAND_PLAYED, { controller: pid, target: c, manaSpent: 0 });
      this.emit(EVENT.ENTER_BATTLEFIELD, { controller: pid, target: c });
      for (const eff of definition.onEnterEffects || []) {
        this.effects.resolve(eff, { controller: pid, source: c });
        if (this.state.pendingChoice) break;
      }
      this.stateBasedActions();
      this.state.priorityPlayer = this.state.pendingChoice?.playerId || pid;
      this.state.passes = 0;
      return c;
    });
  }

  _payAbilityCosts(pid, perm, ability, { defaultTap = false, selections = [], targets = [] } = {}) {
    const p = this.state.players[pid];
    const rawManaCost = ability.cost?.mana || ability.manaCost || '';
    const manaCost = this._adjustGenericCost(rawManaCost, this.static.targetingTax(pid, targets));
    if (manaCost && !this.mana.autoTapAndPay(p, this.db, manaCost, 0, this, { kind: 'ability', source: perm, ability })) throw new Error('Insufficient mana for ability');
    if (defaultTap ? ability.tap !== false : !!ability.tap) this.tapPermanent(perm);
    if (ability.selection?.tap !== false) for (const id of selections) this.tapPermanent(this.findPermanent(id));
    if (ability.cost?.life) this.changeLife(pid, -ability.cost.life);
    if (ability.cost?.removeCounterSelf) {
      const spec = ability.cost.removeCounterSelf;
      const type = spec.counter || '+1/+1';
      const amount = Number(spec.amount || 1);
      perm.counters[type] = Math.max(0, Number(perm.counters[type] || 0) - amount);
      if (!perm.counters[type]) delete perm.counters[type];
    }
    if (ability.cost?.removeCounterFromSelection) {
      const spec = ability.cost.removeCounterFromSelection;
      const type = spec.counter || '+1/+1';
      const amount = Number(spec.amount || 1);
      for (const id of selections) {
        const selected = this.findPermanent(id);
        if (!selected || Number(selected.counters?.[type] || 0) < amount) throw new Error('Selected permanent lacks the required counter');
        selected.counters[type] -= amount;
        if (selected.counters[type] <= 0) delete selected.counters[type];
      }
    }
    if (ability.cost?.sacrificeSelf) {
      if (!this.findPermanent(perm.instanceId)) throw new Error('Ability source cannot be sacrificed');
      this.sacrifice(perm);
    }
  }

  _applyActivateMana(pid, permanentId, ability, manaColor = null) {
    return this._withDeferredTriggers(() => {
      const perm = this.findPermanent(permanentId);
      this._payAbilityCosts(pid, perm, ability, { defaultTap: true });
      const player = this.state.players[pid];
      const mana = ability.anyColor ? { [manaColor]: ability.amount || 1 } : (ability.mana || {});
      this.mana.add(player, mana);
      this.stateBasedActions();
      this.state.priorityPlayer = this.state.pendingChoice?.playerId || pid;
      this.state.passes = 0;
      return true;
    });
  }

  _applyActivateAbility(pid, permanentId, ability, targets, selections = []) {
    return this._withDeferredTriggers(() => {
      const perm = this.findPermanent(permanentId);
      const sourceSnapshot = structuredClone(perm);
      const sourcePowerAtActivation = this.static.derivedStats(perm).power;
      this._payAbilityCosts(pid, perm, ability, { selections, targets });
      const item = {
        id: `ability-${Date.now()}-${Math.random()}`,
        type: 'ability',
        controller: pid,
        source: ability.cost?.sacrificeSelf ? sourceSnapshot : perm,
        ability: structuredClone(ability),
        effect: ability.effect,
        sourcePowerAtActivation,
        targets: [...targets],
        selections: [...selections]
      };
      this.state.stack.push(item);
      this._queueWardTriggers(item, pid, targets);
      this.stateBasedActions();
      this.state.priorityPlayer = this.state.pendingChoice?.playerId || pid;
      this.state.passes = 0;
      return true;
    });
  }

  _queueWardTriggers(targetStackItem, actorPid, targets) {
    for (const trigger of this.targeting.wardTriggersForTargets(actorPid, targetStackItem.id, targets)) {
      const wardItem = { id: `ward-${Date.now()}-${Math.random()}`, ...trigger };
      this.state.stack.push(wardItem);
      this.log('WARD_TRIGGERED', {
        controller: wardItem.controller,
        payingPlayer: wardItem.payingPlayer,
        protectedPermanentId: wardItem.protectedPermanentId,
        targetStackItemId: wardItem.targetStackItemId,
        cost: { ...wardItem.cost }
      });
    }
  }

  canPayWard(choice = this.state.pendingChoice) {
    if (!choice || choice.type !== 'WARD_PAYMENT') return false;
    const p = this.state.players[choice.playerId];
    if (!p) return false;
    const mana = choice.cost?.mana || '';
    const life = Number(choice.cost?.life || 0);
    if (life > p.life) return false;
    return !mana || this.mana.canAfford(p, this.db, mana, 0, this, { kind: 'other' });
  }

  _applyWardChoice(pid, pay) {
    const choice = this.state.pendingChoice;
    if (!choice || choice.type !== 'WARD_PAYMENT' || choice.playerId !== pid) throw new Error('No ward payment choice is pending');
    const p = this.state.players[pid];
    this.state.pendingChoice = null;

    if (pay) {
      const mana = choice.cost?.mana || '';
      if (mana && !this.mana.autoTapAndPay(p, this.db, mana, 0, this, { kind: 'other' })) throw new Error('Ward mana payment failed');
      const life = Number(choice.cost?.life || 0);
      if (life) this.changeLife(pid, -life);
      this.log('WARD_PAID', { playerId: pid, targetStackItemId: choice.targetStackItemId, cost: { ...choice.cost } });
    } else {
      this._counterStackItem(choice.targetStackItemId, 'ward');
      this.log('WARD_NOT_PAID', { playerId: pid, targetStackItemId: choice.targetStackItemId });
    }

    this.stateBasedActions();
    if (this.state.pendingChoice) this.state.priorityPlayer = this.state.pendingChoice.playerId;
    else if (this.state.winner) this.state.priorityPlayer = null;
    else this.state.priorityPlayer = this.state.activePlayer;
    this.state.passes = 0;
    return pay;
  }

  _counterStackItem(stackItemId, reason = 'countered') {
    const index = this.state.stack.findIndex(item => item.id === stackItemId);
    if (index < 0) return null;
    const [item] = this.state.stack.splice(index, 1);
    if (item.type === 'spell' && item.card) ZoneManager.place(this.state, item.card, 'graveyard', item.card.owner);
    this.log('STACK_ITEM_COUNTERED', { stackItemId, controller: item.controller, reason, cardId: item.card?.cardId || null });
    return item;
  }

  _applyOptionalTriggerChoice(pid, accept) {
    const choice = this.state.pendingChoice;
    this.triggers.chooseOptional(choice.triggerId, accept);
    this._resumeAfterRulesChoice(choice);
    return accept;
  }

  _applyOptionalManaPaymentChoice(pid, pay) {
    const choice = this.state.pendingChoice;
    if (!choice || choice.type !== 'OPTIONAL_MANA_PAYMENT' || choice.playerId !== pid) throw new Error('No optional mana payment is pending');
    this.state.pendingChoice = null;
    if (pay) {
      if (!this.mana.autoTapAndPay(this.state.players[pid], this.db, choice.mana || '', 0, this, { kind: 'other' })) throw new Error('Optional mana payment failed');
      if (choice.then) this.effects.resolve(choice.then, { ...(choice.context || {}), controller: pid });
    }
    if (!this.state.pendingChoice) this._resumePendingResolution();
    if (!this.state.pendingChoice) this._resumeAfterRulesChoice(choice);
    return pay;
  }

  _applyTapOrUntapChoice(pid, result) {
    const choice = this.state.pendingChoice;
    if (!choice || choice.type !== 'TAP_OR_UNTAP' || choice.playerId !== pid) throw new Error('No tap-or-untap choice is pending');
    this.state.pendingChoice = null;
    const target = this.findPermanent(choice.targetId);
    if (target && result === 'tap') this.tapPermanent(target);
    else if (target && result === 'untap') this.untapPermanent(target);
    if (!this.state.pendingChoice) this._resumePendingResolution();
    if (!this.state.pendingChoice) this._resumeAfterRulesChoice(choice);
    return result;
  }

  _applyOptionalEffectChoice(pid, accept) {
    const choice = this.state.pendingChoice;
    if (!choice || choice.type !== 'OPTIONAL_EFFECT' || choice.playerId !== pid) throw new Error('No optional effect choice is pending');
    this.state.pendingChoice = null;
    if (accept && choice.then) this.effects.resolve(choice.then, { ...(choice.context || {}), controller: pid });
    if (!this.state.pendingChoice) this._resumePendingResolution();
    if (!this.state.pendingChoice) this._resumeAfterRulesChoice(choice);
    return accept;
  }

  _applyTriggerOrder(pid, triggerIds) {
    const choice = this.state.pendingChoice;
    this.triggers.orderTriggers(triggerIds);
    this._resumeAfterRulesChoice(choice);
    return triggerIds;
  }

  _applyProliferateChoice(pid, targetIds) {
    const choice = this.state.pendingChoice;
    this.effects.chooseProliferate(pid, targetIds);
    if (!this.state.pendingChoice) this._resumePendingResolution();
    if (!this.state.pendingChoice) this._resumeAfterRulesChoice(choice);
    return targetIds;
  }

  _applyPhaseOutProliferatedChoice(pid, permanentIds) {
    const choice = this.state.pendingChoice;
    if (!choice || choice.type !== 'PHASE_OUT_PROLIFERATED' || choice.playerId !== pid) throw new Error('No Ripples of Potential phase-out choice is pending');
    this.state.pendingChoice = null;
    for (const id of permanentIds) {
      const permanent = this.findPermanent(id);
      if (permanent?.controller === pid && choice.eligibleIds.includes(id)) permanent.phasedOut = true;
    }
    this._resumePendingResolution();
    if (!this.state.pendingChoice) this._resumeAfterRulesChoice(choice);
    return permanentIds;
  }

  _applyReplacementOrder(pid, replacementIds) {
    const choice = this.state.pendingChoice;
    this.effects.resolveCounterReplacementChoice(choice, replacementIds);
    if (!this.state.pendingChoice) this._resumePendingResolution();
    if (!this.state.pendingChoice) this._resumeAfterRulesChoice(choice);
    return replacementIds;
  }

  _applyExploreChoice(pid, putInGraveyard) {
    const choice = this.state.pendingChoice;
    const result = this.effects.chooseExplore(pid, putInGraveyard);
    this._resumeAfterRulesChoice(choice);
    return result;
  }

  _applyExploreOrder(pid, permanentIds) {
    const choice = this.state.pendingChoice;
    this.state.pendingChoice = null;
    this.state.pendingExploreQueue = [...permanentIds];
    this.effects.resumeDeferred();
    this._resumeAfterRulesChoice(choice);
    return permanentIds;
  }

  _applyHakbalAttackChoice(pid, landInstanceId) {
    const choice = this.state.pendingChoice;
    this.state.pendingChoice = null;
    if (landInstanceId) {
      this._beginPutLandEffect(pid, landInstanceId, { tapped: false, resume: choice.resume });
    } else {
      this.draw(pid, 1);
    }
    if (!this.state.pendingChoice) this._resumeAfterRulesChoice(choice);
    return landInstanceId;
  }

  _applyCultivateChoice(pid, cardInstanceIds) {
    const choice = this.state.pendingChoice;
    const player = this.state.players[pid];
    this.state.pendingChoice = null;
    const [battlefieldId, handId] = cardInstanceIds;
    if (battlefieldId) {
      const found = ZoneManager.find(this.state, battlefieldId);
      const card = this._moveZoneNow(found.card, 'battlefield', pid);
      card.tapped = true;
      card.createdTurn = this.state.turn;
      card.controlledSinceTurn = this.state.turn;
      this.emit(EVENT.ENTER_BATTLEFIELD, { controller: pid, target: card });
    }
    if (handId) {
      const found = ZoneManager.find(this.state, handId);
      if (found) this._moveZoneNow(found.card, 'hand', pid);
    }
    player.library = shuffle([...player.library], this.rng);
    this._resumeAfterRulesChoice(choice);
    return cardInstanceIds;
  }

  _applySisayTutorChoice(pid, cardInstanceId) {
    const choice = this.state.pendingChoice;
    const player = this.state.players[pid];
    this.state.pendingChoice = null;
    if (cardInstanceId) {
      const found = ZoneManager.find(this.state, cardInstanceId);
      if (found) {
        const card = this._moveZoneNow(found.card, 'battlefield', pid);
        const definition = this.db[card.cardId];
        card.summoningSick = isType(definition, 'Creature') && !hasKeyword(definition, 'Haste');
        card.createdTurn = this.state.turn;
        card.controlledSinceTurn = this.state.turn;
        this.emit(EVENT.ENTER_BATTLEFIELD, { controller: pid, target: card });
      }
    }
    player.library = shuffle([...player.library], this.rng);
    this._resumeAfterRulesChoice(choice);
    return cardInstanceId;
  }

  _applyScryChoice(pid, putOnBottom) {
    const choice = this.state.pendingChoice;
    const player = this.state.players[pid];
    this.state.pendingChoice = null;
    if (putOnBottom && player.library[0]?.instanceId === choice.cardInstanceId) player.library.push(player.library.shift());
    this._resumeAfterRulesChoice(choice);
    return putOnBottom;
  }

  _applyTriggerTargetChoice(pid, targetIds) {
    const choice = this.state.pendingChoice;
    this.triggers.chooseTargets(choice.triggerId, targetIds);
    this._resumeAfterRulesChoice(choice);
    return targetIds;
  }

  _applyCreatureTypeChoice(pid, creatureType) {
    const choice = this.state.pendingChoice;
    this.state.pendingChoice = null;
    const pending = this.state.pendingResolution;
    if (pending?.item?.card?.instanceId === choice.cardInstanceId) pending.item.card.chosenType = creatureType;
    const zoned = ZoneManager.find(this.state, choice.cardInstanceId);
    if (zoned?.card) zoned.card.chosenType = creatureType;
    const permanent = this.findPermanent(choice.cardInstanceId);
    if (permanent) permanent.chosenType = creatureType;
    this.log('CREATURE_TYPE_CHOSEN', { controller: pid, cardInstanceId: choice.cardInstanceId, creatureType });
    if (choice.landEffect) {
      const found = ZoneManager.find(this.state, choice.cardInstanceId);
      const definition = this.db[found?.card?.cardId] || {};
      if (found?.card && definition.entersTappedUnless?.revealLandSubtypes && !found.card.entryRevealResolved) {
        const candidates = this._revealEntryCandidates(pid, definition, found.card.instanceId);
        if (candidates.length) {
          this._openEntryRevealChoice(pid, found.card, definition, { landEffect: choice.landEffect, resume: choice.resume });
          return creatureType;
        }
      }
      this._finishPutLandEffect(pid, choice.cardInstanceId, choice.landEffect);
    }
    this._resumePendingResolution();
    if (!this.state.pendingChoice) this._resumeAfterRulesChoice(choice);
    return creatureType;
  }

  _applyEffectCardChoice(pid, cardInstanceIds) {
    const choice = this.state.pendingChoice;
    this.state.pendingChoice = null;
    this.effects.resolveEffectCardChoice(choice, cardInstanceIds);
    this._resumePendingResolution();
    if (!this.state.pendingChoice) this._resumeAfterRulesChoice(choice);
    return cardInstanceIds;
  }

  _applyHideawayChoice(pid, cardInstanceId) {
    const choice = this.state.pendingChoice;
    this.state.pendingChoice = null;
    this.effects.resolveHideawayChoice(choice, cardInstanceId);
    this._resumePendingResolution();
    if (!this.state.pendingChoice) this._resumeAfterRulesChoice(choice);
    return cardInstanceId;
  }

  _applyHideawayDecline(pid) {
    const choice = this.state.pendingChoice;
    if (!choice || choice.type !== 'HIDEAWAY_PLAY' || choice.playerId !== pid) throw new Error('No hideaway play choice is pending');
    this.state.pendingChoice = null;
    this._resumeAfterRulesChoice(choice);
    return false;
  }

  _applyHideawayCast(pid, action) {
    const choice = this.state.pendingChoice;
    if (!choice || choice.type !== 'HIDEAWAY_PLAY' || choice.playerId !== pid || action.cardInstanceId !== choice.cardInstanceId) throw new Error('No matching hideaway spell choice is pending');
    this.state.pendingChoice = null;
    const result = this._applyCast(pid, action.cardInstanceId, action.targets || [], action.mode || null, 'hideaway', null);
    if (!this.state.pendingChoice) this._resumeAfterRulesChoice(choice);
    return result;
  }

  _applyHideawayLand(pid, cardInstanceId) {
    const choice = this.state.pendingChoice;
    if (!choice || choice.type !== 'HIDEAWAY_PLAY' || choice.playerId !== pid || cardInstanceId !== choice.cardInstanceId) throw new Error('No matching hideaway land choice is pending');
    this.state.pendingChoice = null;
    const found = ZoneManager.find(this.state, cardInstanceId);
    const definition = this.db[found?.card?.cardId] || {};
    if (!found?.card) throw new Error('The hidden land is no longer available');

    if (definition.asEntersChooseType && !found.card.chosenType) {
      this.state.pendingResolution = { kind: 'hideawayLand', playerId: pid, cardInstanceId };
      this.state.pendingChoice = {
        type: 'CREATURE_TYPE', playerId: pid, cardInstanceId, cardName: definition.name,
        options: this.creatureTypeOptions(pid), resume: choice.resume || (this.state.phase === 'CLEANUP' ? 'CLEANUP' : 'PRIORITY')
      };
      this.state.priorityPlayer = pid;
      this.state.passes = 0;
      return found.card;
    }
    if (definition.entersTappedUnless?.revealLandSubtypes && !found.card.entryRevealResolved) {
      const candidates = this._revealEntryCandidates(pid, definition, found.card.instanceId);
      if (candidates.length) {
        this.state.pendingResolution = { kind: 'hideawayLand', playerId: pid, cardInstanceId };
        this._openEntryRevealChoice(pid, found.card, definition);
        return found.card;
      }
      found.card.entryRevealResolved = true;
      found.card.entryRevealSucceeded = false;
    }
    const result = this._finishLandPlay(pid, cardInstanceId, 'exile');
    if (!this.state.pendingChoice) this._resumeAfterRulesChoice(choice);
    return result;
  }

  _applyDeclareAttackers(pid, ids, attackTargets = {}) {
    const result = this.combat.declareAttackers(pid, ids, attackTargets, INTERNAL);
    this.state.turnActionPending = null;
    this.state.priorityPlayer = this.state.activePlayer;
    this.state.passes = 0;
    return result;
  }

  _applyDeclareBlockers(pid, map) {
    const result = this.combat.declareBlockers(pid, map, INTERNAL);
    this.state.passes = 0;
    const queue = this.state.combat.blockerQueue || [];
    if (queue[0] === pid) queue.shift();
    else {
      const index = queue.indexOf(pid);
      if (index >= 0) queue.splice(index, 1);
    }
    this.state.combat.currentDefender = queue[0] || null;
    if (this.state.combat.currentDefender) {
      this.state.turnActionPending = 'DECLARE_BLOCKERS';
      this.state.priorityPlayer = this.state.combat.currentDefender;
      return result;
    }

    this.state.turnActionPending = null;
    const requiredOrders = this.combat.requiredDamageAssignmentOrders();
    if (Object.keys(requiredOrders).length) {
      this.state.pendingChoice = {
        type: 'COMBAT_DAMAGE_ORDER',
        playerId: this.state.activePlayer,
        attackers: requiredOrders
      };
    }
    this.state.priorityPlayer = this.state.activePlayer;
    return result;
  }

  _applyOrderBlockers(pid, orders) {
    const result = this.combat.setDamageAssignmentOrder(pid, orders, INTERNAL);
    this.state.pendingChoice = null;
    this.state.priorityPlayer = this.state.activePlayer;
    this.state.passes = 0;
    return result;
  }

  _applyLegendChoice(pid, keepInstanceId) {
    return this._withDeferredTriggers(() => {
      const choice = this.state.pendingChoice;
      const permanents = choice.permanentIds.map(id => this.findPermanent(id)).filter(Boolean);
      this.state.pendingChoice = null;
      for (const permanent of permanents) {
        if (permanent.instanceId !== keepInstanceId) this.toGraveyard(permanent, true);
      }
      this._resumeAfterRulesChoice(choice);
      return keepInstanceId;
    });
  }

  _applyCommanderZoneChoice(pid, moveToCommand) {
    return this._withDeferredTriggers(() => {
      const choice = this.state.pendingChoice;
      const found = ZoneManager.find(this.state, choice.commanderId);
      this.state.pendingChoice = null;

      if (choice.replacement) {
        if (found) this._moveZoneNow(found.card, moveToCommand ? 'command' : choice.destination, found.card.owner);
      } else if (found) {
        delete found.card.commanderZoneChoicePending;
        if (moveToCommand) this._moveZoneNow(found.card, 'command', found.card.owner);
      }

      this._resumeAfterRulesChoice(choice);
      return moveToCommand;
    });
  }

  _resumeAfterRulesChoice(choice) {
    this.stateBasedActions();
    if (!this.state.pendingChoice && !this.state.winner) {
      this.effects.resumeDeferred();
      if (!this.state.pendingChoice) this.stateBasedActions();
    }
    if (this.state.winner) {
      this.state.priorityPlayer = null;
      return;
    }
    if (this.state.pendingChoice) {
      this.state.priorityPlayer = this.state.pendingChoice.playerId;
      return;
    }
    if (choice.resume === 'CLEANUP') {
      this._completeCleanupTurnBased(INTERNAL);
      return;
    }
    this.state.priorityPlayer = this.state.activePlayer;
    this.state.passes = 0;
  }

  // Compatibility helpers intentionally route back through the authoritative gateway.
  mulligan(pid) { return this.perform(pid, { type: 'MULLIGAN' }); }
  keepHand(pid) { return this.perform(pid, { type: 'KEEP_HAND' }); }
  bottomCards(pid, cardInstanceIds) { return this.perform(pid, { type: 'BOTTOM_CARDS', cardInstanceIds }); }
  discardCards(pid, cardInstanceIds) { return this.perform(pid, { type: 'DISCARD_CARDS', cardInstanceIds }); }
  cast(pid, instanceId, targets = []) {
    const f = ZoneManager.find(this.state, instanceId);
    return this.perform(pid, { type: f?.zone === 'command' ? 'CAST_COMMANDER' : 'CAST_SPELL', cardInstanceId: instanceId, targets });
  }
  playLand(pid, instanceId) { return this.perform(pid, { type: 'PLAY_LAND', cardInstanceId: instanceId }); }
  activateMana(pid, permanentId, ability, manaColor = null) { return this.perform(pid, { type: 'ACTIVATE_MANA', permanentId, ability, ...(manaColor ? { manaColor } : {}) }); }
  activateAbility(pid, permanentId, ability, targets = []) { return this.perform(pid, { type: 'ACTIVATE_ABILITY', permanentId, ability, targets }); }
  chooseExplore(pid, putInGraveyard) { return this.perform(pid, { type: 'CHOOSE_EXPLORE', putInGraveyard }); }
  passPriority(pid) { return this.perform(pid, { type: 'PASS_PRIORITY' }); }

  changeController(permanentId, newController) {
    const s = this.state;
    if (!s.players[newController]) throw new Error('Unknown new controller');
    let sourcePlayer = null;
    let index = -1;
    for (const player of Object.values(s.players)) {
      index = player.battlefield.findIndex(c => c.instanceId === permanentId);
      if (index >= 0) { sourcePlayer = player; break; }
    }
    if (!sourcePlayer) throw new Error('Permanent is not on the battlefield');
    const permanent = sourcePlayer.battlefield[index];
    if (permanent.controller === newController) return permanent;
    sourcePlayer.battlefield.splice(index, 1);
    permanent.controller = newController;
    permanent.controlledSinceTurn = s.turn;
    if (this.static.isType(permanent, 'Creature')) {
      const keywords = this.static.derivedStats(permanent).keywords.map(x => x.toLowerCase());
      permanent.summoningSick = !keywords.includes('haste');
    }
    s.players[newController].battlefield.push(permanent);
    this.emit(EVENT.CONTROL_CHANGED, { controller: newController, previousController: sourcePlayer.id, target: permanent });
    return permanent;
  }

  findPermanent(id) {
    for (const p of Object.values(this.state.players)) {
      const x = p.battlefield.find(c => c.instanceId === id);
      if (x) return x;
    }
    return null;
  }

  selectPermanents(pid, filter = {}) {
    return this.state.players[pid].battlefield.filter(p => {
      if (p.phasedOut) return false;
      if (filter.type && !this.static.isType(p, filter.type)) return false;
      if (filter.subtype && !this.static.hasSubtype(p, filter.subtype)) return false;
      if (Array.isArray(filter.subtypes) && filter.subtypes.length && !filter.subtypes.some(type => this.static.hasSubtype(p, type))) return false;
      if (filter.hasCounter && Number(p.counters?.[filter.hasCounter] || 0) <= 0) return false;
      if (filter.withoutCounter && Number(p.counters?.[filter.withoutCounter] || 0) > 0) return false;
      if (filter.notSelf && p.instanceId === filter.notSelf) return false;
      return true;
    });
  }

  tapPermanent(permanent) {
    if (!permanent || permanent.tapped) return false;
    permanent.tapped = true;
    this.emit(EVENT.BECAME_TAPPED, { controller: permanent.controller, target: permanent, object: permanent });
    return true;
  }

  untapPermanent(permanent) {
    if (!permanent || !permanent.tapped) return false;
    permanent.tapped = false;
    return true;
  }

  changeLife(pid, delta) {
    const p = this.state.players[pid];
    if (delta > 0 && !this.static.canPlayerGainLife(pid)) return 0;
    if (delta === 0) return 0;
    p.life += delta;
    this.emit(delta > 0 ? EVENT.LIFE_GAIN : EVENT.LIFE_LOSS, { controller: pid, amount: Math.abs(delta) });
    this.checkWinner();
    return delta;
  }

  _preventDamage(target, amount) {
    const available = Math.max(0, Number(target?.damagePrevention || 0));
    const prevented = Math.min(Math.max(0, amount), available);
    if (prevented > 0) target.damagePrevention -= prevented;
    return { dealt: Math.max(0, amount - prevented), prevented };
  }

  dealDamageToPlayer(pid, amount, source, { combat = false } = {}) {
    if (amount <= 0) return;
    const player = this.state.players[pid];
    const { dealt, prevented } = this._preventDamage(player, amount);
    const sk = source ? this.static.derivedStats(source).keywords.map(x => x.toLowerCase()) : [];
    if (dealt > 0) this.changeLife(pid, -dealt);
    if (combat && source?.isCommander && dealt > 0) {
      const commanderId = source.instanceId;
      player.commanderDamage[commanderId] = (player.commanderDamage[commanderId] || 0) + dealt;
    }
    if (sk.includes('lifelink') && dealt > 0) this.changeLife(source.controller, dealt);
    if (combat && source && dealt > 0) this.emit(EVENT.COMBAT_DAMAGE_PLAYER, { controller: source.controller, source, object: source, amount: dealt, targetPlayer: pid, combat: true });
    this.checkWinner();
    return { amount: dealt, prevented, combat, source, sourceController: source?.controller, sourceOwner: source?.owner, targetPlayer: pid };
  }

  dealDamageToPermanent(target, amount, source, { combat = false } = {}) {
    if (amount <= 0 || !target) return;
    if (Number(target.counters?.shield || 0) > 0) {
      target.counters.shield -= 1;
      if (target.counters.shield <= 0) delete target.counters.shield;
      return { amount: 0, prevented: amount, combat, source, sourceController: source?.controller, sourceOwner: source?.owner, target, shield: true };
    }
    const { dealt, prevented } = this._preventDamage(target, amount);
    target.damageMarked += dealt;
    const sk = source ? this.static.derivedStats(source).keywords.map(x => x.toLowerCase()) : [];
    if (sk.includes('deathtouch') && dealt > 0) target.deathtouchMarked = true;
    if (sk.includes('lifelink') && dealt > 0) this.changeLife(source.controller, dealt);
    return { amount: dealt, prevented, combat, source, sourceController: source?.controller, sourceOwner: source?.owner, target };
  }

  destroy(p) {
    const st = this.static.derivedStats(p);
    if (st.keywords.map(x => x.toLowerCase()).includes('indestructible')) return false;
    if (Number(p.counters?.shield || 0) > 0) {
      p.counters.shield -= 1;
      if (p.counters.shield <= 0) delete p.counters.shield;
      p.damageMarked = 0;
      return false;
    }
    return this.toGraveyard(p, true);
  }

  sacrifice(p) {
    this.emit(EVENT.SACRIFICED, { controller: p.controller, target: p });
    return this.toGraveyard(p, true);
  }

  exile(p) {
    return this.moveToZone(p, 'exile', p.owner);
  }

  toGraveyard(p, died = false) {
    const wasCreature = this.static.isType(p, 'Creature');
    const oldObject = structuredClone(p);
    const oldController = p.controller;
    const moved = this._moveZoneNow(p, 'graveyard', p.owner);
    if (moved && died && wasCreature) {
      this.emit(EVENT.CREATURE_DIED, { controller: oldController, owner: oldObject.owner, target: moved, object: oldObject, fromZone: 'battlefield', toZone: 'graveyard' });
    }
    return moved;
  }

  moveToZone(card, toZone, toPlayerId = null) {
    const found = ZoneManager.find(this.state, card?.instanceId);
    if (!found) return null;
    if (this.state.pendingChoice) throw new Error('Complete the current choice before changing another zone');
    if (card.isCommander && ['hand', 'library'].includes(toZone)) {
      this.state.pendingChoice = {
        type: 'COMMANDER_ZONE',
        playerId: card.owner,
        commanderId: card.instanceId,
        fromZone: found.zone,
        destination: toZone,
        replacement: true,
        resume: this.state.phase === 'CLEANUP' ? 'CLEANUP' : 'PRIORITY'
      };
      this.state.priorityPlayer = card.owner;
      return card;
    }
    return this._moveZoneNow(card, toZone, toPlayerId);
  }

  _moveZoneNow(card, toZone, toPlayerId = null) {
    const found = ZoneManager.find(this.state, card?.instanceId);
    if (!found) return null;
    const oldZone = found.zone;
    const oldObject = structuredClone(found.card);
    const oldController = found.card.controller;
    const moved = ZoneManager.move(this.state, found.card.instanceId, toZone, toPlayerId);
    if (moved && oldZone === 'battlefield') {
      for (const player of Object.values(this.state.players)) for (const equipment of player.battlefield) if (equipment.attachedTo === oldObject.instanceId) equipment.attachedTo = null;
      this.emit(EVENT.LEAVE_BATTLEFIELD, {
        controller: oldController,
        owner: oldObject.owner,
        target: moved,
        card: moved,
        object: oldObject,
        fromZone: oldZone,
        toZone
      });
    }
    return moved;
  }

  stateBasedActions() {
    return this._withDeferredTriggers(() => this._runStateBasedActionLoop());
  }

  _runStateBasedActionLoop() {
    this.checkWinner();
    this._cleanupEliminatedPlayers();
    if (this.state.pendingChoice) {
      this.checkWinner();
      return false;
    }
    let changed = true;
    while (changed) {
      changed = false;

      for (const player of Object.values(this.state.players)) {
        for (const zone of ['library', 'hand', 'graveyard', 'exile', 'command']) {
          for (const token of [...player[zone]].filter(card => card.isToken)) {
            ZoneManager.remove(this.state, token.instanceId);
            changed = true;
          }
        }
      }

      for (const pl of Object.values(this.state.players)) {
        for (const p of [...pl.battlefield]) {
          if (this.static.isType(p, 'Creature')) {
            const stats = this.static.derivedStats(p);
            const t = stats.toughness;
            const indestructible = stats.keywords.map(x => x.toLowerCase()).includes('indestructible');
            if (t <= 0) {
              // Indestructible does not stop the toughness-based state action.
              this.toGraveyard(p, true);
              changed = true;
            } else if (!indestructible && (p.damageMarked >= t || p.deathtouchMarked)) {
              this.toGraveyard(p, true);
              changed = true;
            }
          }
        }
      }

      if (changed) continue;

      for (const owner of Object.values(this.state.players)) {
        const commander = [...owner.graveyard, ...owner.exile].find(card => card.isCommander && card.commanderZoneChoicePending);
        if (commander) {
          this.state.pendingChoice = {
            type: 'COMMANDER_ZONE',
            playerId: commander.owner,
            commanderId: commander.instanceId,
            fromZone: commander.zone,
            replacement: false,
            resume: this.state.phase === 'CLEANUP' ? 'CLEANUP' : 'PRIORITY'
          };
          this.state.priorityPlayer = commander.owner;
          return true;
        }
      }

      for (const [controller, player] of Object.entries(this.state.players)) {
        const groups = new Map();
        for (const permanent of player.battlefield) {
          const definition = this.db[permanent.cardId];
          if (!isType(definition, 'Legendary')) continue;
          const name = definition?.name || permanent.cardId;
          const group = groups.get(name) || [];
          group.push(permanent);
          groups.set(name, group);
        }
        const duplicate = [...groups.entries()].find(([, permanents]) => permanents.length > 1);
        if (duplicate) {
          const [cardName, permanents] = duplicate;
          this.state.pendingChoice = {
            type: 'LEGEND_RULE',
            playerId: controller,
            cardName,
            permanentIds: permanents.map(permanent => permanent.instanceId),
            resume: this.state.phase === 'CLEANUP' ? 'CLEANUP' : 'PRIORITY'
          };
          this.state.priorityPlayer = controller;
          return true;
        }
      }
    }
    this.checkWinner();
    this._cleanupEliminatedPlayers();
    return changed;
  }

  _cleanupEliminatedPlayers() {
    const state = this.state;
    const eliminated = new Set(this.playerIds().filter(id => state.players[id]?.lost));
    if (!eliminated.size) return;

    // When a player leaves a Commander game, every card/token that player owns
    // leaves with them. Permanents owned by a surviving player but controlled by
    // the eliminated player return to their owner so no object remains attached
    // to a player who is no longer in the game.
    const returnToOwner = [];
    for (const player of Object.values(state.players)) {
      for (const zone of ['library','hand','graveyard','exile','command']) {
        player[zone] = (player[zone] || []).filter(card => !eliminated.has(card.owner));
      }
      const keptBattlefield = [];
      for (const card of player.battlefield || []) {
        if (eliminated.has(card.owner)) continue;
        if (eliminated.has(card.controller)) {
          card.controller = card.owner;
          card.controlledSinceTurn = state.turn;
          card.attacking = false;
          card.attackTarget = null;
          card.blocking = null;
          returnToOwner.push(card);
          continue;
        }
        keptBattlefield.push(card);
      }
      player.battlefield = keptBattlefield;
    }
    for (const card of returnToOwner) {
      const owner = state.players[card.owner];
      if (owner && !owner.lost && !owner.battlefield.some(existing => existing.instanceId === card.instanceId)) owner.battlefield.push(card);
    }

    state.stack = state.stack.filter(item => {
      const controller = item.controller || item.card?.controller;
      const owner = item.card?.owner;
      return !eliminated.has(controller) && !eliminated.has(owner);
    });
    state.pendingTriggers = (state.pendingTriggers || []).filter(trigger => !eliminated.has(trigger.controller));
    if (state.pendingChoice?.playerId && eliminated.has(state.pendingChoice.playerId)) state.pendingChoice = null;

    if (state.combat) {
      state.combat.attackers = (state.combat.attackers || []).filter(id => !!this.findPermanent(id));
      state.combat.attackTargets = Object.fromEntries(Object.entries(state.combat.attackTargets || {}).filter(([aid, defender]) => this.findPermanent(aid) && !eliminated.has(defender)));
      state.combat.blockers = Object.fromEntries(Object.entries(state.combat.blockers || {}).filter(([aid]) => this.findPermanent(aid)).map(([aid, ids]) => [aid, (ids || []).filter(id => !!this.findPermanent(id))]));
      state.combat.defendingPlayers = (state.combat.defendingPlayers || []).filter(id => !eliminated.has(id));
      state.combat.blockerQueue = (state.combat.blockerQueue || []).filter(id => !eliminated.has(id));
      if (state.combat.currentDefender && eliminated.has(state.combat.currentDefender)) state.combat.currentDefender = state.combat.blockerQueue[0] || null;
    }
  }

  checkWinner() {
    const state = this.state;
    for (const [id, p] of Object.entries(state.players)) {
      if (p.lost) continue;
      if (p.life <= 0 || Object.values(p.commanderDamage).some(x => x >= 21)) {
        p.lost = true;
        p.eliminatedAtTurn = state.turn;
        this.log('PLAYER_ELIMINATED', { playerId: id });
      }
    }

    const alive = this.livingPlayerIds();
    if (alive.length === 1 && this.playerIds().length > 1) {
      state.winner = alive[0];
      state.priorityPlayer = null;
      return state.winner;
    }
    if (alive.length === 0) {
      state.winner = 'draw';
      state.priorityPlayer = null;
      return state.winner;
    }

    if (state.priorityPlayer && state.players[state.priorityPlayer]?.lost) state.priorityPlayer = this.nextPriorityPlayer(state.priorityPlayer);
    return null;
  }
}
