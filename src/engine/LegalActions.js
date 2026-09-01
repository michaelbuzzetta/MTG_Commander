import { isType } from './utils.js';

function combinations(items, count, limit = 128) {
  if (count === 0) return [[]];
  const out = [];
  const visit = (start, picked) => {
    if (out.length >= limit) return;
    if (picked.length === count) { out.push([...picked]); return; }
    for (let i = start; i < items.length; i++) {
      picked.push(items[i]);
      visit(i + 1, picked);
      picked.pop();
      if (out.length >= limit) return;
    }
  };
  visit(0, []);
  return out;
}

export class LegalActions {
  constructor(engine) { this.engine = engine; }

  _pushTargetedVariants(out, pid, baseAction, sourceDefinition, sourceObject) {
    const e = this.engine;
    if (!e.targeting.hasTargets(sourceDefinition)) {
      if (e.isActionLegal(pid, baseAction)) out.push(baseAction);
      return;
    }

    const targetSets = e.targeting.generateTargetSets(pid, sourceDefinition, { sourceObject });
    for (const targets of targetSets) {
      const action = { ...baseAction, targets };
      if (e.isActionLegal(pid, action)) out.push(action);
    }
  }

  _pushCardCastActions(out, pid, card, zone, castOption = null, extra = {}) {
    const e = this.engine, d = e.db[card.cardId];
    if (!d || isType(d, 'Land')) return;
    const type = card.isCommander && zone === 'command' ? 'CAST_COMMANDER' : 'CAST_SPELL';
    const modes = [
      ...(Array.isArray(d.modes) ? d.modes : []),
      ...e.dynamicXModesFor(pid, card, zone, castOption)
    ];
    if (modes.length) {
      for (const mode of modes) {
        const modeZone = mode.fromZone || 'hand';
        const zoneMatches = castOption === 'hideaway'
          ? (!mode.fromZone || mode.fromZone === 'hand')
          : zone === modeZone;
        if (!zoneMatches) continue;
        if (mode.foretold && !card.foretold) continue;
        const action = { type, cardInstanceId: card.instanceId, mode: mode.id, ...(castOption ? { castOption } : {}), ...extra };
        this._pushTargetedVariants(out, pid, action, mode, card);
      }
      return;
    }
    const action = { type, cardInstanceId: card.instanceId, ...(castOption ? { castOption } : {}), ...extra };
    this._pushTargetedVariants(out, pid, action, d, card);
  }

  get(pid) {
    const e = this.engine, s = e.state, p = s.players[pid], out = [];
    if (!p || s.winner || !s.started) return out;

    if (s.pendingChoice) {
      if (s.pendingChoice.playerId !== pid) return out;
      const choice = s.pendingChoice;
      if (choice.type === 'COMBAT_DAMAGE_ORDER') return [{ type: 'ORDER_BLOCKERS', attackers: structuredClone(choice.attackers), reason: choice.type }];
      if (choice.type === 'LEGEND_RULE') return choice.permanentIds.map(keepInstanceId => ({ type: 'CHOOSE_LEGEND', keepInstanceId, cardName: choice.cardName, reason: choice.type }));
      if (choice.type === 'COMMANDER_ZONE') return [true, false].map(moveToCommand => ({ type: 'CHOOSE_COMMANDER_ZONE', moveToCommand, commanderId: choice.commanderId, fromZone: choice.fromZone, reason: choice.type }));
      if (choice.type === 'WARD_PAYMENT') {
        const actions = [];
        if (e.canPayWard(choice)) actions.push({ type: 'PAY_WARD', cost: structuredClone(choice.cost), targetStackItemId: choice.targetStackItemId, reason: choice.type });
        actions.push({ type: 'DECLINE_WARD', cost: structuredClone(choice.cost), targetStackItemId: choice.targetStackItemId, reason: choice.type });
        return actions;
      }
      if (choice.type === 'OPTIONAL_TRIGGER') return [true, false].map(accept => ({ type: 'CHOOSE_TRIGGER', accept, triggerId: choice.triggerId, sourceName: choice.sourceName, reason: choice.type }));
      if (choice.type === 'OPTIONAL_MANA_PAYMENT') return [{ type: 'CHOOSE_OPTIONAL_MANA_PAYMENT', pay: true, mana: choice.mana, sourceName: choice.sourceName, reason: choice.type }, { type: 'CHOOSE_OPTIONAL_MANA_PAYMENT', pay: false, mana: choice.mana, sourceName: choice.sourceName, reason: choice.type }].filter(action => !action.pay || e.isActionLegal(pid, action));
      if (choice.type === 'TAP_OR_UNTAP') return ['tap','untap','none'].map(result => ({ type: 'CHOOSE_TAP_OR_UNTAP', choice: result, targetId: choice.targetId, sourceName: choice.sourceName, reason: choice.type }));
      if (choice.type === 'OPTIONAL_EFFECT') return [true, false].map(accept => ({ type: 'CHOOSE_OPTIONAL_EFFECT', accept, sourceName: choice.sourceName, prompt: choice.prompt, reason: choice.type }));
      if (choice.type === 'TRIGGER_ORDER') return [{ type: 'ORDER_TRIGGERS', triggerIds: [...choice.triggerIds], triggers: structuredClone(choice.triggers || []), reason: choice.type }];
      if (choice.type === 'PROLIFERATE') return [{ type: 'CHOOSE_PROLIFERATE', eligibleIds: [...choice.eligibleIds], reason: choice.type }];
      if (choice.type === 'PHASE_OUT_PROLIFERATED') return [{ type: 'CHOOSE_PHASE_OUT_PROLIFERATED', eligibleIds: [...choice.eligibleIds], reason: choice.type }];
      if (choice.type === 'REPLACEMENT_ORDER') return [{ type: 'ORDER_REPLACEMENTS', replacementIds: [...choice.replacementIds], replacements: structuredClone(choice.replacements || []), reason: choice.type }];
      if (choice.type === 'EXPLORE_NONLAND') return [false, true].map(putInGraveyard => ({ type: 'CHOOSE_EXPLORE', putInGraveyard, cardInstanceId: choice.cardInstanceId, cardName: choice.cardName, reason: choice.type }));
      if (choice.type === 'EXPLORE_ORDER') return [{ type: 'ORDER_EXPLORES', permanentIds: [...choice.permanentIds], reason: choice.type }];
      if (choice.type === 'HAKBAL_ATTACK') return [...choice.landInstanceIds.map(landInstanceId => ({ type: 'CHOOSE_HAKBAL_ATTACK', landInstanceId, reason: choice.type })), { type: 'CHOOSE_HAKBAL_ATTACK', landInstanceId: null, reason: choice.type }];
      if (choice.type === 'CULTIVATE_SEARCH') return [{ type: 'CHOOSE_CULTIVATE', eligibleIds: [...choice.eligibleIds], max: 2, reason: choice.type }];
      if (choice.type === 'SISAY_TUTOR') return [...choice.eligibleIds.map(cardInstanceId => ({ type: 'CHOOSE_SISAY_TUTOR', cardInstanceId, reason: choice.type })), { type: 'CHOOSE_SISAY_TUTOR', cardInstanceId: null, reason: choice.type }];
      if (choice.type === 'SCRY') return [false, true].map(putOnBottom => ({ type: 'CHOOSE_SCRY', putOnBottom, cardInstanceId: choice.cardInstanceId, reason: choice.type }));
      if (choice.type === 'TRIGGER_TARGET') return [{ type: 'CHOOSE_TRIGGER_TARGET', triggerId: choice.triggerId, candidateIds: [...choice.candidateIds], minTargets: choice.minTargets, maxTargets: choice.maxTargets, reason: choice.type }];
      if (choice.type === 'CREATURE_TYPE') return choice.options.map(creatureType => ({ type: 'CHOOSE_CREATURE_TYPE', creatureType, reason: choice.type }));
      if (choice.type === 'EFFECT_CARD_CHOICE') return [{ type: 'CHOOSE_EFFECT_CARDS', candidateIds: [...choice.candidateIds], min: choice.min, max: choice.max, reason: choice.type }];
      if (choice.type === 'COPY_TARGETS') return [{ type: 'CHOOSE_COPY_TARGETS', targetIds: [...choice.originalTargets], reason: choice.type }];
      if (choice.type === 'ENTRY_REVEAL') return [
        ...choice.candidateIds.map(cardInstanceId => ({ type: 'CHOOSE_ENTRY_REVEAL', cardInstanceId, reason: choice.type })),
        { type: 'CHOOSE_ENTRY_REVEAL', cardInstanceId: null, reason: choice.type }
      ];
      if (choice.type === 'HIDEAWAY') return choice.candidateIds.map(cardInstanceId => ({ type: 'CHOOSE_HIDEAWAY', cardInstanceId, reason: choice.type }));
      if (choice.type === 'HIDEAWAY_PLAY') {
        const actions = [{ type: 'DECLINE_HIDEAWAY_PLAY', cardInstanceId: choice.cardInstanceId, reason: choice.type }];
        const found = choice.cardInstanceId ? e.state.players[pid].exile.find(card => card.instanceId === choice.cardInstanceId) : null;
        const definition = found ? e.db[found.cardId] : null;
        if (!found || found.exiledBy !== choice.sourceId) return actions;
        if (isType(definition, 'Land')) {
          const play = { type: 'PLAY_HIDEAWAY_LAND', cardInstanceId: found.instanceId, sourceId: choice.sourceId, reason: choice.type };
          if (e.isActionLegal(pid, play)) actions.unshift(play);
          return actions;
        }
        const spellActions = [];
        this._pushCardCastActions(spellActions, pid, found, 'exile', 'hideaway');
        return [...spellActions, ...actions];
      }
      return [{ type: choice.type === 'MULLIGAN_BOTTOM' ? 'BOTTOM_CARDS' : 'DISCARD_CARDS', count: choice.count, reason: choice.type }];
    }

    if (s.pregame.active) {
      if (s.pregame.currentPlayer !== pid) return out;
      return [{ type: 'MULLIGAN' }, { type: 'KEEP_HAND' }];
    }

    if (s.turnActionPending === 'DECLARE_ATTACKERS') return pid === s.activePlayer ? [{ type: 'DECLARE_ATTACKERS' }] : [];
    if (s.turnActionPending === 'DECLARE_BLOCKERS') return pid !== s.activePlayer ? [{ type: 'DECLARE_BLOCKERS' }] : [];
    if (s.priorityPlayer !== pid) return out;

    for (const c of p.hand) {
      const d = e.db[c.cardId];
      if (isType(d, 'Land')) {
        const action = { type: 'PLAY_LAND', cardInstanceId: c.instanceId };
        if (e.isActionLegal(pid, action)) out.push(action);
      } else {
        this._pushCardCastActions(out, pid, c, 'hand');
        if (d?.foretellCost) {
          const action = { type: 'FORETELL_CARD', cardInstanceId: c.instanceId };
          if (e.isActionLegal(pid, action)) out.push(action);
        }
      }
    }

    for (const c of p.command) if (c.isCommander) this._pushCardCastActions(out, pid, c, 'command');
    for (const c of p.graveyard) {
      const d = e.db[c.cardId];
      if (d?.encoreCost) {
        const encore = { type: 'ENCORE_CARD', cardInstanceId: c.instanceId };
        if (e.isActionLegal(pid, encore)) out.push(encore);
      }
      if (Array.isArray(d?.modes) && d.modes.some(mode => mode.fromZone === 'graveyard')) this._pushCardCastActions(out, pid, c, 'graveyard');
      if (e.static.hasRetrace(pid, c)) {
        for (const land of p.hand.filter(card => isType(e.db[card.cardId], 'Land'))) {
          this._pushCardCastActions(out, pid, c, 'graveyard', 'retrace', { retraceLandInstanceId: land.instanceId });
        }
      }
    }
    for (const c of p.exile) if (c.foretold) this._pushCardCastActions(out, pid, c, 'exile', 'foretold');
    const top = p.library[0];
    if (top && e.canCastTopCard(pid, top)) this._pushCardCastActions(out, pid, top, 'library', 'top');

    for (const perm of p.battlefield) {
      const d = e.db[perm.cardId];
      for (const ability of e.static.effectiveAbilities(perm)) {
        if (ability.type === 'mana' && !ability.autoOnly) {
          if (ability.anyColor) {
            for (const manaColor of e.mana.anyColorChoices(p, ability)) {
              const action = { type: 'ACTIVATE_MANA', permanentId: perm.instanceId, ability, manaColor };
              if (e.isActionLegal(pid, action)) out.push(action);
            }
          } else {
            const action = { type: 'ACTIVATE_MANA', permanentId: perm.instanceId, ability };
            if (e.isActionLegal(pid, action)) out.push(action);
          }
        }
        if (ability.type === 'activated') {
          const selections = ability.selection
            ? combinations(e._selectionCandidates(pid, perm, ability.selection).map(card => card.instanceId), Number(ability.selection.count || 0))
            : [[]];
          for (const selected of selections) this._pushTargetedVariants(out, pid, { type: 'ACTIVATE_ABILITY', permanentId: perm.instanceId, ability, selections: selected }, ability, perm);
        }
      }
    }

    out.push({ type: 'PASS_PRIORITY' });
    return out;
  }
}
