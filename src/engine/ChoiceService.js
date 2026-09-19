import { immutableClone } from '../public/immutable.js';
import { ZoneManager } from '../ZoneManager.js';
import { CHOICE_TYPE, CHOICE_VISIBILITY, createChoiceRequest, createChoiceResponse } from './ChoiceRequest.js';
import { matchesTargetFilter } from './TargetFilter.js';

function option(value, label = null, extra = {}) {
  return { id: value, value, label: label == null ? String(value) : String(label), ...extra };
}

function cardOption(id, label = null) { return { id, value: id, label: label || id, kind: 'card' }; }

function legacyPrompt(choice) {
  return choice.prompt || choice.sourceName || choice.cardName || choice.type || 'Make a choice';
}

export class ChoiceService {
  constructor(engine) {
    this.engine = engine;
    this.sequence = 0;
    this.resolvers = new Map();
  }

  _nextId() {
    this.sequence += 1;
    return `choice-${this.engine.state.turn || 0}-${this.sequence}`;
  }

  ensurePendingId() {
    const pending = this.engine.state.pendingChoice;
    if (!pending) return null;
    if (pending.choiceRequestId) return pending.choiceRequestId;
    if (pending.type === 'ENGINE_CHOICE' && pending.request?.requestId) return pending.request.requestId;
    // Legacy choices predate Step 6 and do not carry ids. Derive a stable id
    // without mutating authoritative state so public query methods remain pure.
    const discriminator = pending.triggerId || pending.cardInstanceId || pending.commanderId || pending.sourceId || pending.targetId || pending.sourceName || '';
    return `legacy-choice:${this.engine.state.turn || 0}:${this.engine.state.phase || 'none'}:${this.engine._actionSequence || 0}:${pending.playerId || 'unknown'}:${pending.type}:${String(discriminator)}`;
  }

  getSnapshot() {
    const pending = this.engine.state.pendingChoice;
    if (!pending) return null;
    return immutableClone(this.normalizeLegacy(pending));
  }

  normalizeLegacy(choice) {
    if (!choice) return null;
    if (choice.type === 'ENGINE_CHOICE' && choice.request) return createChoiceRequest(choice.request);
    const requestId = choice.choiceRequestId || this.ensurePendingId();
    const base = {
      requestId,
      requestingPlayer: choice.playerId,
      contextId: choice.contextId || `${choice.type}:${requestId}`,
      prompt: legacyPrompt(choice),
      visibility: choice.visibility || CHOICE_VISIBILITY.PUBLIC,
      allowCancel: false,
      metadata: { legacyType: choice.type }
    };

    switch (choice.type) {
      case 'COMMANDER_ZONE':
        return createChoiceRequest({ ...base, choiceType: CHOICE_TYPE.BOOLEAN, min: 1, max: 1, legalOptions: [option(true, 'Move to Command Zone'), option(false, 'Leave It There')] });
      case 'WARD_PAYMENT':
        return createChoiceRequest({ ...base, choiceType: CHOICE_TYPE.BOOLEAN, min: 1, max: 1, legalOptions: [
          ...(this.engine.canPayWard(choice) ? [option(true, 'Pay ward')] : []), option(false, 'Do not pay')
        ] });
      case 'OPTIONAL_MANA_PAYMENT':
        return createChoiceRequest({ ...base, choiceType: CHOICE_TYPE.BOOLEAN, min: 1, max: 1, legalOptions: [
          ...(this.engine.mana.canAfford(this.engine.state.players[choice.playerId], this.engine.db, choice.mana || '', 0, this.engine, { kind: 'other' }) ? [option(true, 'Pay')] : []), option(false, 'Do not pay')
        ] });
      case 'OPTIONAL_TRIGGER':
      case 'OPTIONAL_EFFECT':
      case 'ENTRY_LIFE_PAYMENT':
        return createChoiceRequest({ ...base, choiceType: CHOICE_TYPE.BOOLEAN, min: 1, max: 1, legalOptions: [option(true, 'Yes'), option(false, 'No')] });
      case 'TAP_OR_UNTAP':
        return createChoiceRequest({ ...base, choiceType: CHOICE_TYPE.OPTION, min: 1, max: 1, legalOptions: ['tap','untap','none'].map(value => option(value)) });
      case 'CREATURE_TYPE':
        return createChoiceRequest({ ...base, choiceType: CHOICE_TYPE.NAME, min: 1, max: 1, legalOptions: (choice.options || []).map(value => option(value)) });
      case 'LEGEND_RULE':
        return createChoiceRequest({ ...base, choiceType: CHOICE_TYPE.PERMANENTS, min: 1, max: 1, legalOptions: (choice.permanentIds || []).map(cardOption) });
      case 'TRIGGER_ORDER':
        return createChoiceRequest({ ...base, choiceType: CHOICE_TYPE.ORDER, min: choice.triggerIds?.length || 0, max: choice.triggerIds?.length || 0, orderingRequired: true, legalOptions: (choice.triggerIds || []).map(id => option(id)) });
      case 'REPLACEMENT_ORDER':
        return createChoiceRequest({ ...base, choiceType: CHOICE_TYPE.ORDER, min: choice.replacementIds?.length || 0, max: choice.replacementIds?.length || 0, orderingRequired: true, legalOptions: (choice.replacementIds || []).map(id => option(id)) });
      case 'EXPLORE_ORDER':
        return createChoiceRequest({ ...base, choiceType: CHOICE_TYPE.ORDER, min: choice.permanentIds?.length || 0, max: choice.permanentIds?.length || 0, orderingRequired: true, legalOptions: (choice.permanentIds || []).map(cardOption) });
      case 'PROLIFERATE':
      case 'PHASE_OUT_PROLIFERATED':
        return createChoiceRequest({ ...base, choiceType: CHOICE_TYPE.PERMANENTS, min: 0, max: choice.eligibleIds?.length || 0, legalOptions: (choice.eligibleIds || []).map(cardOption) });
      case 'CULTIVATE_SEARCH':
        return createChoiceRequest({ ...base, choiceType: CHOICE_TYPE.CARDS, min: 0, max: Number(choice.max || 2), visibility: CHOICE_VISIBILITY.PRIVATE, legalOptions: (choice.eligibleIds || []).map(cardOption), metadata: { ...base.metadata, purpose: 'search' } });
      case 'SISAY_TUTOR':
        return createChoiceRequest({ ...base, choiceType: CHOICE_TYPE.CARDS, min: 0, max: 1, visibility: CHOICE_VISIBILITY.PRIVATE, legalOptions: (choice.eligibleIds || []).map(cardOption), metadata: { ...base.metadata, purpose: 'search' } });
      case 'TRIGGER_TARGET':
        return createChoiceRequest({ ...base, choiceType: CHOICE_TYPE.TARGETS, targeted: true, min: Number(choice.minTargets || 0), max: Number(choice.maxTargets || 1), legalOptions: (choice.candidateIds || []).map(cardOption), source: choice.targetSource || null, sourceObjectId: choice.sourceObjectId || null });
      case 'COPY_TARGETS':
        return createChoiceRequest({ ...base, choiceType: CHOICE_TYPE.TARGETS, targeted: true, min: choice.originalTargets?.length || 0, max: choice.originalTargets?.length || 0, source: choice.targetSource || null, sourceObjectId: choice.copyItem?.card?.instanceId || choice.copyItem?.source?.instanceId || null, metadata: { ...base.metadata, originalTargets: structuredClone(choice.originalTargets || []) } });
      case 'COPY_PERMANENT':
        return createChoiceRequest({ ...base, choiceType: CHOICE_TYPE.PERMANENTS, min: choice.optional ? 0 : 1, max: 1, legalOptions: (choice.candidateIds || []).map(cardOption), allowCancel: !!choice.optional, metadata: { ...base.metadata, sourceId: choice.sourceId, modifications: structuredClone(choice.modifications || null) } });
      case 'ATTACHMENT_ENTRY': {
        const hasPlayer = (choice.candidateIds || []).some(id => !!this.engine.state.players[id]);
        return createChoiceRequest({ ...base, choiceType: hasPlayer ? CHOICE_TYPE.ACTION : CHOICE_TYPE.PERMANENTS, min: 1, max: 1, legalOptions: (choice.candidateIds || []).map(id => option(id, id, { kind: this.engine.state.players[id] ? 'player' : 'permanent' })), metadata: { ...base.metadata, sourceId: choice.sourceId, purpose: 'attachment-entry' } });
      }
      case 'EFFECT_CARD_CHOICE':
        return createChoiceRequest({ ...base, choiceType: CHOICE_TYPE.CARDS, min: Number(choice.min || 0), max: Number(choice.max || 1), visibility: choice.visibility || CHOICE_VISIBILITY.PRIVATE, legalOptions: (choice.candidateIds || []).map(cardOption) });
      case 'MULLIGAN_BOTTOM':
      case 'CLEANUP_DISCARD':
        return createChoiceRequest({ ...base, choiceType: CHOICE_TYPE.CARDS, min: Number(choice.count || 0), max: Number(choice.count || 0), visibility: CHOICE_VISIBILITY.PRIVATE, legalOptions: this.engine.state.players[choice.playerId]?.hand?.map(card => cardOption(card.instanceId)) || [] });
      case 'COMBAT_DAMAGE_ORDER': {
        const ids = Object.values(choice.attackers || {}).flat();
        return createChoiceRequest({ ...base, choiceType: CHOICE_TYPE.ORDER, min: ids.length, max: ids.length, orderingRequired: true, legalOptions: ids.map(cardOption), metadata: { ...base.metadata, groupedByAttacker: structuredClone(choice.attackers || {}) } });
      }
      case 'SCRY':
      case 'EXPLORE_NONLAND':
        return createChoiceRequest({ ...base, choiceType: CHOICE_TYPE.OPTION, min: 1, max: 1, legalOptions: [option(false, 'Keep'), option(true, 'Move')] });
      case 'HAKBAL_ATTACK':
        return createChoiceRequest({ ...base, choiceType: CHOICE_TYPE.CARDS, min: 0, max: 1, legalOptions: (choice.landInstanceIds || []).map(cardOption), allowCancel: true });
      case 'ENTRY_REVEAL':
        return createChoiceRequest({ ...base, choiceType: CHOICE_TYPE.CARDS, min: 0, max: 1, visibility: CHOICE_VISIBILITY.PRIVATE, legalOptions: (choice.candidateIds || []).map(cardOption), allowCancel: true });
      case 'HIDEAWAY':
        return createChoiceRequest({ ...base, choiceType: CHOICE_TYPE.CARDS, min: choice.candidateIds?.length ? 1 : 0, max: choice.candidateIds?.length ? 1 : 0, visibility: CHOICE_VISIBILITY.PRIVATE, legalOptions: (choice.candidateIds || []).map(cardOption) });
      case 'HIDEAWAY_PLAY':
        return createChoiceRequest({ ...base, choiceType: CHOICE_TYPE.ACTION, min: 1, max: 1, legalOptions: this.engine.getLegalActions(choice.playerId).map(action => ({ id: JSON.stringify(action), value: action, label: action.type })) });
      default:
        return createChoiceRequest({ ...base, choiceType: CHOICE_TYPE.ACTION, min: 1, max: 1, legalOptions: this.engine.legal.get(choice.playerId).map(action => ({ id: JSON.stringify(action), value: action, label: action.type })) });
    }
  }

  open(request, resolver = null) {
    if (this.engine.state.pendingChoice) throw new Error('Cannot open a ChoiceRequest while another choice is pending');
    let normalized = createChoiceRequest({ ...request, requestId: request.requestId || this._nextId() });
    if (normalized.targeted && !normalized.legalOptions.length && normalized.source) {
      const sourceObject = normalized.sourceObjectId ? this.engine._queryObject(normalized.sourceObjectId) : null;
      const candidates = this.engine.targeting.getCandidates(normalized.requestingPlayer, normalized.source, [], { sourceObject });
      normalized = createChoiceRequest({ ...normalized, legalOptions: candidates.map(candidate => option(candidate.id, candidate.id, { kind: candidate.kind, zone: candidate.zone || null })) });
    }
    this.engine.state.pendingChoice = {
      type: 'ENGINE_CHOICE',
      playerId: normalized.requestingPlayer,
      choiceRequestId: normalized.requestId,
      request: structuredClone(normalized)
    };
    if (resolver) this.resolvers.set(normalized.requestId, resolver);
    this.engine.state.priorityPlayer = normalized.requestingPlayer;
    return immutableClone(normalized);
  }

  buildCandidate(candidateId) {
    if (this.engine.state.players[candidateId]) {
      return { id: candidateId, kind: 'player', zone: null, controller: candidateId, owner: candidateId, player: this.engine.state.players[candidateId], definition: null, card: null };
    }
    const found = ZoneManager.find(this.engine.state, candidateId);
    if (!found) return null;
    const card = found.card;
    return {
      id: candidateId,
      kind: found.zone === 'battlefield' ? 'permanent' : (found.zone === 'stack' ? 'spell' : 'card'),
      zone: found.zone,
      controller: card.controller,
      owner: card.owner,
      card,
      definition: this.engine.db[card.cardId] || {}
    };
  }

  validateResponse(pid, responseInput, request = this.getSnapshot()) {
    if (!request) throw new Error('No ChoiceRequest is pending');
    if (request.requestingPlayer !== pid) throw new Error('This ChoiceRequest belongs to another player');
    const response = createChoiceResponse(responseInput);
    if (response.requestId !== request.requestId) throw new Error('ChoiceResponse does not match the pending ChoiceRequest');
    if (response.cancelled) {
      if (!request.allowCancel) throw new Error('This choice cannot be cancelled');
      return response;
    }

    const selected = request.orderingRequired && response.orderedSelections ? response.orderedSelections : response.selections;
    if (selected.length < request.min || selected.length > request.max) throw new Error(`Choose between ${request.min} and ${request.max} option(s)`);
    if (new Set(selected.map(value => JSON.stringify(value))).size !== selected.length) throw new Error('A choice cannot select the same option more than once');

    const optionValues = new Map((request.legalOptions || []).flatMap(item => {
      const value = item && typeof item === 'object' && 'value' in item ? item.value : item;
      const id = item && typeof item === 'object' && 'id' in item ? item.id : value;
      return [[JSON.stringify(value), true], [JSON.stringify(id), true]];
    }));
    if (request.legalOptions?.length && selected.some(value => !optionValues.has(JSON.stringify(value)))) throw new Error('ChoiceResponse contains an option that is no longer legal');

    if (request.choiceType === CHOICE_TYPE.TARGETS) {
      const sourceObject = request.sourceObjectId ? this.engine._queryObject(request.sourceObjectId) : null;
      this.engine.targeting.validateTargets(pid, request.source || {}, selected, { sourceObject });
    } else if (request.filter) {
      for (const id of selected) {
        const candidate = this.buildCandidate(id);
        if (!candidate || !matchesTargetFilter(this.engine, pid, candidate, request.filter, { sourceObject: request.sourceObjectId ? this.engine._queryObject(request.sourceObjectId) : null })) {
          throw new Error('ChoiceResponse contains an option that no longer satisfies the choice filter');
        }
      }
    }

    if ([CHOICE_TYPE.CARDS, CHOICE_TYPE.PERMANENTS].includes(request.choiceType)) {
      for (const id of selected) {
        if (this.engine.state.players[id]) {
          if (request.choiceType === CHOICE_TYPE.PERMANENTS) throw new Error('A permanent choice cannot select a player');
          continue;
        }
        const found = ZoneManager.find(this.engine.state, id);
        if (!found) throw new Error('A selected game object no longer exists');
        if (request.choiceType === CHOICE_TYPE.PERMANENTS && found.zone !== 'battlefield') throw new Error('A selected permanent is no longer on the battlefield');
      }
    }

    if (request.choiceType === CHOICE_TYPE.DIVIDE) {
      const division = response.division || {};
      const total = Object.values(division).reduce((sum, value) => sum + Number(value || 0), 0);
      const requiredTotal = Number(request.metadata?.total || 0);
      if (requiredTotal && total !== requiredTotal) throw new Error(`Divided quantities must total ${requiredTotal}`);
      if (Object.values(division).some(value => !Number.isInteger(Number(value)) || Number(value) < 0)) throw new Error('Divided quantities must be nonnegative integers');
    }
    return response;
  }

  toLegacyAction(choice, responseInput) {
    const request = this.normalizeLegacy(choice);
    const response = this.validateResponse(choice.playerId, responseInput, request);
    const selected = request.orderingRequired && response.orderedSelections ? response.orderedSelections : response.selections;
    const first = selected[0];
    switch (choice.type) {
      case 'COMMANDER_ZONE': return { type: 'CHOOSE_COMMANDER_ZONE', moveToCommand: !!first };
      case 'WARD_PAYMENT': return { type: first ? 'PAY_WARD' : 'DECLINE_WARD' };
      case 'OPTIONAL_TRIGGER': return { type: 'CHOOSE_TRIGGER', accept: !!first, triggerId: choice.triggerId };
      case 'OPTIONAL_MANA_PAYMENT': return { type: 'CHOOSE_OPTIONAL_MANA_PAYMENT', pay: !!first };
      case 'OPTIONAL_EFFECT': return { type: 'CHOOSE_OPTIONAL_EFFECT', accept: !!first };
      case 'ENTRY_LIFE_PAYMENT': return { type: 'CHOOSE_ENTRY_LIFE_PAYMENT', pay: !!first };
      case 'TAP_OR_UNTAP': return { type: 'CHOOSE_TAP_OR_UNTAP', choice: first };
      case 'CREATURE_TYPE': return { type: 'CHOOSE_CREATURE_TYPE', creatureType: first };
      case 'LEGEND_RULE': return { type: 'CHOOSE_LEGEND', keepInstanceId: first };
      case 'COMBAT_DAMAGE_ORDER': {
        const groups = choice.attackers || {};
        const orders = response.metadata?.orders || {};
        if (!Object.keys(orders).length && Object.keys(groups).length === 1) orders[Object.keys(groups)[0]] = selected;
        return { type: 'ORDER_BLOCKERS', orders };
      }
      case 'TRIGGER_ORDER': return { type: 'ORDER_TRIGGERS', triggerIds: selected };
      case 'REPLACEMENT_ORDER': return { type: 'ORDER_REPLACEMENTS', replacementIds: selected };
      case 'EXPLORE_ORDER': return { type: 'ORDER_EXPLORES', permanentIds: selected };
      case 'PROLIFERATE': return { type: 'CHOOSE_PROLIFERATE', targetIds: selected };
      case 'PHASE_OUT_PROLIFERATED': return { type: 'CHOOSE_PHASE_OUT_PROLIFERATED', permanentIds: selected };
      case 'CULTIVATE_SEARCH': return { type: 'CHOOSE_CULTIVATE', cardInstanceIds: selected };
      case 'SISAY_TUTOR': return { type: 'CHOOSE_SISAY_TUTOR', cardInstanceId: first ?? null };
      case 'TRIGGER_TARGET': return { type: 'CHOOSE_TRIGGER_TARGET', targetIds: selected };
      case 'COPY_TARGETS': return { type: 'CHOOSE_COPY_TARGETS', targetIds: selected };
      case 'COPY_PERMANENT': return { type: 'CHOOSE_PERMANENT_COPY', permanentId: first ?? null };
      case 'ATTACHMENT_ENTRY': return { type: 'CHOOSE_ATTACHMENT_HOST', hostId: first };
      case 'EFFECT_CARD_CHOICE': return { type: 'CHOOSE_EFFECT_CARDS', cardInstanceIds: selected };
      case 'MULLIGAN_BOTTOM': return { type: 'BOTTOM_CARDS', cardInstanceIds: selected };
      case 'CLEANUP_DISCARD': return { type: 'DISCARD_CARDS', cardInstanceIds: selected };
      case 'SCRY': return { type: 'CHOOSE_SCRY', putOnBottom: !!first };
      case 'EXPLORE_NONLAND': return { type: 'CHOOSE_EXPLORE', putInGraveyard: !!first };
      case 'HAKBAL_ATTACK': return { type: 'CHOOSE_HAKBAL_ATTACK', landInstanceId: first ?? null };
      case 'ENTRY_REVEAL': return { type: 'CHOOSE_ENTRY_REVEAL', cardInstanceId: first ?? null };
      case 'HIDEAWAY': return { type: 'CHOOSE_HIDEAWAY', cardInstanceId: first ?? null };
      case 'HIDEAWAY_PLAY': return first && typeof first === 'object' ? first : { type: 'DECLINE_HIDEAWAY_PLAY' };
      case 'ENGINE_CHOICE': return { type: 'SUBMIT_CHOICE', response };
      default:
        if (first && typeof first === 'object' && first.type) return first;
        throw new Error(`No ChoiceResponse adapter exists for ${choice.type}`);
    }
  }

  resolveEngineChoice(pid, responseInput) {
    const choice = this.engine.state.pendingChoice;
    if (!choice || choice.type !== 'ENGINE_CHOICE') throw new Error('No engine-native choice is pending');
    const request = createChoiceRequest(choice.request);
    const response = this.validateResponse(pid, responseInput, request);
    const resolver = this.resolvers.get(request.requestId);
    this.engine.state.pendingChoice = null;
    this.resolvers.delete(request.requestId);
    return resolver ? resolver(response, request) : response;
  }

  legalGenericActions(pid) {
    const request = this.getSnapshot();
    if (!request || request.requestingPlayer !== pid) return [];
    if (request.choiceType === CHOICE_TYPE.BOOLEAN || [CHOICE_TYPE.OPTION, CHOICE_TYPE.MODE, CHOICE_TYPE.COLOR, CHOICE_TYPE.NAME, CHOICE_TYPE.ACTION].includes(request.choiceType)) {
      return request.legalOptions.map(item => ({
        type: 'SUBMIT_CHOICE',
        response: { requestId: request.requestId, selections: [item && typeof item === 'object' && 'value' in item ? item.value : item] },
        reason: request.contextId
      }));
    }
    return [{ type: 'SUBMIT_CHOICE', response: { requestId: request.requestId, selections: [] }, choiceRequest: request, reason: request.contextId }];
  }
}
