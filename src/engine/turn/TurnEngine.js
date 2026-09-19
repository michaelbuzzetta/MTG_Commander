import { EVENT, PHASES } from '../constants.js';
import { buildBaseTurnSequence, combatSequence, makeTurnNode, reindexSequence, TURN_PHASE_GROUP } from './TurnStructure.js';
import { TurnBasedActions } from './TurnBasedActions.js';

function keyedPlayerMap(state, initial) {
  return Object.fromEntries((state.playerOrder || Object.keys(state.players || {})).map(id => [id, typeof initial === 'function' ? initial(id) : structuredClone(initial)]));
}

/**
 * Step 4 authoritative turn/phase/step state machine.
 *
 * GameEngine still owns the public action API. This class owns turn order,
 * sequence construction, automatic turn-based actions, skipped/extra turn
 * modifiers and phase/step transitions.
 */
export class TurnEngine {
  #internalToken;

  constructor(engine, internalToken) {
    this.engine = engine;
    this.#internalToken = internalToken;
    this.turnBasedActions = new TurnBasedActions(engine, internalToken);
    this.ensureState();
  }

  #assertInternal(token) {
    if (token !== this.#internalToken) throw new Error('Turn transitions are internal rules operations');
  }

  ensureState() {
    const s = this.engine.state;
    if (!Array.isArray(s.turnSequence) || !s.turnSequence.length) s.turnSequence = buildBaseTurnSequence();
    s.turnStepId ??= null;
    s.turnPhaseGroup ??= null;
    s.cleanupIteration = Number(s.cleanupIteration || 0);
    s.turnHistory ||= [];
    s.skippedTurnHistory ||= [];
    s.extraTurnQueue ||= [];
    s.turnKind ||= 'normal';
    s.normalTurnPlayer ||= s.activePlayer || s.playerOrder?.[0] || 'player';
    s.turnModifiers ||= {};
    s.turnModifiers.skippedTurns ||= keyedPlayerMap(s, 0);
    s.turnModifiers.extraUpkeeps ||= keyedPlayerMap(s, 0);
    s.turnModifiers.skippedDrawSteps ||= keyedPlayerMap(s, 0);
    s.turnModifiers.skippedCombatPhases ||= keyedPlayerMap(s, 0);
    s.turnModifiers.skipSteps ||= keyedPlayerMap(s, () => ({}));
    s.turnModifiers.skipPhaseGroups ||= keyedPlayerMap(s, () => ({}));
    for (const id of s.playerOrder || []) {
      if (!(id in s.turnModifiers.skippedTurns)) s.turnModifiers.skippedTurns[id] = 0;
      if (!(id in s.turnModifiers.extraUpkeeps)) s.turnModifiers.extraUpkeeps[id] = 0;
      if (!(id in s.turnModifiers.skippedDrawSteps)) s.turnModifiers.skippedDrawSteps[id] = 0;
      if (!(id in s.turnModifiers.skippedCombatPhases)) s.turnModifiers.skippedCombatPhases[id] = 0;
      s.turnModifiers.skipSteps[id] ||= {};
      s.turnModifiers.skipPhaseGroups[id] ||= {};
    }
    return s;
  }

  _consumeCount(container, key, amount = 1) {
    const current = Math.max(0, Number(container?.[key] || 0));
    const used = Math.min(current, Math.max(0, Number(amount) || 0));
    if (container) container[key] = current - used;
    return used;
  }

  _buildSequenceFor(playerId) {
    const s = this.ensureState();
    const modifiers = s.turnModifiers;
    let sequence = buildBaseTurnSequence();

    const extraUpkeeps = this._consumeCount(modifiers.extraUpkeeps, playerId, Number(modifiers.extraUpkeeps[playerId] || 0));
    if (extraUpkeeps > 0) {
      const upkeepIndex = sequence.findIndex(node => node.key === 'UPKEEP');
      const extras = Array.from({ length: extraUpkeeps }, (_, index) => makeTurnNode('UPKEEP', { origin: 'extra-upkeep', serial: index + 1 }));
      sequence.splice(upkeepIndex + 1, 0, ...extras);
    }

    if (this._consumeCount(modifiers.skippedDrawSteps, playerId, 1) > 0) {
      const index = sequence.findIndex(node => node.key === 'DRAW');
      if (index >= 0) sequence.splice(index, 1);
    }

    if (this._consumeCount(modifiers.skippedCombatPhases, playerId, 1) > 0) {
      sequence = sequence.filter(node => node.phaseGroup !== TURN_PHASE_GROUP.COMBAT);
    }

    const skipSteps = modifiers.skipSteps[playerId] || {};
    for (const [key, rawCount] of Object.entries({ ...skipSteps })) {
      let count = Math.max(0, Number(rawCount || 0));
      while (count > 0) {
        const index = sequence.findIndex(node => node.key === key);
        if (index < 0) break;
        sequence.splice(index, 1);
        count--;
        skipSteps[key] = Math.max(0, Number(skipSteps[key] || 0) - 1);
      }
    }

    const skipGroups = modifiers.skipPhaseGroups[playerId] || {};
    for (const [group, rawCount] of Object.entries({ ...skipGroups })) {
      let count = Math.max(0, Number(rawCount || 0));
      while (count > 0) {
        const first = sequence.findIndex(node => node.phaseGroup === group);
        if (first < 0) break;
        sequence = sequence.filter((node, index) => index < first || node.phaseGroup !== group);
        count--;
        skipGroups[group] = Math.max(0, Number(skipGroups[group] || 0) - 1);
      }
    }

    return reindexSequence(sequence);
  }

  _syncCurrentNode() {
    const s = this.ensureState();
    let index = Number.isInteger(s.phaseIndex) ? s.phaseIndex : -1;
    if (index < 0 || index >= s.turnSequence.length || s.turnSequence[index]?.key !== s.phase) {
      const matching = s.turnSequence.findIndex(node => node.key === s.phase);
      index = matching >= 0 ? matching : Math.max(0, Math.min(s.turnSequence.length - 1, index));
      s.phaseIndex = index;
    }
    const node = s.turnSequence[index] || null;
    s.turnStepId = node?.id || null;
    s.turnPhaseGroup = node?.phaseGroup || null;
    return node;
  }

  startFirstTurn(token) {
    this.#assertInternal(token);
    const s = this.ensureState();
    s.turn = 1;
    s.activePlayer = s.playerOrder.find(id => !s.players[id].lost) || 'player';
    s.turnKind = 'normal';
    s.normalTurnPlayer = s.activePlayer;
    s.turnSequence = this._buildSequenceFor(s.activePlayer);
    s.phaseIndex = 0;
    s.phase = s.turnSequence[0]?.key || 'CLEANUP';
    s.cleanupIteration = 0;
    this.beginCurrentStep(token, { turnStart: true });
  }

  beginCurrentStep(token, { turnStart = false, repeatedCleanup = false } = {}) {
    this.#assertInternal(token);
    const e = this.engine;
    const s = this.ensureState();
    const p = s.players[s.activePlayer];
    if (!p || s.winner) { s.priorityPlayer = null; return null; }

    const node = this._syncCurrentNode();
    if (!node) return this.finishTurn(token);

    s.passes = 0;
    s.turnActionPending = null;
    s.cleanupPriority = false;
    s.priorityPlayer = node.grantsPriority ? s.activePlayer : null;
    if (node.key !== 'CLEANUP') s.cleanupIteration = 0;
    else if (!repeatedCleanup) s.cleanupIteration = Math.max(1, Number(s.cleanupIteration || 0));

    if (turnStart || node.key === 'UNTAP') {
      e.emit(EVENT.TURN_START, {
        controller: s.activePlayer,
        playerId: s.activePlayer,
        turn: s.turn,
        turnOrder: [...s.playerOrder]
      });
    }

    e.log('TURN_STEP_BEGIN', {
      playerId: s.activePlayer,
      step: node.key,
      phaseGroup: node.phaseGroup,
      stepId: node.id,
      occurrence: node.occurrence,
      cleanupIteration: node.key === 'CLEANUP' ? s.cleanupIteration : undefined
    });
    e.emit(EVENT.PHASE_BEGIN, {
      controller: s.activePlayer,
      phase: node.key,
      phaseGroup: node.phaseGroup,
      stepId: node.id,
      occurrence: node.occurrence,
      cleanupIteration: node.key === 'CLEANUP' ? s.cleanupIteration : undefined
    });

    // Step-specific rule processing that is not itself a turn-based action.
    switch (node.key) {
      case 'UPKEEP':
        e._processSuspendUpkeep(s.activePlayer);
        break;
      case 'PRECOMBAT_MAIN':
        e._advanceSagas(s.activePlayer);
        break;
      case 'BEGIN_COMBAT':
        e.emit(EVENT.BEGIN_COMBAT, { controller: s.activePlayer });
        break;
      case 'END_COMBAT':
        e.combat.cleanup(this.#internalToken);
        break;
      case 'END_STEP':
        e.emit(EVENT.END_STEP, { controller: s.activePlayer });
        for (const player of Object.values(s.players)) {
          for (const permanent of [...player.battlefield]) {
            if (Number(permanent.exileAtEndTurn) === Number(s.turn)) e.exile(permanent);
            else if (Number(permanent.sacrificeAtEndTurn) === Number(s.turn)) e.sacrifice(permanent);
          }
        }
        break;
      default:
        break;
    }

    const result = this.turnBasedActions.run(node.key, token);
    if (result?.automaticAdvance && !s.pendingChoice && !s.winner) return this.advance(token);

    if (!node.grantsPriority && node.key !== 'CLEANUP' && !s.turnActionPending && !s.pendingChoice && !s.winner) {
      return this.advance(token);
    }
    return node;
  }

  advance(token) {
    this.#assertInternal(token);
    const e = this.engine;
    const s = this.ensureState();
    if (s.winner) { s.priorityPlayer = null; return null; }
    for (const player of Object.values(s.players)) e.mana.clear(player);
    s.passes = 0;
    s.priorityPlayer = null;
    s.turnActionPending = null;

    let nextIndex = Number(s.phaseIndex) + 1;
    while (nextIndex < s.turnSequence.length) {
      const candidate = s.turnSequence[nextIndex];
      if (candidate.key === 'FIRST_STRIKE_DAMAGE' && !e.combat.needsFirstStrikeStep()) {
        e.log('TURN_STEP_SKIPPED', { playerId: s.activePlayer, step: candidate.key, reason: 'no-first-strike-or-double-strike' });
        nextIndex++;
        continue;
      }
      break;
    }

    if (nextIndex >= s.turnSequence.length) return this.finishTurn(token);
    s.phaseIndex = nextIndex;
    s.phase = s.turnSequence[nextIndex].key;
    return this.beginCurrentStep(token);
  }

  _recordCompletedTurn() {
    const s = this.ensureState();
    s.turnHistory.push({
      turn: s.turn,
      activePlayer: s.activePlayer,
      turnOrder: [...s.playerOrder],
      sequence: s.turnSequence.map(node => ({ id: node.id, key: node.key, phaseGroup: node.phaseGroup, origin: node.origin, occurrence: node.occurrence })),
      completed: true
    });
    this.engine.log('TURN_COMPLETED', { playerId: s.activePlayer, turnOrder: [...s.playerOrder] });
  }

  _takeExtraTurnCandidate() {
    const s = this.ensureState();
    while (s.extraTurnQueue.length) {
      const playerId = s.extraTurnQueue.shift();
      if (!s.players[playerId] || s.players[playerId].lost) continue;
      if (Number(s.extraTurns?.[playerId] || 0) > 0) s.extraTurns[playerId]--;
      return playerId;
    }
    // Compatibility with Step 3 snapshots/effects that only populated the old count.
    const finishingPlayer = s.activePlayer;
    if (Number(s.extraTurns?.[finishingPlayer] || 0) > 0) {
      s.extraTurns[finishingPlayer]--;
      return finishingPlayer;
    }
    return null;
  }

  _nextTurnPlayer() {
    const s = this.ensureState();
    const maxSkips = Math.max(8, (s.playerOrder?.length || 2) * 32);
    let guard = 0;

    const nextCandidate = () => {
      const extra = this._takeExtraTurnCandidate();
      if (extra) return { playerId: extra, kind: 'extra' };
      const normal = this.engine.nextPlayer(s.normalTurnPlayer);
      return normal ? { playerId: normal, kind: 'normal' } : null;
    };

    let candidate = nextCandidate();
    while (candidate && guard++ < maxSkips) {
      const skips = Number(s.turnModifiers.skippedTurns?.[candidate.playerId] || 0);
      if (skips <= 0) {
        if (candidate.kind === 'normal') s.normalTurnPlayer = candidate.playerId;
        return candidate;
      }

      s.turnModifiers.skippedTurns[candidate.playerId] = skips - 1;
      const record = {
        turnAfter: s.turn,
        playerId: candidate.playerId,
        kind: candidate.kind,
        reason: 'skip-next-turn'
      };
      s.skippedTurnHistory.push(record);
      this.engine.log('TURN_SKIPPED', record);
      if (candidate.kind === 'normal') s.normalTurnPlayer = candidate.playerId;
      candidate = nextCandidate();
    }
    if (guard >= maxSkips) throw new Error('Turn scheduler could not find a playable next turn');
    return candidate;
  }

  finishTurn(token) {
    this.#assertInternal(token);
    const e = this.engine;
    const s = this.ensureState();
    if (s.winner) { s.priorityPlayer = null; return null; }
    for (const player of Object.values(s.players)) e.mana.clear(player);
    // Compatibility with test/developer state setup that may reposition the
    // active player directly. In a real normal turn these values are always
    // equal; extra turns intentionally keep the normal-turn anchor unchanged.
    if (s.turnKind === 'normal' && s.normalTurnPlayer !== s.activePlayer) s.normalTurnPlayer = s.activePlayer;
    this._recordCompletedTurn();

    const next = this._nextTurnPlayer();
    if (!next) { s.priorityPlayer = null; return null; }
    s.turn += 1;
    s.activePlayer = next.playerId;
    s.turnKind = next.kind;
    s.turnSequence = this._buildSequenceFor(next.playerId);
    s.phaseIndex = 0;
    s.phase = s.turnSequence[0]?.key || 'CLEANUP';
    s.passes = 0;
    s.priorityPlayer = null;
    s.turnActionPending = null;
    s.cleanupPriority = false;
    s.cleanupIteration = 0;
    return this.beginCurrentStep(token, { turnStart: true });
  }

  repeatCleanup(token) {
    this.#assertInternal(token);
    const s = this.ensureState();
    if (s.phase !== 'CLEANUP') throw new Error('Cleanup can only repeat from the cleanup step');
    s.cleanupIteration = Math.max(1, Number(s.cleanupIteration || 1)) + 1;
    this.engine.log('CLEANUP_REPEAT', { playerId: s.activePlayer, cleanupIteration: s.cleanupIteration });
    return this.beginCurrentStep(token, { repeatedCleanup: true });
  }

  addExtraTurn(playerId, count = 1) {
    const s = this.ensureState();
    if (!s.players[playerId]) throw new Error(`Unknown player ${playerId}`);
    const amount = Math.max(0, Number(count) || 0);
    for (let i = 0; i < amount; i++) s.extraTurnQueue.unshift(playerId);
    s.extraTurns[playerId] = Number(s.extraTurns[playerId] || 0) + amount;
    this.engine.log('EXTRA_TURN_CREATED', { controller: playerId, amount, queue: [...s.extraTurnQueue] });
    return amount;
  }

  skipNextTurns(playerId, count = 1) {
    const s = this.ensureState();
    if (!s.players[playerId]) throw new Error(`Unknown player ${playerId}`);
    s.turnModifiers.skippedTurns[playerId] = Number(s.turnModifiers.skippedTurns[playerId] || 0) + Math.max(0, Number(count) || 0);
    return s.turnModifiers.skippedTurns[playerId];
  }

  addExtraUpkeeps(playerId, count = 1) {
    const s = this.ensureState();
    s.turnModifiers.extraUpkeeps[playerId] = Number(s.turnModifiers.extraUpkeeps[playerId] || 0) + Math.max(0, Number(count) || 0);
    return s.turnModifiers.extraUpkeeps[playerId];
  }

  skipNextDrawSteps(playerId, count = 1) {
    const s = this.ensureState();
    s.turnModifiers.skippedDrawSteps[playerId] = Number(s.turnModifiers.skippedDrawSteps[playerId] || 0) + Math.max(0, Number(count) || 0);
    return s.turnModifiers.skippedDrawSteps[playerId];
  }

  skipNextCombatPhases(playerId, count = 1) {
    const s = this.ensureState();
    s.turnModifiers.skippedCombatPhases[playerId] = Number(s.turnModifiers.skippedCombatPhases[playerId] || 0) + Math.max(0, Number(count) || 0);
    return s.turnModifiers.skippedCombatPhases[playerId];
  }

  skipNextStep(playerId, stepKey, count = 1) {
    if (!PHASES.includes(stepKey)) throw new Error(`Unknown step ${stepKey}`);
    const s = this.ensureState();
    const map = s.turnModifiers.skipSteps[playerId] ||= {};
    map[stepKey] = Number(map[stepKey] || 0) + Math.max(0, Number(count) || 0);
    return map[stepKey];
  }

  skipNextPhaseGroup(playerId, phaseGroup, count = 1) {
    if (!Object.values(TURN_PHASE_GROUP).includes(phaseGroup)) throw new Error(`Unknown phase group ${phaseGroup}`);
    const s = this.ensureState();
    const map = s.turnModifiers.skipPhaseGroups[playerId] ||= {};
    map[phaseGroup] = Number(map[phaseGroup] || 0) + Math.max(0, Number(count) || 0);
    return map[phaseGroup];
  }

  addExtraCombatAfterCurrent({ includeMainAfter = false } = {}) {
    const s = this.ensureState();
    const insertion = combatSequence({ origin: 'extra-combat' });
    if (includeMainAfter) insertion.push(makeTurnNode('POSTCOMBAT_MAIN', { origin: 'extra-main-after-combat' }));
    s.turnSequence.splice(s.phaseIndex + 1, 0, ...insertion);
    s.turnSequence = reindexSequence(s.turnSequence);
    this._syncCurrentNode();
    this.engine.log('EXTRA_COMBAT_CREATED', { playerId: s.activePlayer, includeMainAfter });
    return insertion.length;
  }

  addExtraMainPhaseAfterCurrent() {
    const s = this.ensureState();
    s.turnSequence.splice(s.phaseIndex + 1, 0, makeTurnNode('POSTCOMBAT_MAIN', { origin: 'extra-main' }));
    s.turnSequence = reindexSequence(s.turnSequence);
    this._syncCurrentNode();
    this.engine.log('EXTRA_MAIN_PHASE_CREATED', { playerId: s.activePlayer });
    return 1;
  }

  getSnapshot() {
    const s = this.ensureState();
    return structuredClone({
      turn: s.turn,
      activePlayer: s.activePlayer,
      turnKind: s.turnKind,
      normalTurnPlayer: s.normalTurnPlayer,
      phase: s.phase,
      phaseIndex: s.phaseIndex,
      phaseGroup: s.turnPhaseGroup,
      stepId: s.turnStepId,
      cleanupIteration: s.cleanupIteration,
      sequence: s.turnSequence,
      extraTurnQueue: s.extraTurnQueue,
      modifiers: s.turnModifiers,
      turnHistory: s.turnHistory,
      skippedTurnHistory: s.skippedTurnHistory
    });
  }
}
