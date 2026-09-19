import { isType, hasSubtype, parseManaCost } from '../engine/utils.js';
import { AIEngineFacade } from './AIEngineFacade.js';
import { AIKnowledgeView } from './AIKnowledgeView.js';
import { AILegalActionAdapter } from './AILegalActionAdapter.js';
import { AIActionScorer } from './AIActionScorer.js';
import { AIChoiceEvaluator } from './AIChoiceEvaluator.js';

export class AIController {
  constructor(engine, id = 'ai') {
    this.id = id;
    this.engine = new AIEngineFacade(engine, id);
    this.knowledge = new AIKnowledgeView(this.engine, id);
    this.legalActions = new AILegalActionAdapter(this.engine, id);
    this.state = null;
    this.db = this.engine.getCardDatabaseSnapshot();
    this.policyVersion = 'step29-authoritative-actions-v1';
    this.lastDecision = null;

    this.actionScorer = new AIActionScorer()
      .register('CAST_SPELL', action => this.score(action), action => this.castThreshold(action))
      .register('CAST_COMMANDER', action => this.score(action), action => this.castThreshold(action))
      .register('ACTIVATE_ABILITY', action => this.abilityScore(action), 8)
      .register('FORETELL_CARD', action => this.specialActionScore(action), 8)
      .register('ENCORE_CARD', action => this.specialActionScore(action), 8)
      .register('PLAY_LAND', action => this.landScore(action), -Infinity);
    this.choiceEvaluator = new AIChoiceEvaluator(this);
  }

  _refreshView() {
    const view = this.knowledge.refresh();
    this.state = view.state;
    this.db = view.db;
    this.legalActions.refresh();
    return this.state;
  }

  _decision(action, { kind = 'action', value = null, threshold = null } = {}) {
    const authorized = action ? this.legalActions.authorize(action) : null;
    const chosen = authorized || (!this.state?.pendingChoice && !this.state?.turnActionPending ? this.legalActions.safeFallback() : null);
    this.lastDecision = chosen ? Object.freeze({
      policyVersion: this.policyVersion,
      playerId: this.id,
      turn: this.state.turn,
      phase: this.state.phase,
      kind,
      legalActionCount: this.legalActions.actions.length,
      action: structuredClone(chosen),
      value: Number.isFinite(value) ? value : null,
      threshold: Number.isFinite(threshold) ? threshold : null
    }) : null;
    return chosen;
  }

  choose() {
    const s = this._refreshView();
    const acts = this.legalActions.actions;
    if (!acts.length) return null;

    // A pending engine choice or mandatory turn-based action may own the actor
    // even when ordinary priority semantics differ, so process those first.
    const choice = s.pendingChoice;
    if (choice?.playerId === this.id) {
      return this._decision(this.choiceEvaluator.evaluate(choice, acts), { kind: 'choice' });
    }

    if (s.pregame.active) {
      if (s.pregame.currentPlayer !== this.id) return null;
      const mulligan = acts.find(action => action.type === 'MULLIGAN');
      const action = mulligan && this.shouldMulligan()
        ? mulligan
        : (acts.find(action => action.type === 'KEEP_HAND') || null);
      return this._decision(action, { kind: 'pregame' });
    }

    if (s.turnActionPending === 'DECLARE_ATTACKERS' && s.activePlayer === this.id) {
      const planned = this.chooseAttackPlan();
      const action = this.legalActions.authorize(planned)
        ? planned
        : { type: 'DECLARE_ATTACKERS', attackers: [], attackTargets: {} };
      return this._decision(action, { kind: 'combat' });
    }
    if (s.turnActionPending === 'DECLARE_BLOCKERS' && s.activePlayer !== this.id) {
      return this._decision(this.chooseBlockers(), { kind: 'combat' });
    }

    if (s.priorityPlayer !== this.id) return null;

    const castables = acts.filter(action => ['CAST_SPELL', 'CAST_COMMANDER'].includes(action.type));
    const lands = acts.filter(action => action.type === 'PLAY_LAND');
    const delayLand = lands.length && this.shouldDelayLandPlay(castables);
    if (lands.length && !delayLand) {
      const ranked = lands.map(action => this.actionScorer.evaluate(action)).sort((a, b) => b.value - a.value || this.actionTieBreaker(a.action, b.action));
      return this._decision(ranked[0].action, { kind: 'land', value: ranked[0].value, threshold: ranked[0].threshold });
    }

    // Strategy ranks only engine-issued legal actions. Legality itself remains
    // authoritative in LegalActions/GameEngine and is never inferred by AI.
    const strategic = acts
      .filter(action => ['CAST_SPELL', 'CAST_COMMANDER', 'ACTIVATE_ABILITY', 'FORETELL_CARD', 'ENCORE_CARD'].includes(action.type))
      .map(action => this.actionScorer.evaluate(action))
      .sort((a, b) => b.value - a.value || this.actionTieBreaker(a.action, b.action));
    const best = strategic[0];
    if (best && best.value >= best.threshold) {
      return this._decision(best.action, { kind: 'strategy', value: best.value, threshold: best.threshold });
    }

    // If a landfall/value engine was intentionally sequenced before the land,
    // play the best legal land on the next priority window.
    if (lands.length) {
      const ranked = lands.map(action => this.actionScorer.evaluate(action)).sort((a, b) => b.value - a.value || this.actionTieBreaker(a.action, b.action));
      return this._decision(ranked[0].action, { kind: 'land', value: ranked[0].value, threshold: ranked[0].threshold });
    }

    // Standalone mana activation without a concrete payment is strategically a
    // no-op. Prefer the authoritative pass action when nothing better clears its
    // score threshold.
    return this._decision(acts.find(action => action.type === 'PASS_PRIORITY') || acts.find(action => action.type !== 'ACTIVATE_MANA') || null, { kind: 'pass' });
  }

  cardStrategicValue(definition, { zone = 'hand' } = {}) {
    if (!definition) return 0;
    const effects = this.effectTypes([definition.spellEffects, definition.onEnterEffects, ...(definition.abilities || []).map(a => a.effect)]);
    let value = 4 + Number(definition.manaValue || 0) * 1.1;
    if (isType(definition, 'Land')) return this.handNeedsLand() ? 14 : 3;
    if (isType(definition, 'Creature')) value += 5 + Number(definition.power || 0) + Number(definition.toughness || 0) * 0.45;
    if (this.isRamp(definition, effects)) value += this.state.players[this.id].battlefield.filter(p => this.engine.isObjectType(p, 'Land')).length < 5 ? 12 : 3;
    if (['draw','drawDiscard','drawEventAmount','conditionalDraw','drawPerCreatures','drawPerCreaturesWithCounter'].some(x => effects.has(x))) value += 10;
    if (['destroy','damage','returnToHand','returnTarget','gainControl','counterSpellTarget','ruinousIntrusion'].some(x => effects.has(x))) value += 11;
    if (effects.has('createToken')) value += 5;
    if (effects.has('proliferate') || effects.has('doubleCounters') || effects.has('addCountersAll')) value += 5;
    if (effects.has('extraTurn')) value += 24;
    if (effects.has('sisayTutor') || effects.has('tomBombadilCascade')) value += 14;
    if (effects.has('exploreAll')) value += 8;
    value += this.strategicSynergyValue(definition);
    if (zone === 'library' && Number(definition.manaValue || 0) > 7 && this.availableManaEstimate() < 5 && !effects.has('jhoiraSuspend')) value -= 5;
    return value;
  }

  shouldBottomTopCard(definition) {
    const p = this.state.players[this.id];
    const landsInHand = p.hand.filter(card => isType(this.db[card.cardId], 'Land')).length;
    const landsInPlay = p.battlefield.filter(card => this.engine.isObjectType(card, 'Land')).length;
    if (isType(definition, 'Land')) return landsInHand >= 3 || landsInPlay >= 7;
    if (landsInPlay < 3 && landsInHand === 0 && Number(definition.manaValue || 0) >= 4) return true;
    return this.cardStrategicValue(definition, { zone: 'library' }) < 7;
  }

  handNeedsLand() {
    const p = this.state.players[this.id];
    const landsInHand = p.hand.filter(card => isType(this.db[card.cardId], 'Land')).length;
    const landsInPlay = p.battlefield.filter(card => this.engine.isObjectType(card, 'Land')).length;
    return landsInPlay < 5 && landsInHand < 2;
  }

  availableManaEstimate() {
    const e = this.engine, p = this.state.players[this.id];
    let total = Object.values(p.manaPool || {}).reduce((sum, n) => sum + Number(n || 0), 0);
    for (const permanent of p.battlefield) {
      if (permanent.tapped || permanent.phasedOut) continue;
      const abilities = e.getEffectiveAbilities(permanent) || [];
      if (abilities.some(ability => ability.type === 'mana')) total += 1;
    }
    return total;
  }


  stableActionKey(action = {}) {
    return [
      action.type || '',
      action.cardInstanceId || '',
      action.permanentId || '',
      action.mode || '',
      action.castOption || '',
      action.manaColor || '',
      ...(action.targets || []),
      ...(action.selections || [])
    ].map(value => String(value)).join('|');
  }

  actionTieBreaker(a, b) {
    const priority = { ACTIVATE_ABILITY: 0, CAST_SPELL: 1, CAST_COMMANDER: 2, ENCORE_CARD: 3, FORETELL_CARD: 4 };
    const typeOrder = (priority[a?.type] ?? 9) - (priority[b?.type] ?? 9);
    return typeOrder || this.stableActionKey(a).localeCompare(this.stableActionKey(b));
  }

  findCardAnywhere(instanceId) {
    if (!instanceId) return null;
    const e = this.engine, zones = ['hand','command','graveyard','exile','library','battlefield'];
    for (const [pid, player] of Object.entries(this.state.players)) {
      for (const zone of zones) {
        const card = (player[zone] || []).find(item => item.instanceId === instanceId);
        if (card) return { card, playerId: pid, zone, definition: this.db[card.cardId] || null };
      }
    }
    const stackItem = this.stackItemForTarget(instanceId);
    if (stackItem?.card) return { card: stackItem.card, playerId: stackItem.controller, zone: 'stack', definition: this.db[stackItem.card.cardId] || null };
    return null;
  }

  manaCostAmount(cost = '') {
    const parsed = parseManaCost(cost || '');
    return Object.values(parsed || {}).reduce((sum, n) => sum + Number(n || 0), 0);
  }

  isLandfallEngine(definition) {
    return (definition?.abilities || []).some(ability => ability.type === 'triggered'
      && ability.event === 'ENTER_BATTLEFIELD'
      && String(ability.condition?.type || '').toLowerCase() === 'land'
      && ability.condition?.controllerEvent);
  }

  shouldDelayLandPlay(castables = []) {
    const e = this.engine, s = this.state;
    if (s.activePlayer !== this.id || !['PRECOMBAT_MAIN','POSTCOMBAT_MAIN'].includes(s.phase) || s.stack.length) return false;
    return castables.some(action => {
      if (action.type !== 'CAST_SPELL') return false;
      const d = this.definitionForAction(action);
      return this.isLandfallEngine(d) && this.score(action) >= this.castThreshold(action);
    });
  }

  colorDemand() {
    const e = this.engine, p = this.state.players[this.id];
    const demand = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    const consider = card => {
      const d = this.db[card?.cardId];
      if (!d || isType(d, 'Land')) return;
      const req = parseManaCost(d.manaCost || '');
      for (const color of Object.keys(demand)) demand[color] += Number(req[color] || 0);
    };
    for (const card of p.hand) consider(card);
    for (const card of p.command) consider(card);
    return demand;
  }

  producedColors(definition) {
    const colors = new Set();
    for (const ability of definition?.abilities || []) {
      if (ability.type !== 'mana') continue;
      if (ability.anyColor) for (const color of ['W','U','B','R','G']) colors.add(color);
      for (const [color, amount] of Object.entries(ability.mana || {})) if (Number(amount || 0) > 0 && color in { W:1,U:1,B:1,R:1,G:1 }) colors.add(color);
    }
    return colors;
  }

  chooseCultivateTargets(ids, count = 2) {
    const e = this.engine, p = this.state.players[this.id], demand = this.colorDemand();
    const existing = new Set();
    for (const permanent of p.battlefield) for (const color of this.producedColors(this.db[permanent.cardId])) existing.add(color);
    return [...ids].map(id => {
      const found = this.findCardAnywhere(id), d = found?.definition;
      const colors = this.producedColors(d);
      let value = 0;
      for (const color of colors) value += Number(demand[color] || 0) * 3 + (existing.has(color) ? 0 : 10);
      if (!colors.size) value -= 5;
      return { id, value };
    }).sort((a, b) => b.value - a.value || a.id.localeCompare(b.id)).slice(0, count).map(item => item.id);
  }

  chooseCreatureType(options = []) {
    if (!options.length) return null;
    const e = this.engine, p = this.state.players[this.id];
    const scores = new Map(options.map(option => [option, 0]));
    const add = (card, weight) => {
      const d = this.db[card?.cardId] || {};
      for (const subtype of d.subtypes || []) {
        const option = options.find(item => item.toLowerCase() === String(subtype).toLowerCase());
        if (option) scores.set(option, (scores.get(option) || 0) + weight);
      }
    };
    for (const card of p.battlefield) add(card, 4);
    for (const card of p.hand) add(card, 2);
    for (const card of p.command) add(card, 3);
    return [...options].sort((a, b) => (scores.get(b) || 0) - (scores.get(a) || 0) || a.localeCompare(b))[0];
  }

  effectStrategicValue(effect, context = {}) {
    const effects = this.effectTypes(effect);
    let value = 0;
    const add = (types, amount) => { if (types.some(type => effects.has(type))) value += amount; };
    add(['draw','drawDiscard','drawEventAmount','conditionalDraw','drawPerCreatures','drawPerCreaturesWithCounter'], 15);
    add(['createToken','createSpiritsPerPermanent','stanggTwin'], 12);
    add(['addCounter','addCounterSource','addCounterTarget','addCountersAll','doubleCounters','moveCounterToEvent','stationCharge'], 9);
    add(['proliferate'], 11);
    add(['cultivate','putLandFromHand','putLandFromHandIfExploredLand','additionalLandPlay','myriadLandscape'], 11);
    add(['destroy','damage','returnToHand','returnTarget','gainControl','counterSpellTarget','ertaiCounterOrDestroy','ruinousIntrusion'], 8);
    add(['sisayTutor','tomBombadilCascade'], 20);
    add(['jhoiraSuspend'], 16);
    add(['adjustTimeCounters'], 12);
    add(['extraTurn'], 42);
    if (context?.targets?.length) value += this.targetScore({ targets: [...context.targets] }, effects);
    return value;
  }

  shouldAcceptOptionalTrigger(choice) {
    const trigger = this.state.pendingTriggers.find(item => item.id === choice.triggerId);
    if (!trigger) return true;
    return this.effectStrategicValue(trigger.effect, { targets: trigger.targets || [], eventPayload: trigger.eventPayload }) >= 0;
  }

  shouldAcceptOptionalEffect(choice) {
    return this.effectStrategicValue(choice.then, choice.context || {}) >= 0;
  }

  shouldPayOptionalMana(choice) {
    const benefit = this.effectStrategicValue(choice.then, choice.context || {});
    const cost = this.manaCostAmount(choice.mana || '');
    const remaining = Math.max(0, this.availableManaEstimate() - cost);
    let opportunity = cost * 3;
    if (this.state.activePlayer !== this.id && remaining < 2 && this.hasInteractionInHand()) opportunity += 6;
    return benefit >= Math.max(6, opportunity);
  }

  shouldPayWard(choice) {
    const e = this.engine, item = this.state.stack.find(stackItem => stackItem.id === choice.targetStackItemId);
    if (!item) return false;
    const d = item.card ? this.db[item.card.cardId] : null;
    let investment = d ? this.cardStrategicValue(d) + 5 : 10;
    const effects = d ? this.actionEffects({ cardInstanceId: item.card?.instanceId, mode: item.mode }, d) : this.effectTypes(item.effect);
    if (item.targets?.length) investment += Math.max(0, this.targetScore({ cardInstanceId: item.card?.instanceId, mode: item.mode, targets: item.targets }, effects));
    const manaCost = this.manaCostAmount(choice.cost?.mana || '');
    const lifeCost = Number(choice.cost?.life || 0);
    const life = this.state.players[this.id].life;
    const cost = manaCost * 3.5 + lifeCost * (life <= 10 ? 5 : 1.5);
    return investment > cost + 4;
  }

  hasInteractionInHand() {
    const e = this.engine, p = this.state.players[this.id];
    return p.hand.some(card => {
      const d = this.db[card.cardId];
      if (!d || !isType(d, 'Instant')) return false;
      const effects = this.effectTypes([d.spellEffects, ...(d.modes || []).map(mode => mode.effects)]);
      return ['destroy','damage','returnToHand','returnTarget','counterSpellTarget','ertaiCounterOrDestroy'].some(type => effects.has(type));
    });
  }

  strategicSynergyValue(definition) {
    if (!definition) return 0;
    const e = this.engine, p = this.state.players[this.id];
    const effects = this.effectTypes([definition.spellEffects, definition.onEnterEffects, ...(definition.abilities || []).map(ability => ability.effect)]);
    const board = p.battlefield.filter(card => !card.phasedOut);
    const countered = board.filter(card => Object.values(card.counters || {}).some(amount => Number(amount || 0) > 0));
    const sagas = board.filter(card => isType(this.db[card.cardId], 'Saga'));
    const legends = board.filter(card => String(this.db[card.cardId]?.typeLine || '').includes('Legendary'));
    const artifacts = board.filter(card => e.isObjectType(card, 'Artifact'));
    const merfolk = board.filter(card => e.objectHasSubtype(card, 'Merfolk'));
    const tokenDoubler = board.some(card => (this.db[card.cardId]?.abilities || []).some(ability => ability.type === 'replacement' && ability.event === 'TOKEN_CREATED'));
    const counterDoubler = board.some(card => (this.db[card.cardId]?.abilities || []).some(ability => ability.type === 'replacement' && ability.event === 'COUNTERS_ADDED'));
    let value = 0;
    if (this.isLandfallEngine(definition) && p.landPlaysRemaining > 0) value += 12;
    if (effects.has('proliferate')) value += countered.length * 2.5;
    if (['addCounter','addCounterSource','addCounterTarget','addCountersAll','doubleCounters'].some(type => effects.has(type))) value += counterDoubler ? 7 : 0;
    if (['createToken','createSpiritsPerPermanent','stanggTwin'].some(type => effects.has(type))) value += tokenDoubler ? 8 : 0;
    if (effects.has('exploreAll')) value += 6 + merfolk.length * 3;
    if (effects.has('tomBombadilCascade')) value += 10 + sagas.length * 4;
    if (effects.has('sisayTutor')) value += 12 + legends.length * 1.5;
    if (effects.has('stationCharge')) value += Math.max(0, 8 - artifacts.reduce((max, card) => Math.max(max, Number(card.counters?.charge || 0)), 0));
    if (effects.has('extraTurn')) value += 20;
    if (String(definition.typeLine || '').includes('Legendary') && board.some(card => this.effectTypes((this.db[card.cardId]?.abilities || []).map(a => a.effect)).has('sisayTutor'))) value += 4;
    return value;
  }

  specialActionScore(action) {
    const e = this.engine, p = this.state.players[this.id], card = this.cardForAction(action), d = card ? this.db[card.cardId] : null;
    if (!d) return -Infinity;
    if (action.type === 'FORETELL_CARD') {
      let value = 7 + this.cardStrategicValue(d) * 0.45 + Math.max(0, Number(d.manaValue || 0) - 4) * 1.5;
      if (p.hand.length >= 7) value += 3;
      return value;
    }
    if (action.type === 'ENCORE_CARD') {
      const opponents = Math.max(1, e.opponents(this.id).length);
      return 10 + this.cardStrategicValue(d) * 0.55 + opponents * (isType(d, 'Creature') ? 5 : 2);
    }
    return 0;
  }

  selectionScore(action, effects = this.actionEffects(action)) {
    if (!(action.selections || []).length) return 0;
    const e = this.engine;
    let value = 0;
    for (const id of action.selections) {
      const permanent = e.getPermanentSnapshot(id);
      if (!permanent) continue;
      if (effects.has('stationCharge')) {
        const power = Math.max(0, e.getDerivedStats(permanent).power);
        value += power * 3;
        if (this.state.activePlayer === this.id && this.state.phase === 'PRECOMBAT_MAIN' && e.isObjectType(permanent, 'Creature') && this.attackScore(permanent, this.chooseDefender()) > 0) value -= Math.max(4, power * 1.5);
      } else value += permanent.controller === this.id ? Math.max(0, 8 - this.permanentThreat(permanent) * 0.15) : -20;
    }
    return value;
  }

  removalDisciplineAdjustment(action, effects = this.actionEffects(action)) {
    const removal = ['destroy','returnToHand','returnTarget','gainControl','ruinousIntrusion','ertaiCounterOrDestroy'];
    if (!removal.some(type => effects.has(type)) || this.state.stack.length) return 0;
    const targetPermanents = (action.targets || []).map(id => this.engine.getPermanentSnapshot(id)).filter(Boolean).filter(card => card.controller !== this.id);
    if (!targetPermanents.length) return 0;
    const allEnemy = this.engine.opponents(this.id).flatMap(pid => this.state.players[pid].battlefield).filter(card => !card.phasedOut);
    const maxThreat = Math.max(0, ...allEnemy.map(card => this.permanentThreat(card)));
    const targetThreat = Math.max(...targetPermanents.map(card => this.permanentThreat(card)));
    const myLife = this.state.players[this.id].life;
    if (maxThreat >= 12 && targetThreat < maxThreat * 0.55 && myLife > 12) return -18;
    if (targetThreat >= maxThreat * 0.9 && maxThreat >= 10) return 8;
    return 0;
  }

  cardChoiceValue(id) {
    const found = this.findCardAnywhere(id);
    return this.cardStrategicValue(found?.definition || null, { zone: found?.zone || 'hand' });
  }

  rankCardChoiceIds(ids) {
    const p = this.state.players[this.id];
    const zones = ['library','hand','graveyard','exile'];
    return [...ids].map(id => {
      const card = zones.flatMap(z => p[z] || []).find(item => item.instanceId === id);
      return { id, value: this.cardStrategicValue(card ? this.db[card.cardId] : null, { zone: card?.zone || 'library' }) };
    }).sort((a, b) => b.value - a.value || a.id.localeCompare(b.id)).map(item => item.id);
  }

  rankTargetIds(ids, effect = null, source = null) {
    const effects = this.effectTypes([effect, source?.effect]);
    const harmful = ['damage','destroy','returnToHand','returnTarget','returnAttackers','returnCreaturesWithoutCounter','ruinousIntrusion','gainControl','counterSpellTarget'];
    const helpful = ['gainLife','gainLifeTarget','addCounter','addCounterSource','addCounterTarget','addCountersAll','pump','pumpEventObject','untap','doubleCounters','attachEquipment','preventDamage'];
    const hostile = harmful.some(type => effects.has(type));
    const friendly = helpful.some(type => effects.has(type));
    return [...ids].map(id => {
      let value = 0;
      const player = this.state.players[id];
      if (player) {
        const mine = id === this.id;
        if (hostile) value += mine ? -100 : this.playerThreat(id) + (40 - player.life) * 2;
        if (friendly) value += mine ? 80 : -50;
      } else {
        const permanent = this.engine.getPermanentSnapshot(id);
        if (permanent) {
          const mine = permanent.controller === this.id;
          const threat = this.permanentThreat(permanent);
          if (hostile) value += mine ? -100 - threat : threat * 2.2 + this.playerThreat(permanent.controller) * 0.25;
          if (friendly) value += mine ? 30 + threat : -60 - threat;
        }
      }
      return { id, value };
    }).sort((a, b) => b.value - a.value || a.id.localeCompare(b.id)).map(item => item.id);
  }

  playerThreat(pid) {
    const e = this.engine, p = this.state.players[pid];
    if (!p || p.lost) return -Infinity;
    const board = p.battlefield.filter(card => !card.phasedOut);
    const permanents = board.reduce((sum, card) => sum + this.permanentThreat(card), 0);
    const mana = board.filter(card => e.isObjectType(card, 'Land')).length + Object.values(p.manaPool || {}).reduce((sum, n) => sum + Number(n || 0), 0);
    const hand = Math.min(10, p.hand.length) * 2.25;
    const life = Math.max(0, p.life) * 0.18;
    const commander = [...p.command, ...p.battlefield, ...p.graveyard, ...p.exile].find(card => card.isCommander);
    let commanderPressure = 0;
    if (commander) {
      const maxDealt = Math.max(0, ...e.opponents(pid).map(opponentId => Number(this.state.players[opponentId].commanderDamage?.[commander.instanceId] || 0)));
      commanderPressure = maxDealt * 1.2 + (maxDealt >= 15 ? (maxDealt - 14) * 5 : 0);
    }
    return permanents + mana * 2 + hand + life + commanderPressure;
  }

  chooseAttackPlan() {
    const e = this.engine;
    const opponents = e.opponents(this.id);
    const attackers = e.getLegalAttackers(this.id);
    if (!opponents.length || !attackers.length) return { type: 'DECLARE_ATTACKERS', attackers: [], attackTargets: {} };

    const chosen = [];
    const targets = {};
    const projectedDamage = Object.fromEntries(opponents.map(pid => [pid, 0]));

    // First spend attackers on attacks that are individually profitable. Each attacker
    // chooses its own defender, which lets multiplayer AI finish a weak player while
    // sending evasive/commander pressure at a different threat.
    const ordered = [...attackers].sort((a, b) => this.permanentThreat(b) - this.permanentThreat(a));
    for (const attacker of ordered) {
      let bestTarget = null;
      let bestScore = -Infinity;
      for (const pid of opponents) {
        const score = this.attackTargetScore(attacker, pid, projectedDamage[pid] || 0);
        if (score > bestScore) { bestScore = score; bestTarget = pid; }
      }
      if (bestTarget && bestScore > 0) {
        chosen.push(attacker.instanceId);
        targets[attacker.instanceId] = bestTarget;
        const blockers = this.state.players[bestTarget].battlefield.filter(blocker => !blocker.tapped && !blocker.phasedOut && e.isObjectType(blocker, 'Creature') && e.canBlock(blocker, attacker));
        if (!blockers.length) projectedDamage[bestTarget] += Math.max(0, e.getDerivedStats(attacker).power);
      }
    }
    return { type: 'DECLARE_ATTACKERS', attackers: chosen, attackTargets: targets };
  }

  attackTargetScore(attacker, defenderId, alreadyProjected = 0) {
    const e = this.engine, defender = this.state.players[defenderId];
    if (!defender || defender.lost) return -Infinity;
    const st = e.getDerivedStats(attacker);
    let value = this.attackScore(attacker, defenderId);
    if (!Number.isFinite(value)) return value;
    const legalBlockers = defender.battlefield.filter(blocker => !blocker.tapped && !blocker.phasedOut && e.isObjectType(blocker, 'Creature') && e.canBlock(blocker, attacker));
    const damage = Math.max(0, st.power);
    if (!legalBlockers.length) {
      if (alreadyProjected >= defender.life) value -= 220;
      else if (defender.life - alreadyProjected <= damage) value += 250;
    }
    if (attacker.isCommander) {
      const current = Number(defender.commanderDamage?.[attacker.instanceId] || 0);
      if (21 - current <= damage) value += legalBlockers.length ? 95 : 300;
      else value += current * 1.7;
      if (current >= 14) value += 18;
    }
    const leader = Math.max(...e.opponents(this.id).map(pid => this.playerThreat(pid)));
    const threat = this.playerThreat(defenderId);
    if (threat >= leader - 0.001) value += 14;
    value += Math.max(0, 15 - defender.life) * 1.2;
    return value;
  }

  stackItemForTarget(targetId) {
    return [...this.state.stack].reverse().find(item => item?.card?.instanceId === targetId || item?.id === targetId) || null;
  }

  stackThreat(item) {
    if (!item) return 0;
    const e = this.engine;
    const def = item.card ? this.db[item.card.cardId] : null;
    const effects = this.effectTypes([item.effect, def?.spellEffects, item.mode && (def?.modes || []).find(mode => mode.id === item.mode)?.effects]);
    let value = def ? this.cardStrategicValue(def) : 8;
    if (item.controller === this.id) return -100;
    const targetsUs = (item.targets || []).some(id => id === this.id || e.getPermanentSnapshot(id)?.controller === this.id);
    if (targetsUs) value += 25;
    if (['destroy','damage','returnToHand','returnTarget','gainControl','ruinousIntrusion','returnAttackers','returnCreaturesWithoutCounter'].some(x => effects.has(x))) value += targetsUs ? 28 : 10;
    if (['draw','createToken','cultivate','doubleCounters','addCountersAll','proliferate'].some(x => effects.has(x))) value += 10 + this.playerThreat(item.controller) * 0.12;
    if (effects.has('winIfSourceCounterAtLeast')) value += 100;
    return value;
  }


  chooseDefender() {
    const opponents = this.engine.opponents(this.id);
    if (!opponents.length) return null;
    return [...opponents].sort((a, b) => this.defenderScore(b) - this.defenderScore(a) || a.localeCompare(b))[0];
  }

  defenderScore(pid) {
    const e = this.engine, player = this.state.players[pid];
    if (!player || player.lost) return -Infinity;
    const creatures = player.battlefield.filter(card => e.isObjectType(card, 'Creature') && !card.phasedOut);
    const untappedBlockers = creatures.filter(card => !card.tapped);
    const leaderThreat = this.playerThreat(pid);
    const lowestLife = Math.min(...e.opponents(this.id).map(id => this.state.players[id].life));
    const finishBonus = player.life === lowestLife ? Math.max(0, 22 - player.life) * 3 : 0;
    // Attack dangerous opponents when nobody is immediately killable, but convert
    // low-life players into eliminations instead of spreading damage aimlessly.
    return leaderThreat * 0.32 + finishBonus + (40 - player.life) * 1.1 - untappedBlockers.length * 3.5;
  }

  chooseBlockers() {
    const e = this.engine, s = this.state;
    const map = {};
    const available = s.players[this.id].battlefield.filter(x => e.isObjectType(x, 'Creature') && !x.tapped && !x.phasedOut);
    const incoming = s.combat.attackers
      .filter(attackerId => (s.combat.attackTargets?.[attackerId] || e.opponent(s.activePlayer)) === this.id)
      .map(attackerId => e.getPermanentSnapshot(attackerId))
      .filter(Boolean)
      .sort((a, b) => this.permanentThreat(b) - this.permanentThreat(a));

    const incomingDamage = incoming.reduce((sum, attacker) => sum + Math.max(0, e.getDerivedStats(attacker).power), 0);
    let lifeAfterUnblocked = s.players[this.id].life - incomingDamage;

    for (const attacker of incoming) {
      const ast = e.getDerivedStats(attacker);
      const candidates = available.filter(blocker => e.canBlock(blocker, attacker));
      const menace = ast.keywords.some(keyword => keyword.toLowerCase() === 'menace');
      const needed = menace ? 2 : 1;
      if (candidates.length < needed) continue;

      const attackerValue = this.permanentThreat(attacker);
      const commanderDamage = attacker.isCommander ? Number(s.players[this.id].commanderDamage?.[attacker.instanceId] || 0) : 0;
      const commanderLethal = attacker.isCommander && commanderDamage + Math.max(0, ast.power) >= 21;
      const commanderCritical = attacker.isCommander && commanderDamage >= 16;
      let picked = [];
      if (needed === 1) {
        const profitable = candidates
          .map(blocker => ({ blocker, quality: this.blockQuality(blocker, attacker) }))
          .filter(item => item.quality > 0)
          .sort((a, b) => b.quality - a.quality || this.permanentThreat(a.blocker) - this.permanentThreat(b.blocker));
        if (profitable.length) picked = [profitable[0].blocker];
        else if (lifeAfterUnblocked <= 8 || ast.power >= s.players[this.id].life || commanderLethal || commanderCritical) {
          picked = [candidates.sort((a, b) => this.permanentThreat(a) - this.permanentThreat(b))[0]];
        }
      } else {
        const pair = candidates
          .sort((a, b) => this.permanentThreat(a) - this.permanentThreat(b))
          .slice(0, 2);
        const totalPower = pair.reduce((sum, blocker) => sum + e.getDerivedStats(blocker).power, 0);
        if (pair.length === 2 && (totalPower >= ast.toughness || lifeAfterUnblocked <= 8 || commanderLethal || commanderCritical || attackerValue >= pair.reduce((sum, blocker) => sum + this.permanentThreat(blocker), 0))) picked = pair;
      }

      if (!picked.length) continue;
      map[attacker.instanceId] = picked.map(card => card.instanceId);
      lifeAfterUnblocked += ast.power;
      for (const blocker of picked) available.splice(available.indexOf(blocker), 1);
    }

    const action = { type: 'DECLARE_BLOCKERS', blockers: map };
    if (e.isActionLegal(this.id, action)) return action;
    const decline = { type: 'DECLARE_BLOCKERS', blockers: {} };
    if (e.isActionLegal(this.id, decline)) return decline;
    throw new Error('AI could not construct a legal blocker declaration from engine legality');
  }

  orderCombatBlockers(attackerId, blockerIds = []) {
    const e = this.engine, attacker = e.getPermanentSnapshot(attackerId);
    if (!attacker) return [...blockerIds];
    const ast = e.getDerivedStats(attacker);
    const deathtouch = ast.keywords.some(keyword => String(keyword).toLowerCase() === 'deathtouch');
    const trample = ast.keywords.some(keyword => String(keyword).toLowerCase() === 'trample');
    return [...blockerIds].map(id => {
      const blocker = e.getPermanentSnapshot(id);
      if (!blocker) return { id, score: -Infinity, lethal: Infinity };
      const bst = e.getDerivedStats(blocker);
      const lethal = deathtouch ? 1 : Math.max(1, bst.toughness - Number(blocker.damageMarked || 0));
      let score = this.permanentThreat(blocker) / lethal;
      if (trample) score += Math.max(0, 5 - lethal) * 0.7;
      if (bst.keywords.some(keyword => String(keyword).toLowerCase() === 'deathtouch')) score += 3;
      return { id, score, lethal };
    }).sort((a, b) => b.score - a.score || a.lethal - b.lethal || a.id.localeCompare(b.id)).map(item => item.id);
  }

  blockQuality(blocker, attacker) {
    const e = this.engine;
    const bs = e.getDerivedStats(blocker), as = e.getDerivedStats(attacker);
    const blockerKeywords = bs.keywords.map(x => x.toLowerCase());
    const attackerKeywords = as.keywords.map(x => x.toLowerCase());
    const killsAttacker = blockerKeywords.includes('deathtouch') && bs.power > 0 || bs.power >= as.toughness;
    const survives = attackerKeywords.includes('deathtouch') ? as.power <= 0 : as.power < bs.toughness || blockerKeywords.includes('indestructible');
    if (killsAttacker && survives) return 30 + this.permanentThreat(attacker) - this.permanentThreat(blocker) * 0.25;
    if (killsAttacker) return 12 + this.permanentThreat(attacker) - this.permanentThreat(blocker);
    if (survives) return 4;
    return -10;
  }

  allCardsForPlayer() {
    const p = this.state.players[this.id];
    return ['hand', 'command', 'graveyard', 'exile', 'library'].flatMap(zone => p?.[zone] || []);
  }

  cardForAction(action) {
    if (!action?.cardInstanceId) return null;
    return this.allCardsForPlayer().find(card => card.instanceId === action.cardInstanceId) || null;
  }

  definitionForAction(action) {
    const card = this.cardForAction(action);
    return card ? this.db[card.cardId] || null : null;
  }

  effectTypes(value, out = new Set()) {
    if (!value) return out;
    if (Array.isArray(value)) {
      for (const item of value) this.effectTypes(item, out);
      return out;
    }
    if (typeof value !== 'object') return out;
    if (typeof value.type === 'string') out.add(value.type);
    for (const nested of Object.values(value)) this.effectTypes(nested, out);
    return out;
  }

  actionEffects(action, definition = this.definitionForAction(action)) {
    const values = [];
    if (definition) {
      values.push(definition.spellEffects, definition.onEnterEffects);
      for (const ability of definition.abilities || []) values.push(ability.effect);
      if (action?.mode) values.push((definition.modes || []).find(mode => mode.id === action.mode)?.effects);
    }
    if (action?.ability) values.push(action.ability.effect);
    return this.effectTypes(values);
  }

  permanentThreat(permanent) {
    const e = this.engine, d = this.db[permanent?.cardId] || {};
    if (!permanent) return 0;
    const effects = this.effectTypes([d.spellEffects, d.onEnterEffects, ...(d.abilities || []).map(ability => ability.effect)]);
    let score = Number(d.manaValue || 0) * 1.15;
    for (const ability of d.abilities || []) {
      if (ability.type === 'triggered') score += 3.5;
      else if (ability.type === 'activated') score += 4.5;
      else if (ability.type === 'replacement') score += 6;
      else if (ability.type === 'static') score += 2.5;
      else if (ability.type === 'mana') score += 1.2;
    }
    const counters = Object.values(permanent.counters || {}).reduce((sum, amount) => sum + Number(amount || 0), 0);
    score += counters * 1.4;
    if (e.isObjectType(permanent, 'Creature')) {
      const st = e.getDerivedStats(permanent);
      score += Math.max(0, st.power) * 1.45 + Math.max(0, st.toughness) * 0.55 + (st.keywords?.length || 0) * 1.6;
      if (st.keywords?.some(keyword => ['hexproof','indestructible','double strike','deathtouch'].includes(String(keyword).toLowerCase()))) score += 3;
    }
    if (['draw','conditionalDraw','drawPerCreatures','drawPerCreaturesWithCounter'].some(type => effects.has(type))) score += 7;
    if (['sisayTutor','tomBombadilCascade','extraTurn','gainControl'].some(type => effects.has(type))) score += 10;
    if (['doubleCounters','createSpiritsPerPermanent','stanggTwin','exploreAll'].some(type => effects.has(type))) score += 7;
    if (effects.has('winIfSourceCounterAtLeast')) {
      const growth = Math.max(0, ...Object.values(permanent.counters || {}).map(Number));
      score += 25 + growth * 2.5;
    }
    if (d.creatureAtCounter) {
      const current = Number(permanent.counters?.[d.creatureAtCounter.counter] || 0);
      const needed = Number(d.creatureAtCounter.amount || 0);
      if (needed > 0) score += Math.min(12, (current / needed) * 12);
    }
    if (permanent.isCommander) score += 6;
    return score;
  }

  targetScore(action, effects = this.actionEffects(action)) {
    const e = this.engine, s = this.state, d = this.definitionForAction(action);
    const mode = action?.mode ? (d?.modes || []).find(item => item.id === action.mode) : null;
    const rawEffects = mode?.effects || d?.spellEffects || action?.ability?.effect || [];
    const indexed = [];
    const walk = value => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (!value || typeof value !== 'object') return;
      if (typeof value.type === 'string') indexed.push(value);
      for (const nested of Object.values(value)) if (nested && typeof nested === 'object') walk(nested);
    };
    walk(rawEffects);

    const harmfulTypes = new Set(['damage','destroy','returnToHand','returnTarget','returnAttackers','returnCreaturesWithoutCounter','ruinousIntrusion','gainControl','counterSpellTarget','ertaiCounterOrDestroy','bulliesDonate']);
    const helpfulTypes = new Set(['gainLife','gainLifeTarget','addCounter','addCounterSource','addCounterTarget','addCountersAll','pump','pumpEventObject','untap','doubleCounters','attachEquipment','preventDamage','stationCharge']);
    let score = 0;

    for (let index = 0; index < (action.targets || []).length; index++) {
      const id = action.targets[index];
      const specific = indexed.filter(effect => effect.index == null || Number(effect.index) === index);
      const harmful = specific.some(effect => harmfulTypes.has(effect.type)) || (!specific.length && [...effects].some(type => harmfulTypes.has(type)));
      const helpful = specific.some(effect => helpfulTypes.has(effect.type)) || (!specific.length && [...effects].some(type => helpfulTypes.has(type)));
      const countering = specific.some(effect => effect.type === 'counterSpellTarget');

      if (countering) {
        score += this.stackThreat(this.stackItemForTarget(id)) * 2.2;
        continue;
      }

      const targetPlayer = s.players[id];
      if (targetPlayer) {
        const mine = id === this.id;
        if (harmful) {
          score += mine ? -120 : 12 + (40 - targetPlayer.life) * 0.8 + this.playerThreat(id) * 0.12;
          if (!mine && ['damage'].some(type => effects.has(type)) && targetPlayer.life <= 5) score += 80;
        }
        if (helpful) score += mine ? 28 : -70;
        if (!harmful && !helpful) score += mine ? 2 : this.playerThreat(id) * 0.05;
        continue;
      }

      const permanent = e.getPermanentSnapshot(id);
      if (permanent) {
        const mine = permanent.controller === this.id;
        const threat = this.permanentThreat(permanent);
        if (harmful) score += mine ? -100 - threat * 2 : 12 + threat * 2.2 + this.playerThreat(permanent.controller) * 0.12;
        if (helpful) score += mine ? 12 + threat * 1.15 : -80 - threat;
        if (!harmful && !helpful) score += mine ? 3 : threat * 0.3;
        continue;
      }

      const located = this.findCardAnywhere(id);
      if (located && located.zone !== 'battlefield' && located.zone !== 'stack') {
        const mine = located.playerId === this.id || located.card.owner === this.id;
        const cardValue = this.cardStrategicValue(located.definition, { zone: located.zone });
        if (effects.has('jhoiraSuspend')) score += mine ? cardValue * 1.4 + Number(located.definition?.manaValue || 0) * 2 : -100;
        else if (effects.has('adjustTimeCounters')) {
          const time = Number(located.card.counters?.time || 0);
          score += mine ? cardValue * 0.8 + Math.max(0, 5 - time) * 3 : -60;
        } else {
          if (harmful) score += mine ? -80 - cardValue : cardValue;
          if (helpful) score += mine ? cardValue : -50;
        }
        continue;
      }

      const stackItem = this.stackItemForTarget(id);
      if (stackItem) score += this.stackThreat(stackItem) * (harmful ? 1.8 : 0.4);
    }
    return score;
  }

  isRamp(definition, effects = this.effectTypes([definition?.spellEffects, definition?.onEnterEffects, ...(definition?.abilities || []).map(a => a.effect)])) {
    if (!definition) return false;
    if ((definition.abilities || []).some(ability => ability.type === 'mana')) return true;
    return ['cultivate', 'putLandFromHand', 'putLandFromHandIfExploredLand', 'additionalLandPlay', 'myriadLandscape'].some(type => effects.has(type));
  }

  landScore(action) {
    const e = this.engine, p = this.state.players[this.id], d = this.definitionForAction(action);
    if (!d) return 0;
    let score = 10;
    if (d.entersTapped) score -= 5;
    if (d.entersTappedUnless) score -= 1;
    const needed = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    for (const card of p.hand) {
      const def = this.db[card.cardId];
      if (!def || isType(def, 'Land')) continue;
      const req = parseManaCost(def.manaCost || '');
      for (const color of Object.keys(needed)) needed[color] += req[color] || 0;
    }
    for (const ability of d.abilities || []) {
      if (ability.type !== 'mana') continue;
      if (ability.anyColor) score += 8;
      for (const [color, amount] of Object.entries(ability.mana || {})) score += (needed[color] || 0) * Number(amount || 0) * 2;
    }
    if ((d.abilities || []).some(ability => ability.type === 'activated')) score += 1.5;
    return score;
  }

  score(action) {
    const e = this.engine, s = this.state, p = s.players[this.id];
    const card = this.cardForAction(action), d = card ? this.db[card.cardId] : null;
    if (!d) return -Infinity;
    const effects = this.actionEffects(action, d);
    const mv = Number(d.manaValue || 0);
    const creatures = p.battlefield.filter(permanent => e.isObjectType(permanent, 'Creature') && !permanent.phasedOut);
    const lands = p.battlefield.filter(permanent => e.isObjectType(permanent, 'Land')).length;
    let value = 10 + mv * 1.2 + this.targetScore(action, effects) + this.strategicSynergyValue(d);

    if (isType(d, 'Creature')) {
      value += 8 + Number(d.power || 0) * 1.2 + Number(d.toughness || 0) * 0.45 + (d.keywords?.length || 0) * 1.5;
      if (creatures.length < 2) value += 4;
    } else if (isType(d, 'Artifact') || isType(d, 'Enchantment')) value += 3;

    if (this.isRamp(d, effects)) value += lands < 5 ? 18 : 5;
    if (effects.has('draw') || effects.has('drawDiscard') || effects.has('drawEventAmount') || effects.has('conditionalDraw') || effects.has('drawPerCreatures') || effects.has('drawPerCreaturesWithCounter')) {
      value += 8 + Math.max(0, 5 - p.hand.length) * 3;
    }
    if (effects.has('cultivate')) value += lands < 5 ? 14 : 2;
    if (effects.has('destroy') || effects.has('damage') || effects.has('returnToHand') || effects.has('returnTarget') || effects.has('gainControl')) value += 8;
    if (effects.has('counterSpellTarget')) value += s.stack.length ? 14 + this.stackThreat(s.stack[s.stack.length - 1]) * 0.35 : -18;
    if (effects.has('createToken')) value += 5;
    if (effects.has('createSpiritsPerPermanent') || effects.has('stanggTwin')) value += 12;
    if (effects.has('extraTurn')) value += 28;
    if (effects.has('tomBombadilCascade')) value += 18;
    if (effects.has('ertaiCounterOrDestroy')) value += s.stack.length ? 18 : 10;
    if (effects.has('proliferate')) {
      const countered = p.battlefield.filter(permanent => Object.values(permanent.counters || {}).some(Number)).length;
      value += countered * 2.5 - (countered ? 0 : 5);
    }
    if (effects.has('addCounter') || effects.has('addCountersAll') || effects.has('doubleCounters')) value += p.battlefield.some(permanent => Object.keys(permanent.counters || {}).length) ? 5 : 2;
    value += this.removalDisciplineAdjustment(action, effects);

    if (action.type === 'CAST_COMMANDER') {
      value += 4 - Number(p.commanderTax || 0) * 3;
      // A commander is an important engine piece, but it should not crowd every
      // normal spell out of the AI's hand. Repeatedly recasting into removal is
      // intentionally less attractive than developing with ordinary cards.
      if (p.commanderTax >= 4) value -= 8;
      if (creatures.length >= 4) value -= 3;
    } else {
      value += 3; // slight natural preference to use cards from hand
    }

    const ownTop = s.stack[s.stack.length - 1];
    if (s.stack.length && ownTop?.controller === this.id) value -= 25;

    // Humans normally hold flexible interaction until it matters. On somebody
    // else's quiet upkeep/main phase, only fire an instant if it has a concrete
    // high-value target, or use draw/value spells at the last end step before us.
    if (s.activePlayer !== this.id) {
      const nextIsUs = e.nextPlayer(s.activePlayer) === this.id;
      const interaction = this.targetScore(action, effects);
      const topThreat = s.stack.length ? this.stackThreat(s.stack[s.stack.length - 1]) : 0;
      if (s.stack.length && interaction > 0) value += Math.min(50, topThreat);
      if (s.phase === 'END_STEP' && nextIsUs) value += effects.has('draw') ? 14 : 3;
      else if (interaction < 15 && !s.stack.length && !['DECLARE_ATTACKERS', 'DECLARE_BLOCKERS', 'COMBAT_DAMAGE'].includes(s.phase)) value -= 28;
    } else if (['PRECOMBAT_MAIN', 'POSTCOMBAT_MAIN'].includes(s.phase) && s.stack.length === 0) {
      value += 5;
      // Preserve some instant-speed interaction when a dangerous opponent is about
      // to untap, unless the proactive play is itself high impact.
      const interactionInHand = p.hand.some(c => {
        const def = this.db[c.cardId];
        const fx = this.effectTypes([def?.spellEffects, ...(def?.modes || []).map(m => m.effects)]);
        return isType(def, 'Instant') && ['destroy','damage','returnToHand','returnTarget','counterSpellTarget'].some(type => fx.has(type));
      });
      const nextOpponent = e.nextPlayer(this.id);
      if (interactionInHand && nextOpponent && this.playerThreat(nextOpponent) > this.playerThreat(this.id) * 0.85 && mv >= Math.max(2, this.availableManaEstimate() - 1)) value -= 7;
    }

    return value;
  }

  castThreshold(action) {
    const s = this.state;
    if (s.activePlayer === this.id) return 8;
    if (s.stack.length) return 15;
    if (s.phase === 'END_STEP' && this.engine.nextPlayer(s.activePlayer) === this.id) return 10;
    return 20;
  }

  abilityScore(action) {
    const e = this.engine, s = this.state;
    const source = e.getPermanentSnapshot(action.permanentId);
    if (!source) return -Infinity;
    const effects = this.actionEffects(action, this.db[source.cardId]);
    // Reattaching Equipment/Fortification/Reconfigure to its current host is a
    // legal Magic action, but it is strategically a no-op. Treat it as such so
    // the AI cannot enter a zero-cost attach/pass loop while preserving the
    // action for human players and rules-completeness.
    if (action.ability?.attachmentAction && action.targets?.[0]) {
      const current = e.getAttachmentSnapshot?.().find(item => item.attachedId === source.instanceId);
      if (current?.hostId === action.targets[0]) return -Infinity;
      // Once attached, only move an attachment when the prospective host is a
      // strictly better strategic carrier. Otherwise two equally legal hosts
      // can make a zero-cost Equipment ping-pong forever without advancing the
      // game state in any meaningful way.
      if (current?.hostId) {
        const oldHost = e.getPermanentSnapshot(current.hostId);
        const newHost = e.getPermanentSnapshot(action.targets[0]);
        if (oldHost && newHost && this.permanentThreat(newHost) <= this.permanentThreat(oldHost)) return -Infinity;
      }
    }
    let value = 5 + this.targetScore(action, effects) + this.selectionScore(action, effects);
    if (effects.has('draw') || effects.has('conditionalDraw')) value += 12 + Math.max(0, 4 - s.players[this.id].hand.length) * 2;
    if (effects.has('sisayTutor')) value += 20;
    if (effects.has('searchLand')) {
      const effect = action.ability?.effect || {};
      const candidates = s.players[this.id].library.filter(card => {
        const definition = this.db[card.cardId];
        if (!definition || !isType(definition, 'Land')) return false;
        if (effect.basicOnly && !isType(definition, 'Basic Land')) return false;
        if (effect.landTypes?.length && !effect.landTypes.some(type => hasSubtype(definition, type))) return false;
        return true;
      });
      if (!candidates.length) return -Infinity;
      const lifeCost = Number(action.ability?.cost?.life || 0);
      if (lifeCost && s.players[this.id].life <= lifeCost) return -Infinity;
      const landsInPlay = s.players[this.id].battlefield.filter(permanent => e.isObjectType(permanent, 'Land')).length;
      value += 16 + (landsInPlay < 5 ? 7 : 2);
    }
    if (effects.has('adapt') || effects.has('addCounter') || effects.has('addCounterSource')) value += 9;
    if (effects.has('proliferate')) value += s.players[this.id].battlefield.filter(permanent => Object.keys(permanent.counters || {}).length).length * 2;
    if (effects.has('damage') || effects.has('destroy') || effects.has('returnToHand') || effects.has('returnTarget') || effects.has('gainControl')) value += 10;
    if (effects.has('counterSpellTarget')) value += s.stack.length ? 20 : -20;
    if (effects.has('stationCharge')) {
      const current = Number(source.counters?.charge || 0);
      if (current >= 8) return -Infinity;
      value += 10 + Math.max(0, 8 - current) * 1.5;
    }
    if (effects.has('createSpiritsPerPermanent')) value += s.players[this.id].battlefield.length * 3 - 10;
    if (effects.has('bulliesDonate')) value += 18;
    if (effects.has('jhoiraSuspend')) value += 20;
    if (effects.has('adjustTimeCounters')) value += 11;
    if (action.ability?.cost?.life) value -= Number(action.ability.cost.life) * (s.players[this.id].life < 10 ? 3 : 0.5);
    if (action.ability?.tap && s.activePlayer === this.id && s.phase === 'PRECOMBAT_MAIN' && e.isObjectType(source, 'Creature') && this.attackScore(source, this.chooseDefender()) > 0) value -= 9;
    return value;
  }

  attackScore(permanent, defenderId = this.chooseDefender()) {
    const e = this.engine, st = e.getDerivedStats(permanent);
    if (!defenderId || st.power <= 0) return -Infinity;
    const defender = this.state.players[defenderId];
    const keywords = st.keywords.map(keyword => keyword.toLowerCase());
    const legalBlockers = defender.battlefield.filter(blocker => !blocker.tapped && !blocker.phasedOut && e.isObjectType(blocker, 'Creature') && e.canBlock(blocker, permanent));
    if (!legalBlockers.length) return 20 + st.power * 3 + (defender.life <= st.power ? 100 : 0);

    let value = st.power * 1.5;
    if (keywords.includes('vigilance')) value += 3;
    if (keywords.includes('trample')) value += 5;
    if (keywords.includes('deathtouch')) value += 5;
    if (permanent.isCommander) value += 2;

    const attackerThreat = this.permanentThreat(permanent);
    const bestTrade = legalBlockers.map(blocker => {
      const bs = e.getDerivedStats(blocker);
      const kills = keywords.includes('deathtouch') && st.power > 0 || st.power >= bs.toughness;
      const dies = bs.keywords.map(x => x.toLowerCase()).includes('deathtouch') && bs.power > 0 || bs.power >= st.toughness;
      return (kills ? this.permanentThreat(blocker) : 0) - (dies ? attackerThreat : 0);
    }).sort((a, b) => b - a)[0];
    value += bestTrade || 0;
    if (bestTrade < -4 && !keywords.includes('trample')) value -= 12;
    return value;
  }

  shouldMulligan() {
    const p = this.state.players[this.id];
    if (!p || p.mulligans >= 2) return false;
    const defs = p.hand.map(card => this.db[card.cardId]).filter(Boolean);
    const landDefs = defs.filter(def => isType(def, 'Land'));
    const spells = defs.filter(def => !isType(def, 'Land'));
    const lands = landDefs.length;
    const ramp = spells.filter(def => this.isRamp(def)).length;
    if (lands < 2 || lands > 5) return true;

    const colors = new Set();
    for (const def of landDefs) for (const color of this.producedColors(def)) colors.add(color);
    const castableEarly = spells.filter(def => Number(def.manaValue || 0) <= 3).filter(def => {
      const req = parseManaCost(def.manaCost || '');
      return ['W','U','B','R','G'].every(color => !Number(req[color] || 0) || colors.has(color));
    }).length;
    const averageMv = spells.length ? spells.reduce((sum, def) => sum + Number(def.manaValue || 0), 0) / spells.length : 0;
    if (lands === 2 && castableEarly + ramp === 0) return true;
    if (lands <= 3 && averageMv >= 5.5 && castableEarly === 0 && ramp === 0) return true;
    return false;
  }

  chooseMulliganBottom(count) {
    const p = this.state.players[this.id];
    const hand = [...p.hand];
    let landCount = hand.filter(card => isType(this.db[card.cardId], 'Land')).length;
    const ranked = hand.map(card => {
      const d = this.db[card.cardId] || {};
      let bottom = Number(d.manaValue || 0);
      if (isType(d, 'Land')) bottom = landCount > 4 ? 20 : -10;
      else if (this.isRamp(d) && landCount <= 3) bottom -= 8;
      else if (Number(d.manaValue || 0) <= 3) bottom -= 4;
      return { card, bottom };
    }).sort((a, b) => b.bottom - a.bottom);
    const chosen = ranked.slice(0, count).map(item => item.card.instanceId);
    for (const item of ranked.slice(0, count)) if (isType(this.db[item.card.cardId], 'Land')) landCount--;
    return chosen;
  }

  chooseCleanupDiscards(count) {
    const p = this.state.players[this.id];
    const lands = p.hand.filter(card => isType(this.db[card.cardId], 'Land')).length;
    return [...p.hand].map(card => {
      const d = this.db[card.cardId] || {};
      let keep = this.cardStrategicValue(d, { zone: 'hand' });
      if (isType(d, 'Land')) keep = lands > 5 ? 1 : (this.handNeedsLand() ? 18 : 7);
      if (Number(d.manaValue || 0) > this.availableManaEstimate() + 4 && !this.effectTypes(d.spellEffects).has('extraTurn')) keep -= 3;
      return { card, keep };
    }).sort((a, b) => a.keep - b.keep || a.card.instanceId.localeCompare(b.card.instanceId)).slice(0, count).map(item => item.card.instanceId);
  }

  _submitChosenAction(action) {
    if (!action) return null;
    const state = this._refreshView();
    if (!this.legalActions.isAuthorized(action)) throw new Error('AI attempted to submit an action that is not in the authoritative legal-action set');
    const response = state.pendingChoice
      ? this.engine.submitChoice(this.id, action)
      : (action.type === 'PASS_PRIORITY' ? this.engine.passPriority(this.id) : this.engine.submitAction(this.id, action));
    if (!response.ok) {
      const error = new Error(response.error.message);
      error.code = response.error.code;
      throw error;
    }
    if (this.lastDecision) this.engine.recordAIDecision(this.lastDecision);
    this._refreshView();
    return response.result;
  }

  submit(action) {
    return this._submitChosenAction(action);
  }

  step() {
    const action = this.choose();
    if (action) this.submit(action);
    return action;
  }

  run(max = 100) {
    let n = 0;
    this._refreshView();
    while (n++ < max && !this.state.winner) {
      if (this.state.priorityPlayer !== this.id && this.state.pendingChoice?.playerId !== this.id) break;
      const action = this.step();
      if (!action) break;
    }
    return n;
  }
}
