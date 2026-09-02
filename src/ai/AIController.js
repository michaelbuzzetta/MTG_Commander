import { isType, parseManaCost } from '../engine/utils.js';

export class AIController {
  constructor(engine, id = 'ai') { this.engine = engine; this.id = id; }

  choose() {
    const e = this.engine, s = e.state;
    if (s.priorityPlayer !== this.id) return null;
    const acts = e.getLegalActions(this.id);
    if (!acts.length) return null;

    const choice = s.pendingChoice;
    if (choice?.playerId === this.id) {
      if (choice.type === 'COMBAT_DAMAGE_ORDER') {
        const orders = {};
        for (const [aid, bids] of Object.entries(choice.attackers || {})) {
          orders[aid] = [...bids].sort((x, y) => {
            const a = e.findPermanent(x), b = e.findPermanent(y);
            return (a ? e.static.derivedStats(a).toughness : Infinity) - (b ? e.static.derivedStats(b).toughness : Infinity);
          });
        }
        return { type: 'ORDER_BLOCKERS', orders };
      }
      if (choice.type === 'LEGEND_RULE') {
        const keep = choice.permanentIds
          .map(id => e.findPermanent(id))
          .filter(Boolean)
          .sort((a, b) => {
            const aCounters = Object.values(a.counters || {}).reduce((sum, value) => sum + value, 0);
            const bCounters = Object.values(b.counters || {}).reduce((sum, value) => sum + value, 0);
            return bCounters - aCounters;
          })[0];
        return { type: 'CHOOSE_LEGEND', keepInstanceId: keep.instanceId };
      }
      if (choice.type === 'COMMANDER_ZONE') return { type: 'CHOOSE_COMMANDER_ZONE', moveToCommand: true };
      if (choice.type === 'WARD_PAYMENT') return acts.find(action => action.type === 'PAY_WARD') || acts.find(action => action.type === 'DECLINE_WARD') || null;
      if (choice.type === 'OPTIONAL_TRIGGER') return { type: 'CHOOSE_TRIGGER', accept: true, triggerId: choice.triggerId };
      if (choice.type === 'OPTIONAL_MANA_PAYMENT') return acts.find(action => action.type === 'CHOOSE_OPTIONAL_MANA_PAYMENT' && action.pay) || { type: 'CHOOSE_OPTIONAL_MANA_PAYMENT', pay: false };
      if (choice.type === 'TAP_OR_UNTAP') {
        const target = e.findPermanent(choice.targetId);
        if (!target) return { type: 'CHOOSE_TAP_OR_UNTAP', choice: 'none' };
        if (target.controller === this.id && target.tapped) return { type: 'CHOOSE_TAP_OR_UNTAP', choice: 'untap' };
        if (target.controller !== this.id && !target.tapped) return { type: 'CHOOSE_TAP_OR_UNTAP', choice: 'tap' };
        return { type: 'CHOOSE_TAP_OR_UNTAP', choice: 'none' };
      }
      if (choice.type === 'OPTIONAL_EFFECT') return { type: 'CHOOSE_OPTIONAL_EFFECT', accept: true };
      if (choice.type === 'TRIGGER_ORDER') {
        const ordered = [...(choice.triggers || [])]
          .sort((a, b) => (a.sourceName || '').localeCompare(b.sourceName || '') || a.id.localeCompare(b.id))
          .map(trigger => trigger.id);
        return { type: 'ORDER_TRIGGERS', triggerIds: ordered.length ? ordered : [...choice.triggerIds] };
      }
      if (choice.type === 'PROLIFERATE') {
        const targetIds = choice.eligibleIds.filter(id => id === this.id || e.findPermanent(id)?.controller === this.id);
        return { type: 'CHOOSE_PROLIFERATE', targetIds };
      }
      if (choice.type === 'PHASE_OUT_PROLIFERATED') {
        return { type: 'CHOOSE_PHASE_OUT_PROLIFERATED', permanentIds: [...choice.eligibleIds] };
      }
      if (choice.type === 'REPLACEMENT_ORDER') {
        const rank = effect => effect === 'addOne' ? 0 : effect === 'double' ? 1 : 2;
        const replacementIds = [...(choice.replacements || [])]
          .sort((a, b) => rank(a.effect) - rank(b.effect) || a.id.localeCompare(b.id))
          .map(replacement => replacement.id);
        return { type: 'ORDER_REPLACEMENTS', replacementIds: replacementIds.length ? replacementIds : [...choice.replacementIds] };
      }
      if (choice.type === 'EXPLORE_NONLAND') return { type: 'CHOOSE_EXPLORE', putInGraveyard: true };
      if (choice.type === 'EXPLORE_ORDER') return { type: 'ORDER_EXPLORES', permanentIds: [...choice.permanentIds] };
      if (choice.type === 'HAKBAL_ATTACK') return { type: 'CHOOSE_HAKBAL_ATTACK', landInstanceId: choice.landInstanceIds[0] || null };
      if (choice.type === 'CULTIVATE_SEARCH') return { type: 'CHOOSE_CULTIVATE', cardInstanceIds: choice.eligibleIds.slice(0, 2) };
      if (choice.type === 'SISAY_TUTOR') {
        const best = choice.eligibleIds.map(id => {
          const card = s.players[this.id].library.find(item => item.instanceId === id);
          return { id, mv: e.db[card?.cardId]?.manaValue || 0 };
        }).sort((a, b) => b.mv - a.mv)[0];
        return { type: 'CHOOSE_SISAY_TUTOR', cardInstanceId: best?.id || null };
      }
      if (choice.type === 'SCRY') {
        const top = s.players[this.id].library[0];
        return { type: 'CHOOSE_SCRY', putOnBottom: !!top && !isType(e.db[top.cardId], 'Land') };
      }
      if (choice.type === 'TRIGGER_TARGET') {
        const count = Math.max(choice.minTargets || 0, Math.min(choice.maxTargets || 1, 1));
        const preferred = [...choice.candidateIds].sort((a,b) => {
          const ao = s.players[a] ? (a === this.id ? 1 : 0) : (e.findPermanent(a)?.controller === this.id ? 1 : 0);
          const bo = s.players[b] ? (b === this.id ? 1 : 0) : (e.findPermanent(b)?.controller === this.id ? 1 : 0);
          return ao - bo;
        }).slice(0,count);
        return { type: 'CHOOSE_TRIGGER_TARGET', targetIds: preferred };
      }
      if (choice.type === 'CREATURE_TYPE') return { type: 'CHOOSE_CREATURE_TYPE', creatureType: choice.options.includes('Merfolk') ? 'Merfolk' : choice.options[0] };
      if (choice.type === 'EFFECT_CARD_CHOICE') {
        const take = Math.min(choice.max || 0, Math.max(choice.min || 0, choice.max || 0));
        if (choice.continuation?.type === 'myriadLandscape' && take > 1) {
          const basicTypes = ['Plains','Island','Swamp','Mountain','Forest'];
          let best = [];
          for (const type of basicTypes) {
            const matching = choice.candidateIds.filter(id => {
              const card = s.players[this.id].library.find(c => c.instanceId === id);
              const def = e.db[card?.cardId] || {};
              return (def.subtypes || []).some(subtype => String(subtype).toLowerCase() === type.toLowerCase());
            });
            if (matching.length > best.length) best = matching;
            if (matching.length >= take) return { type: 'CHOOSE_EFFECT_CARDS', cardInstanceIds: matching.slice(0, take) };
          }
          return { type: 'CHOOSE_EFFECT_CARDS', cardInstanceIds: best.slice(0, Math.max(choice.min || 0, Math.min(choice.max || 0, best.length))) };
        }
        return { type: 'CHOOSE_EFFECT_CARDS', cardInstanceIds: choice.candidateIds.slice(0, take) };
      }
      if (choice.type === 'COPY_TARGETS') return { type: 'CHOOSE_COPY_TARGETS', targetIds: [...choice.originalTargets] };
      if (choice.type === 'ENTRY_REVEAL') return { type: 'CHOOSE_ENTRY_REVEAL', cardInstanceId: choice.candidateIds[0] || null };
      if (choice.type === 'HIDEAWAY') {
        const best = choice.candidateIds.map(id => {
          const found = ['library','hand','graveyard','exile'].flatMap(z => s.players[this.id][z] || []).find(c => c.instanceId === id);
          return { id, mv: e.db[found?.cardId]?.manaValue || 0 };
        }).sort((a,b)=>b.mv-a.mv)[0];
        return { type: 'CHOOSE_HIDEAWAY', cardInstanceId: best?.id || null };
      }
      if (choice.type === 'HIDEAWAY_PLAY') {
        return acts.find(action => action.type === 'CAST_SPELL')
          || acts.find(action => action.type === 'PLAY_HIDEAWAY_LAND')
          || acts.find(action => action.type === 'DECLINE_HIDEAWAY_PLAY')
          || null;
      }
      if (choice.type === 'MULLIGAN_BOTTOM') {
        return { type: 'BOTTOM_CARDS', cardInstanceIds: this.chooseMulliganBottom(choice.count) };
      }
      const ids = this.chooseCleanupDiscards(choice.count);
      return { type: 'DISCARD_CARDS', cardInstanceIds: ids };
    }

    if (s.pregame.active) {
      const mulligan = acts.find(action => action.type === 'MULLIGAN');
      if (mulligan && this.shouldMulligan()) return mulligan;
      return acts.find(action => action.type === 'KEEP_HAND') || { type: 'KEEP_HAND' };
    }

    // Mandatory turn-based actions come before any optional resource action. This
    // prevents the AI from tapping creatures for speculative mana before combat.
    if (s.turnActionPending === 'DECLARE_ATTACKERS' && s.activePlayer === this.id) {
      const defender = this.chooseDefender();
      const attackers = defender
        ? e.combat.legalAttackers(this.id).filter(attacker => this.attackScore(attacker, defender) > 0).map(attacker => attacker.instanceId)
        : [];
      const action = {
        type: 'DECLARE_ATTACKERS',
        attackers,
        attackTargets: Object.fromEntries(attackers.map(id => [id, defender]))
      };
      return e.isActionLegal(this.id, action) ? action : { type: 'DECLARE_ATTACKERS', attackers: [], attackTargets: {} };
    }
    if (s.turnActionPending === 'DECLARE_BLOCKERS' && s.activePlayer !== this.id) {
      return this.chooseBlockers();
    }

    const lands = acts.filter(action => action.type === 'PLAY_LAND');
    if (lands.length) return [...lands].sort((a, b) => this.landScore(b) - this.landScore(a))[0];

    const castables = acts.filter(action => ['CAST_SPELL', 'CAST_COMMANDER'].includes(action.type));
    if (castables.length) {
      const ranked = [...castables].sort((a, b) => this.score(b) - this.score(a));
      const best = ranked[0];
      if (this.score(best) >= this.castThreshold(best)) return best;
    }

    // Casting already uses the engine's deterministic payment plan. A standalone
    // ACTIVATE_MANA action without a concrete cast/activation to pay for is never
    // useful to this AI and can consume an attacker/blocker for no benefit.
    const abilities = acts.filter(action => action.type === 'ACTIVATE_ABILITY');
    if (abilities.length) {
      const best = [...abilities].sort((a, b) => this.abilityScore(b) - this.abilityScore(a))[0];
      if (this.abilityScore(best) > 8) return best;
    }
    return acts.find(a => a.type === 'PASS_PRIORITY') || acts.find(a => a.type !== 'ACTIVATE_MANA') || null;
  }



  chooseDefender() {
    const opponents = this.engine.opponents(this.id);
    if (!opponents.length) return null;
    return [...opponents].sort((a, b) => this.defenderScore(b) - this.defenderScore(a) || a.localeCompare(b))[0];
  }

  defenderScore(pid) {
    const e = this.engine, player = e.state.players[pid];
    if (!player || player.lost) return -Infinity;
    const creatures = player.battlefield.filter(card => e.static.isType(card, 'Creature') && !card.phasedOut);
    const untappedBlockers = creatures.filter(card => !card.tapped);
    const boardThreat = creatures.reduce((sum, card) => sum + this.permanentThreat(card), 0);
    const commanderDamage = Number(e.state.players[this.id]?.commanderDamageReceived?.[pid] || 0);
    // Prefer a vulnerable / low-life player, but avoid needlessly charging into
    // the strongest open battlefield in multiplayer.
    return (40 - player.life) * 1.8 + commanderDamage * 1.2 - untappedBlockers.length * 4 - boardThreat * 0.12;
  }

  chooseBlockers() {
    const e = this.engine, s = e.state;
    const map = {};
    const available = s.players[this.id].battlefield.filter(x => e.static.isType(x, 'Creature') && !x.tapped && !x.phasedOut);
    const incoming = s.combat.attackers
      .filter(attackerId => (s.combat.attackTargets?.[attackerId] || e.opponent(s.activePlayer)) === this.id)
      .map(attackerId => e.findPermanent(attackerId))
      .filter(Boolean)
      .sort((a, b) => this.permanentThreat(b) - this.permanentThreat(a));

    const incomingDamage = incoming.reduce((sum, attacker) => sum + Math.max(0, e.static.derivedStats(attacker).power), 0);
    let lifeAfterUnblocked = s.players[this.id].life - incomingDamage;

    for (const attacker of incoming) {
      const ast = e.static.derivedStats(attacker);
      const candidates = available.filter(blocker => e.combat.canBlock(blocker, attacker));
      const menace = ast.keywords.some(keyword => keyword.toLowerCase() === 'menace');
      const needed = menace ? 2 : 1;
      if (candidates.length < needed) continue;

      const attackerValue = this.permanentThreat(attacker);
      let picked = [];
      if (needed === 1) {
        const profitable = candidates
          .map(blocker => ({ blocker, quality: this.blockQuality(blocker, attacker) }))
          .filter(item => item.quality > 0)
          .sort((a, b) => b.quality - a.quality || this.permanentThreat(a.blocker) - this.permanentThreat(b.blocker));
        if (profitable.length) picked = [profitable[0].blocker];
        else if (lifeAfterUnblocked <= 8 || ast.power >= s.players[this.id].life) {
          picked = [candidates.sort((a, b) => this.permanentThreat(a) - this.permanentThreat(b))[0]];
        }
      } else {
        const pair = candidates
          .sort((a, b) => this.permanentThreat(a) - this.permanentThreat(b))
          .slice(0, 2);
        const totalPower = pair.reduce((sum, blocker) => sum + e.static.derivedStats(blocker).power, 0);
        if (pair.length === 2 && (totalPower >= ast.toughness || lifeAfterUnblocked <= 8 || attackerValue >= pair.reduce((sum, blocker) => sum + this.permanentThreat(blocker), 0))) picked = pair;
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

  blockQuality(blocker, attacker) {
    const e = this.engine;
    const bs = e.static.derivedStats(blocker), as = e.static.derivedStats(attacker);
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
    const p = this.engine.state.players[this.id];
    return ['hand', 'command', 'graveyard', 'exile', 'library'].flatMap(zone => p?.[zone] || []);
  }

  cardForAction(action) {
    if (!action?.cardInstanceId) return null;
    return this.allCardsForPlayer().find(card => card.instanceId === action.cardInstanceId) || null;
  }

  definitionForAction(action) {
    const card = this.cardForAction(action);
    return card ? this.engine.db[card.cardId] || null : null;
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
    const e = this.engine, d = e.db[permanent?.cardId] || {};
    if (!permanent) return 0;
    let score = Number(d.manaValue || 0) * 1.2 + (d.abilities?.length || 0) * 2;
    const counters = Object.values(permanent.counters || {}).reduce((sum, amount) => sum + Number(amount || 0), 0);
    score += counters * 1.5;
    if (e.static.isType(permanent, 'Creature')) {
      const st = e.static.derivedStats(permanent);
      score += Math.max(0, st.power) * 1.5 + Math.max(0, st.toughness) * 0.6 + (st.keywords?.length || 0) * 1.4;
    }
    if (permanent.isCommander) score += 5;
    return score;
  }

  targetScore(action, effects = this.actionEffects(action)) {
    const e = this.engine, s = e.state;
    const harmful = ['damage', 'destroy', 'returnToHand', 'returnAttackers', 'returnCreaturesWithoutCounter', 'ruinousIntrusion', 'gainControl'];
    const helpful = ['gainLife', 'gainLifeTarget', 'addCounter', 'addCounterSource', 'addCountersAll', 'pump', 'pumpEventObject', 'untap', 'doubleCounters', 'attachEquipment'];
    const isHarmful = harmful.some(type => effects.has(type));
    const isHelpful = helpful.some(type => effects.has(type));
    let score = 0;

    for (const id of action.targets || []) {
      const targetPlayer = s.players[id];
      if (targetPlayer) {
        const mine = id === this.id;
        if (isHarmful) score += mine ? -35 : 10 + (40 - targetPlayer.life) * 0.5;
        else if (isHelpful) score += mine ? 18 : -18;
        else score += mine ? 1 : 3;
        continue;
      }
      const permanent = e.findPermanent(id);
      if (!permanent) continue;
      const mine = permanent.controller === this.id;
      const threat = this.permanentThreat(permanent);
      if (isHarmful) score += mine ? -25 - threat : 8 + threat * 1.7;
      else if (isHelpful) score += mine ? 6 + threat * 0.7 : -12 - threat;
      else score += mine ? 2 : threat * 0.25;
    }
    return score;
  }

  isRamp(definition, effects = this.effectTypes([definition?.spellEffects, definition?.onEnterEffects, ...(definition?.abilities || []).map(a => a.effect)])) {
    if (!definition) return false;
    if ((definition.abilities || []).some(ability => ability.type === 'mana')) return true;
    return ['cultivate', 'putLandFromHand', 'putLandFromHandIfExploredLand', 'additionalLandPlay', 'myriadLandscape'].some(type => effects.has(type));
  }

  landScore(action) {
    const e = this.engine, p = e.state.players[this.id], d = this.definitionForAction(action);
    if (!d) return 0;
    let score = 10;
    if (d.entersTapped) score -= 5;
    if (d.entersTappedUnless) score -= 1;
    const needed = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    for (const card of p.hand) {
      const def = e.db[card.cardId];
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
    const e = this.engine, s = e.state, p = s.players[this.id];
    const card = this.cardForAction(action), d = card ? e.db[card.cardId] : null;
    if (!d) return -Infinity;
    const effects = this.actionEffects(action, d);
    const mv = Number(d.manaValue || 0);
    const creatures = p.battlefield.filter(permanent => e.static.isType(permanent, 'Creature') && !permanent.phasedOut);
    const lands = p.battlefield.filter(permanent => e.static.isType(permanent, 'Land')).length;
    let value = 10 + mv * 1.2 + this.targetScore(action, effects);

    if (isType(d, 'Creature')) {
      value += 8 + Number(d.power || 0) * 1.2 + Number(d.toughness || 0) * 0.45 + (d.keywords?.length || 0) * 1.5;
      if (creatures.length < 2) value += 4;
    } else if (isType(d, 'Artifact') || isType(d, 'Enchantment')) value += 3;

    if (this.isRamp(d, effects)) value += lands < 5 ? 18 : 5;
    if (effects.has('draw') || effects.has('drawDiscard') || effects.has('drawEventAmount') || effects.has('conditionalDraw') || effects.has('drawPerCreatures') || effects.has('drawPerCreaturesWithCounter')) {
      value += 8 + Math.max(0, 5 - p.hand.length) * 3;
    }
    if (effects.has('cultivate')) value += lands < 5 ? 14 : 2;
    if (effects.has('destroy') || effects.has('damage') || effects.has('returnToHand') || effects.has('gainControl')) value += 6;
    if (effects.has('createToken')) value += 5;
    if (effects.has('proliferate')) {
      const countered = p.battlefield.filter(permanent => Object.values(permanent.counters || {}).some(Number)).length;
      value += countered * 2.5 - (countered ? 0 : 5);
    }
    if (effects.has('addCounter') || effects.has('addCountersAll') || effects.has('doubleCounters')) value += p.battlefield.some(permanent => Object.keys(permanent.counters || {}).length) ? 5 : 2;

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
      if (s.phase === 'END_STEP' && nextIsUs) value += effects.has('draw') ? 12 : 2;
      else if (interaction < 15 && !s.stack.length && !['DECLARE_ATTACKERS', 'DECLARE_BLOCKERS', 'COMBAT_DAMAGE'].includes(s.phase)) value -= 20;
    } else if (['PRECOMBAT_MAIN', 'POSTCOMBAT_MAIN'].includes(s.phase) && s.stack.length === 0) {
      value += 5;
    }

    return value;
  }

  castThreshold(action) {
    const s = this.engine.state;
    if (s.activePlayer === this.id) return 8;
    if (s.stack.length) return 15;
    if (s.phase === 'END_STEP' && this.engine.nextPlayer(s.activePlayer) === this.id) return 10;
    return 20;
  }

  abilityScore(action) {
    const e = this.engine, s = e.state;
    const source = e.findPermanent(action.permanentId);
    if (!source) return -Infinity;
    const effects = this.actionEffects(action, e.db[source.cardId]);
    let value = 5 + this.targetScore(action, effects);
    if (effects.has('draw') || effects.has('conditionalDraw')) value += 12 + Math.max(0, 4 - s.players[this.id].hand.length) * 2;
    if (effects.has('sisayTutor')) value += 20;
    if (effects.has('adapt') || effects.has('addCounter') || effects.has('addCounterSource')) value += 9;
    if (effects.has('proliferate')) value += s.players[this.id].battlefield.filter(permanent => Object.keys(permanent.counters || {}).length).length * 2;
    if (effects.has('damage') || effects.has('destroy') || effects.has('returnToHand')) value += 8;
    if (action.ability?.cost?.life) value -= Number(action.ability.cost.life) * (s.players[this.id].life < 10 ? 3 : 0.5);
    if (action.ability?.tap && s.activePlayer === this.id && s.phase === 'PRECOMBAT_MAIN' && e.static.isType(source, 'Creature') && this.attackScore(source, this.chooseDefender()) > 0) value -= 9;
    return value;
  }

  attackScore(permanent, defenderId = this.chooseDefender()) {
    const e = this.engine, st = e.static.derivedStats(permanent);
    if (!defenderId || st.power <= 0) return -Infinity;
    const defender = e.state.players[defenderId];
    const keywords = st.keywords.map(keyword => keyword.toLowerCase());
    const legalBlockers = defender.battlefield.filter(blocker => !blocker.tapped && !blocker.phasedOut && e.static.isType(blocker, 'Creature') && e.combat.canBlock(blocker, permanent));
    if (!legalBlockers.length) return 20 + st.power * 3 + (defender.life <= st.power ? 100 : 0);

    let value = st.power * 1.5;
    if (keywords.includes('vigilance')) value += 3;
    if (keywords.includes('trample')) value += 5;
    if (keywords.includes('deathtouch')) value += 5;
    if (permanent.isCommander) value += 2;

    const attackerThreat = this.permanentThreat(permanent);
    const bestTrade = legalBlockers.map(blocker => {
      const bs = e.static.derivedStats(blocker);
      const kills = keywords.includes('deathtouch') && st.power > 0 || st.power >= bs.toughness;
      const dies = bs.keywords.map(x => x.toLowerCase()).includes('deathtouch') && bs.power > 0 || bs.power >= st.toughness;
      return (kills ? this.permanentThreat(blocker) : 0) - (dies ? attackerThreat : 0);
    }).sort((a, b) => b - a)[0];
    value += bestTrade || 0;
    if (bestTrade < -4 && !keywords.includes('trample')) value -= 12;
    return value;
  }

  shouldMulligan() {
    const p = this.engine.state.players[this.id];
    if (!p || p.mulligans >= 2) return false;
    const defs = p.hand.map(card => this.engine.db[card.cardId]).filter(Boolean);
    const lands = defs.filter(def => isType(def, 'Land')).length;
    const early = defs.filter(def => !isType(def, 'Land') && Number(def.manaValue || 0) <= 3).length;
    const ramp = defs.filter(def => this.isRamp(def)).length;
    if (lands < 2 || lands > 5) return true;
    if (lands === 2 && early + ramp === 0) return true;
    return false;
  }

  chooseMulliganBottom(count) {
    const p = this.engine.state.players[this.id];
    const hand = [...p.hand];
    let landCount = hand.filter(card => isType(this.engine.db[card.cardId], 'Land')).length;
    const ranked = hand.map(card => {
      const d = this.engine.db[card.cardId] || {};
      let bottom = Number(d.manaValue || 0);
      if (isType(d, 'Land')) bottom = landCount > 4 ? 20 : -10;
      else if (this.isRamp(d) && landCount <= 3) bottom -= 8;
      else if (Number(d.manaValue || 0) <= 3) bottom -= 4;
      return { card, bottom };
    }).sort((a, b) => b.bottom - a.bottom);
    const chosen = ranked.slice(0, count).map(item => item.card.instanceId);
    for (const item of ranked.slice(0, count)) if (isType(this.engine.db[item.card.cardId], 'Land')) landCount--;
    return chosen;
  }

  chooseCleanupDiscards(count) {
    const p = this.engine.state.players[this.id];
    const lands = p.hand.filter(card => isType(this.engine.db[card.cardId], 'Land')).length;
    return [...p.hand].map(card => {
      const d = this.engine.db[card.cardId] || {};
      let keep = 10 - Number(d.manaValue || 0) * 0.4;
      if (isType(d, 'Land')) keep = lands > 5 ? 1 : 8;
      if (this.isRamp(d)) keep += 4;
      if (isType(d, 'Creature')) keep += 2;
      if (this.effectTypes(d.spellEffects).has('draw')) keep += 3;
      return { card, keep };
    }).sort((a, b) => a.keep - b.keep).slice(0, count).map(item => item.card.instanceId);
  }

  step() {
    const a = this.choose();
    if (a) this.engine.perform(this.id, a);
    return a;
  }

  run(max = 100) {
    let n = 0;
    while (n++ < max && !this.engine.state.winner) {
      if (this.engine.state.priorityPlayer !== this.id) break;
      const a = this.step();
      if (!a) break;
    }
    return n;
  }
}
