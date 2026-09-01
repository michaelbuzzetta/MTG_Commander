import { isType } from '../engine/utils.js';

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
      const ids = s.players[this.id].hand.slice(-choice.count).map(c => c.instanceId);
      return { type: choice.type === 'MULLIGAN_BOTTOM' ? 'BOTTOM_CARDS' : 'DISCARD_CARDS', cardInstanceIds: ids };
    }

    if (s.pregame.active) return { type: 'KEEP_HAND' };

    // Mandatory turn-based actions come before any optional resource action. This
    // prevents the AI from tapping creatures for speculative mana before combat.
    if (s.turnActionPending === 'DECLARE_ATTACKERS' && s.activePlayer === this.id) {
      const action = {
        type: 'DECLARE_ATTACKERS',
        attackers: e.combat.legalAttackers(this.id).filter(a => this.attackScore(a) > 0).map(a => a.instanceId)
      };
      return e.isActionLegal(this.id, action) ? action : { type: 'DECLARE_ATTACKERS', attackers: [] };
    }
    if (s.turnActionPending === 'DECLARE_BLOCKERS' && s.activePlayer !== this.id) {
      return this.chooseBlockers();
    }

    const land = acts.find(a => a.type === 'PLAY_LAND');
    if (land) return land;

    const castables = acts.filter(a => ['CAST_SPELL', 'CAST_COMMANDER'].includes(a.type));
    if (castables.length) return castables.sort((a, b) => this.score(b) - this.score(a))[0];

    // Casting already uses the engine's deterministic payment plan. A standalone
    // ACTIVATE_MANA action without a concrete cast/activation to pay for is never
    // useful to this AI and can consume an attacker/blocker for no benefit.
    const ability = acts.find(a => a.type === 'ACTIVATE_ABILITY');
    if (ability) return ability;
    return acts.find(a => a.type === 'PASS_PRIORITY') || acts.find(a => a.type !== 'ACTIVATE_MANA') || null;
  }

  chooseBlockers() {
    const e = this.engine, s = e.state;
    const map = {};
    const available = s.players[this.id].battlefield.filter(x => e.static.isType(x, 'Creature') && !x.tapped);

    for (const attackerId of s.combat.attackers) {
      const attacker = e.findPermanent(attackerId);
      if (!attacker) continue;
      const candidates = available.filter(blocker => e.combat.canBlock(blocker, attacker));
      const menace = e.static.derivedStats(attacker).keywords.some(keyword => keyword.toLowerCase() === 'menace');
      const needed = menace ? 2 : 1;
      if (candidates.length < needed) continue;

      // Prefer the lowest-toughness legal blockers first and reserve each blocker
      // globally so a creature is never assigned to two attackers.
      const picked = candidates
        .sort((a, b) => e.static.derivedStats(a).toughness - e.static.derivedStats(b).toughness)
        .slice(0, needed);
      map[attackerId] = picked.map(x => x.instanceId);
      for (const blocker of picked) available.splice(available.indexOf(blocker), 1);
    }

    const action = { type: 'DECLARE_BLOCKERS', blockers: map };
    if (e.isActionLegal(this.id, action)) return action;
    const decline = { type: 'DECLARE_BLOCKERS', blockers: {} };
    if (e.isActionLegal(this.id, decline)) return decline;
    throw new Error('AI could not construct a legal blocker declaration from engine legality');
  }

  score(a) {
    const c = this.engine.state.players[this.id].hand.concat(this.engine.state.players[this.id].command).find(x => x.instanceId === a.cardInstanceId);
    const d = this.engine.db[c?.cardId];
    return (d?.manaValue || 0) + (isType(d, 'Creature') ? 2 : 0) + (d?.abilities?.length || 0);
  }

  attackScore(p) {
    const st = this.engine.static.derivedStats(p);
    return st.power > 0 ? st.power : 0;
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
