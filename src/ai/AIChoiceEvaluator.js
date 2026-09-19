/**
 * Strategy-only choice evaluator. It consumes the engine's legal choice actions
 * and player-scoped snapshot; it never mutates game state.
 */
export class AIChoiceEvaluator {
  constructor(controller) {
    this.controller = controller;
  }

  evaluate(choice, actions = []) {
    const c = this.controller, e = c.engine, s = c.state;
    if (!choice || choice.playerId !== c.id) return null;

    if (choice.type === 'ENGINE_CHOICE') {
      const request = e.getPendingChoiceRequest();
      if (!request) return null;
      const exact = actions.filter(action => action.type === 'SUBMIT_CHOICE');
      if (exact.length > 1) {
        const truthy = exact.find(action => action.response?.selections?.[0] === true);
        return truthy || exact[0];
      }
      const values = (request.legalOptions || []).map(item => item && typeof item === 'object' && Object.prototype.hasOwnProperty.call(item, 'value') ? item.value : item);
      let selections = values.slice(0, Math.max(request.min || 0, Math.min(request.max || 0, values.length)));
      if (request.choiceType === 'boolean' && values.length) selections = [values.includes(true) ? true : values[0]];
      if (request.choiceType === 'number') selections = [Number(request.min || 0)];
      const response = { requestId: request.requestId, selections };
      if (request.orderingRequired || request.choiceType === 'order') response.orderedSelections = [...selections];
      return { type: 'SUBMIT_CHOICE', response };
    }

    if (choice.type === 'COMBAT_DAMAGE_ORDER') {
      const orders = {};
      for (const [attackerId, blockerIds] of Object.entries(choice.attackers || {})) orders[attackerId] = c.orderCombatBlockers(attackerId, blockerIds);
      return { type: 'ORDER_BLOCKERS', orders };
    }

    if (choice.type === 'LEGEND_RULE') {
      return [...actions]
        .filter(action => action.type === 'CHOOSE_LEGEND')
        .sort((a, b) => {
          const pa = e.getPermanentSnapshot(a.keepInstanceId), pb = e.getPermanentSnapshot(b.keepInstanceId);
          return c.permanentThreat(pb) - c.permanentThreat(pa) || String(a.keepInstanceId).localeCompare(String(b.keepInstanceId));
        })[0] || null;
    }

    if (choice.type === 'COMMANDER_ZONE') {
      return actions.find(action => action.type === 'CHOOSE_COMMANDER_ZONE' && action.moveToCommand)
        || actions.find(action => action.type === 'CHOOSE_COMMANDER_ZONE') || null;
    }

    if (choice.type === 'PREGAME_ACTION') {
      const accepts = actions.filter(action => action.type === 'CHOOSE_PREGAME_ACTION' && action.accept);
      if (!accepts.length) return actions.find(action => action.type === 'CHOOSE_PREGAME_ACTION') || null;
      if (choice.actionType === 'gemstone-caverns') {
        return [...accepts].sort((a, b) => {
          const av = c.cardChoiceValue(a.exileCardInstanceId), bv = c.cardChoiceValue(b.exileCardInstanceId);
          return av - bv || String(a.exileCardInstanceId).localeCompare(String(b.exileCardInstanceId));
        })[0];
      }
      return accepts[0];
    }

    if (choice.type === 'WARD_PAYMENT') {
      const pay = actions.find(action => action.type === 'PAY_WARD');
      if (pay && c.shouldPayWard(choice)) return pay;
      return actions.find(action => action.type === 'DECLINE_WARD') || pay || null;
    }

    if (choice.type === 'OPTIONAL_TRIGGER') {
      const accept = c.shouldAcceptOptionalTrigger(choice);
      return actions.find(action => action.type === 'CHOOSE_TRIGGER' && action.accept === accept)
        || actions.find(action => action.type === 'CHOOSE_TRIGGER') || null;
    }

    if (choice.type === 'OPTIONAL_MANA_PAYMENT') {
      const shouldPay = c.shouldPayOptionalMana(choice);
      return actions.find(action => action.type === 'CHOOSE_OPTIONAL_MANA_PAYMENT' && action.pay === shouldPay)
        || actions.find(action => action.type === 'CHOOSE_OPTIONAL_MANA_PAYMENT' && !action.pay)
        || null;
    }

    if (choice.type === 'TAP_OR_UNTAP') {
      const target = e.getPermanentSnapshot(choice.targetId);
      const desired = !target ? 'none' : (target.controller === c.id && target.tapped ? 'untap' : (target.controller !== c.id && !target.tapped ? 'tap' : 'none'));
      return actions.find(action => action.type === 'CHOOSE_TAP_OR_UNTAP' && action.choice === desired)
        || actions.find(action => action.type === 'CHOOSE_TAP_OR_UNTAP') || null;
    }

    if (choice.type === 'OPTIONAL_EFFECT') {
      const accept = c.shouldAcceptOptionalEffect(choice);
      return actions.find(action => action.type === 'CHOOSE_OPTIONAL_EFFECT' && action.accept === accept)
        || actions.find(action => action.type === 'CHOOSE_OPTIONAL_EFFECT') || null;
    }

    if (choice.type === 'TRIGGER_ORDER') {
      const live = new Map(s.pendingTriggers.map(trigger => [trigger.id, trigger]));
      const ordered = [...(choice.triggers || [])]
        .sort((a, b) => c.effectStrategicValue(live.get(a.id)?.effect) - c.effectStrategicValue(live.get(b.id)?.effect)
          || (a.sourceName || '').localeCompare(b.sourceName || '') || a.id.localeCompare(b.id))
        .map(trigger => trigger.id);
      return { type: 'ORDER_TRIGGERS', triggerIds: ordered.length ? ordered : [...choice.triggerIds] };
    }

    if (choice.type === 'PROLIFERATE') {
      const targetIds = choice.eligibleIds.filter(id => id === c.id || e.getPermanentSnapshot(id)?.controller === c.id);
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

    if (choice.type === 'EXPLORE_NONLAND') {
      const card = s.players[c.id].library.find(item => item.instanceId === choice.cardInstanceId) || s.players[c.id].library[0];
      const def = card ? c.db[card.cardId] : null;
      const keep = def ? c.cardStrategicValue(def, { zone: 'library' }) : 0;
      return actions.find(action => action.type === 'CHOOSE_EXPLORE' && action.putInGraveyard === (keep < 8))
        || actions.find(action => action.type === 'CHOOSE_EXPLORE') || null;
    }

    if (choice.type === 'EXPLORE_ORDER') return { type: 'ORDER_EXPLORES', permanentIds: [...choice.permanentIds] };
    if (choice.type === 'HAKBAL_ATTACK') return actions.find(action => action.type === 'CHOOSE_HAKBAL_ATTACK' && action.landInstanceId) || actions[0] || null;
    if (choice.type === 'CULTIVATE_SEARCH') return { type: 'CHOOSE_CULTIVATE', cardInstanceIds: c.chooseCultivateTargets(choice.eligibleIds, 2) };

    if (choice.type === 'SISAY_TUTOR') {
      const ranked = c.rankCardChoiceIds(choice.eligibleIds);
      return actions.find(action => action.type === 'CHOOSE_SISAY_TUTOR' && action.cardInstanceId === ranked[0])
        || actions.find(action => action.type === 'CHOOSE_SISAY_TUTOR') || null;
    }

    if (choice.type === 'SCRY') {
      const top = s.players[c.id].library.find(item => item.instanceId === choice.cardInstanceId) || s.players[c.id].library[0];
      const def = top ? c.db[top.cardId] : null;
      const putOnBottom = !!def && c.shouldBottomTopCard(def);
      return actions.find(action => action.type === 'CHOOSE_SCRY' && action.putOnBottom === putOnBottom)
        || actions.find(action => action.type === 'CHOOSE_SCRY') || null;
    }

    if (choice.type === 'TRIGGER_TARGET') {
      const trigger = s.pendingTriggers.find(item => item.id === choice.triggerId);
      const count = Math.max(choice.minTargets || 0, Math.min(choice.maxTargets || 1, choice.candidateIds.length));
      const preferred = c.rankTargetIds(choice.candidateIds, trigger?.effect, trigger?.ability).slice(0, count);
      return { type: 'CHOOSE_TRIGGER_TARGET', targetIds: preferred };
    }

    if (choice.type === 'CREATURE_TYPE') {
      const creatureType = c.chooseCreatureType(choice.options);
      return actions.find(action => action.type === 'CHOOSE_CREATURE_TYPE' && action.creatureType === creatureType)
        || actions.find(action => action.type === 'CHOOSE_CREATURE_TYPE') || null;
    }

    if (choice.type === 'LIBRARY_SEARCH') {
      const take = Math.max(Number(choice.min || 0), Math.min(Number(choice.max || 0), choice.candidateIds.length));
      return { type: 'CHOOSE_LIBRARY_SEARCH', cardInstanceIds: c.rankCardChoiceIds(choice.candidateIds).slice(0, take) };
    }

    if (choice.type === 'EFFECT_CARD_CHOICE') {
      const take = Math.min(choice.max || 0, Math.max(choice.min || 0, choice.max || 0));
      if (choice.continuation?.type === 'searchLand') {
        const best = c.chooseCultivateTargets(choice.candidateIds, 1)[0];
        return { type: 'CHOOSE_EFFECT_CARDS', cardInstanceIds: best ? [best] : [] };
      }
      if (choice.continuation?.type === 'myriadLandscape' && take > 1) {
        const basicTypes = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
        let best = [];
        for (const type of basicTypes) {
          const matching = choice.candidateIds.filter(id => {
            const card = s.players[c.id].library.find(item => item.instanceId === id);
            const def = c.db[card?.cardId] || {};
            return (def.subtypes || []).some(subtype => String(subtype).toLowerCase() === type.toLowerCase());
          });
          if (matching.length > best.length) best = matching;
          if (matching.length >= take) return { type: 'CHOOSE_EFFECT_CARDS', cardInstanceIds: matching.slice(0, take) };
        }
        return { type: 'CHOOSE_EFFECT_CARDS', cardInstanceIds: best.slice(0, Math.max(choice.min || 0, Math.min(choice.max || 0, best.length))) };
      }
      return { type: 'CHOOSE_EFFECT_CARDS', cardInstanceIds: c.rankCardChoiceIds(choice.candidateIds).slice(0, take) };
    }

    if (choice.type === 'COPY_TARGETS') return { type: 'CHOOSE_COPY_TARGETS', targetIds: [...choice.originalTargets] };

    if (choice.type === 'COPY_PERMANENT') {
      const options = actions.filter(action => action.type === 'CHOOSE_PERMANENT_COPY' && action.permanentId);
      return [...options].sort((a, b) => c.permanentThreat(e.getPermanentSnapshot(b.permanentId)) - c.permanentThreat(e.getPermanentSnapshot(a.permanentId))
        || String(a.permanentId).localeCompare(String(b.permanentId)))[0]
        || actions.find(action => action.type === 'CHOOSE_PERMANENT_COPY') || null;
    }

    if (choice.type === 'ATTACHMENT_ENTRY') {
      const options = actions.filter(action => action.type === 'CHOOSE_ATTACHMENT_HOST');
      const own = options.filter(action => e.getPermanentSnapshot(action.hostId)?.controller === c.id);
      return [...(own.length ? own : options)].sort((a, b) => c.permanentThreat(e.getPermanentSnapshot(b.hostId)) - c.permanentThreat(e.getPermanentSnapshot(a.hostId))
        || String(a.hostId).localeCompare(String(b.hostId)))[0] || null;
    }

    if (choice.type === 'ENTRY_LIFE_PAYMENT') {
      const cost = Number(choice.lifeCost || 0);
      const forcedTapped = !!choice.landEffect?.tapped;
      const pay = !forcedTapped && s.players[c.id].life > cost + 5;
      return actions.find(action => action.type === 'CHOOSE_ENTRY_LIFE_PAYMENT' && action.pay === pay)
        || actions.find(action => action.type === 'CHOOSE_ENTRY_LIFE_PAYMENT') || null;
    }

    if (choice.type === 'ENTRY_REVEAL') return actions.find(action => action.type === 'CHOOSE_ENTRY_REVEAL' && action.cardInstanceId) || actions[0] || null;

    if (choice.type === 'HIDEAWAY') {
      const best = c.rankCardChoiceIds(choice.candidateIds)[0];
      return actions.find(action => action.type === 'CHOOSE_HIDEAWAY' && action.cardInstanceId === best)
        || actions.find(action => action.type === 'CHOOSE_HIDEAWAY') || null;
    }

    if (choice.type === 'HIDEAWAY_PLAY') {
      return actions.find(action => action.type === 'CAST_SPELL')
        || actions.find(action => action.type === 'PLAY_HIDEAWAY_LAND')
        || actions.find(action => action.type === 'DECLINE_HIDEAWAY_PLAY')
        || null;
    }

    if (choice.type === 'MULLIGAN_BOTTOM') return { type: 'BOTTOM_CARDS', cardInstanceIds: c.chooseMulliganBottom(choice.count) };

    // Cleanup and any legacy discard-shaped choice use the authoritative count
    // exposed by the pending choice, then are validated by the legal adapter.
    return { type: 'DISCARD_CARDS', cardInstanceIds: c.chooseCleanupDiscards(choice.count) };
  }
}
