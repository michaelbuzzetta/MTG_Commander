import { EVENT } from '../constants.js';
import { isType } from './utils.js';

/**
 * Step 5 resolution transaction. Target legality is rechecked at resolution,
 * legal targets continue through partial resolution, and a spell/ability whose
 * every target is illegal is countered by the rules without UI intervention.
 */
export class ResolutionPipeline {
  constructor(engine) { this.engine = engine; }

  _checkpoint() {
    const e = this.engine;
    // History/event logs are append-only during resolution. Cloning every prior
    // entry for every stack object makes long Commander games quadratic in
    // replay size. Keep their pre-resolution arrays + lengths, and clone only
    // the mutable canonical game state needed for transactional rollback.
    const history = e.state.history || [];
    const stateWithoutHistory = { ...e.state, history: [] };
    return {
      state: structuredClone(stateWithoutHistory),
      history,
      historyLength: history.length,
      eventLog: e.events.eventLog,
      eventLogLength: e.events.eventLog.length,
      rejectedEvents: structuredClone(e.events.rejectedEvents),
      eventStack: structuredClone(e.events.eventStack),
      eventSequence: e.events.sequenceCursor
    };
  }

  _rollback(checkpoint) {
    const e = this.engine;
    e.state = checkpoint.state;
    e.state.history = checkpoint.history.slice(0, checkpoint.historyLength);
    e.events.eventLog = checkpoint.eventLog.slice(0, checkpoint.eventLogLength);
    e.events.rejectedEvents = checkpoint.rejectedEvents;
    e.events.eventStack = checkpoint.eventStack;
    e.events.sequenceCursor = checkpoint.eventSequence;
  }

  resolveTop() {
    const e = this.engine;
    const checkpoint = this._checkpoint();
    try {
      return e._withDeferredTriggers(() => this._resolveTopNow());
    } catch (error) {
      this._rollback(checkpoint);
      if (error?.code === 'UNSUPPORTED_INTERACTION') e.unsupported?.annotateRollback(error, 'resolution-checkpoint-restored');
      throw error;
    }
  }

  _resolveTopNow() {
    const e = this.engine;
    const item = e.stack.pop();
    if (!item) return null;


    if (item.type === 'ward') {
      const targetStillExists = e.state.stack.some(stackItem => stackItem.id === item.targetStackItemId);
      if (targetStillExists) {
        e.state.pendingChoice = {
          type: 'WARD_PAYMENT',
          playerId: item.payingPlayer,
          wardItemId: item.id,
          targetStackItemId: item.targetStackItemId,
          protectedPermanentId: item.protectedPermanentId,
          sourceName: e.db[item.source?.cardId]?.name || 'permanent',
          cost: { ...item.cost }
        };
        e.state.priorityPlayer = item.payingPlayer;
        e.log('WARD_PAYMENT_REQUIRED', {
          controller: item.controller,
          payingPlayer: item.payingPlayer,
          protectedPermanentId: item.protectedPermanentId,
          targetStackItemId: item.targetStackItemId,
          cost: { ...item.cost }
        });
      }
      return item;
    }

    const spellDefinition = item.type === 'spell' ? (e.copy?.definitionForObject(item.card) || e.db[item.card.cardId]) : null;
    const targetSource = item.type === 'spell'
      ? e.targetSourceForAction({ mode: item.mode }, spellDefinition)
      : (item.ability || item.targetSource);
    const sourceObject = item.type === 'spell' ? item.card : item.source;
    let resolutionTargets = item.targets || [];
    const targetedResolution = !!(targetSource && e.targeting.hasTargets(targetSource));

    if (targetedResolution) {
      const checked = e.targeting.recheckTargets(item.controller, targetSource, resolutionTargets, { sourceObject });
      if (checked.allIllegal) {
        if (item.type === 'spell' && !item.isCopy) e._moveZoneNow(item.card, 'graveyard', item.card.owner);
        e.log('COUNTERED_ON_RESOLUTION', {
          stackItemId: item.id,
          controller: item.controller,
          illegalTargets: checked.illegalTargets,
          reason: 'all targets illegal'
        });
        e.stateBasedActions();
        return item;
      }
      resolutionTargets = checked.resolutionTargets;
      if (checked.illegalTargets.length) {
        e.log('PARTIAL_TARGET_RESOLUTION', {
          stackItemId: item.id,
          legalTargets: checked.legalTargets,
          illegalTargets: checked.illegalTargets
        });
      }
    }

    if (item.type === 'trigger' || item.type === 'ability') {
      if (item.type === 'trigger' && item.interveningIf && !e.triggers.interveningIfHolds(item)) {
        e.log('TRIGGER_INTERVENING_IF_FAILED', {
          stackItemId: item.id,
          triggerDefinitionId: item.triggerDefinitionId || null,
          sourceInstanceId: item.sourceInstanceId || item.source?.instanceId || null
        });
        e.stateBasedActions();
        return item;
      }
      e.effects.resolve(item.effect, {
        controller: item.controller,
        source: item.source,
        sourcePowerAtActivation: item.sourcePowerAtActivation,
        eventPayload: item.eventPayload,
        targets: resolutionTargets,
        selections: item.selections || [],
        targeted: targetedResolution,
        stackObjectId: item.id,
        abilityId: item.scriptAbilityId || item.ability?.scriptAbilityId || item.triggerDefinitionId || null
      });
      e.stateBasedActions();
      return item;
    }

    const card = item.card;
    const d = e.copy?.definitionForObject(card) || e.db[card.cardId];
    const selectedMode = item.mode ? e._modeFor(d, item.mode) : null;
    const spellEffects = selectedMode ? (selectedMode.effects || []) : (d.spellEffects || []);
    for (const eff of spellEffects) {
      e.effects.resolve(eff, {
        controller: item.controller,
        source: card,
        targets: resolutionTargets,
        targeted: targetedResolution,
        mode: item.mode,
        castOption: item.castOption,
        xValue: item.xValue ?? selectedMode?.xValue ?? null,
        stackObjectId: item.id,
        abilityId: eff?.scriptAbilityId || item.scriptAbilityId || null
      });
      if (e.state.pendingChoice) break;
    }

    if (e.state.pendingChoice) {
      e.state.pendingResolution = { kind: 'finishSpell', item: structuredClone(item), resolutionTargets: [...resolutionTargets] };
      return item;
    }

    if (item.isCopy && (isType(d, 'Instant') || isType(d, 'Sorcery'))) {
      e.emit(EVENT.SPELL_RESOLVED, { controller: item.controller, card, targets: resolutionTargets.filter(Boolean), copy: true });
      e.stateBasedActions();
      return item;
    }

    if (isType(d, 'Instant') || isType(d, 'Sorcery')) {
      // Ascend on an instant or sorcery is evaluated during that spell's resolution.
      if ((d.ascend || (d.keywords || []).some(keyword => String(keyword).toLowerCase() === 'ascend'))
          && !e.state.players[item.controller]?.citysBlessing
          && (e.state.players[item.controller]?.battlefield || []).length >= 10) {
        e.state.players[item.controller].citysBlessing = true;
        e.log('CITYS_BLESSING_GAINED', { playerId: item.controller, reason: 'ascend-spell' });
      }
      const hasRebound = !!d.rebound || (d.keywords || []).some(keyword => String(keyword).toLowerCase() === 'rebound');
      if (hasRebound && item.castFromZone === 'hand' && item.castOption !== 'rebound') {
        e._moveZoneNow(card, 'exile', card.owner);
        e.state.reboundPending ||= [];
        e.state.reboundPending.push({
          playerId: item.controller,
          cardInstanceId: card.instanceId,
          cardId: card.cardId,
          createdTurn: e.state.turn
        });
        e.log('REBOUND_EXILED', { playerId: item.controller, cardInstanceId: card.instanceId, cardId: card.cardId });
      } else {
        const afterZone = selectedMode?.afterResolutionZone || d.afterResolutionZone || 'graveyard';
        e._moveZoneNow(card, afterZone, card.owner);
      }
    } else {
      if (item.isCopy) {
        card.isToken = true;
        card.owner = item.controller;
      }
      if (d.copyAsEnters && !card.copyAsEntersResolved) {
        e.state.pendingResolution = { kind: 'permanent', item: structuredClone(item), resolutionTargets: [...resolutionTargets] };
        const spec = typeof d.copyAsEnters === 'object' ? d.copyAsEnters : {};
        e.copy.requestPermanentCopyChoice(card, {
          playerId: item.controller,
          filter: spec.filter || null,
          optional: spec.optional !== false,
          except: spec.except || spec.modifications || null,
          duration: spec.duration || 'indefinite',
          effectSourceInstanceId: spec.effectSourceInstanceId || null,
          prompt: spec.prompt || `Choose a permanent for ${d.name || 'this permanent'} to copy`,
          resume: e.state.phase === 'CLEANUP' ? 'CLEANUP' : 'PRIORITY'
        });
        return item;
      }
      if (d.asEntersChooseColor && !card.chosenColor) {
        e.state.pendingResolution = { kind: 'permanent', item: structuredClone(item), resolutionTargets: [...resolutionTargets] };
        e.state.pendingChoice = {
          type: 'COLOR', playerId: item.controller, cardInstanceId: card.instanceId, cardName: d.name,
          options: ['W','U','B','R','G'], resume: e.state.phase === 'CLEANUP' ? 'CLEANUP' : 'PRIORITY'
        };
        e.state.priorityPlayer = item.controller;
        return item;
      }
      if (d.asEntersChooseType && !card.chosenType) {
        e.state.pendingResolution = { kind: 'permanent', item: structuredClone(item), resolutionTargets: [...resolutionTargets] };
        const options = e.creatureTypeOptions(item.controller);
        e.state.pendingChoice = {
          type: 'CREATURE_TYPE',
          playerId: item.controller,
          cardInstanceId: card.instanceId,
          cardName: d.name,
          options,
          resume: e.state.phase === 'CLEANUP' ? 'CLEANUP' : 'PRIORITY'
        };
        e.state.priorityPlayer = item.controller;
        return item;
      }
      e._finishPermanentResolution(item, resolutionTargets);
    }

    e.emit(EVENT.SPELL_RESOLVED, { controller: item.controller, card, targets: resolutionTargets.filter(Boolean) });
    e.stateBasedActions();
    return item;
  }
}
