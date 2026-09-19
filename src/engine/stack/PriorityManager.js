/**
 * Tournament-style multiplayer priority/pass manager.
 *
 * The active player is granted priority at rules-defined windows by TurnEngine.
 * Once priority is open, this class owns consecutive pass tracking and the
 * stack-empty / stack-nonempty all-pass outcomes.
 */
export class PriorityManager {
  constructor(engine, internalToken) {
    this.engine = engine;
    this.internalToken = internalToken;
  }

  resetConsecutivePasses(reason = 'action') {
    this.engine.state.passes = 0;
  }

  grant(playerId, reason = 'priority-window') {
    const s = this.engine.state;
    if (s.winner) { s.priorityPlayer = null; return null; }
    if (!playerId || s.players[playerId]?.lost) playerId = this.engine.nextPriorityPlayer(playerId || s.activePlayer);
    s.priorityPlayer = playerId || null;
    s.passes = 0;
    return s.priorityPlayer;
  }

  retain(playerId, reason = 'action-on-stack') {
    const s = this.engine.state;
    if (s.winner || s.pendingChoice) return null;
    s.priorityPlayer = playerId;
    s.passes = 0;
    return playerId;
  }

  pass(playerId) {
    const e = this.engine, s = e.state;
    if (s.priorityPlayer !== playerId) throw new Error('Only the player with priority may pass');
    const living = e.livingPlayerIds();
    if (!living.includes(playerId)) throw new Error('Eliminated players cannot pass priority');

    const passCheckpoint = { passes: s.passes, priorityPlayer: s.priorityPlayer };
    s.passes += 1;

    if (s.passes < living.length) {
      s.priorityPlayer = e.nextPriorityPlayer(playerId);
      return { outcome: 'passed', nextPlayer: s.priorityPlayer };
    }

    // Every living player passed in succession. The next rules action depends
    // solely on whether the stack is empty at this point. If resolution itself
    // fails, restore the pass cursor so the failed transaction can be retried
    // without inventing a new priority round.
    s.passes = 0;
    if (s.stack.length) {
      try {
        const resolved = e._resolveTop(this.internalToken);
        if (!e.state.winner) {
          const choicePlayer = e.state.pendingChoice?.playerId || null;
          if (choicePlayer && e.state.players[choicePlayer] && !e.state.players[choicePlayer].lost) {
            e.state.priorityPlayer = choicePlayer;
          } else {
            const active = e.state.activePlayer;
            e.state.priorityPlayer = e.state.players[active] && !e.state.players[active].lost
              ? active
              : e.nextPriorityPlayer(active);
          }
        }
        return { outcome: 'resolved', resolved };
      } catch (error) {
        e.state.passes = passCheckpoint.passes;
        e.state.priorityPlayer = passCheckpoint.priorityPlayer;
        throw error;
      }
    }

    if (s.phase === 'CLEANUP' && s.cleanupPriority) {
      e.turn.repeatCleanup(this.internalToken);
      return { outcome: 'repeat-cleanup' };
    }

    e._advancePhase(this.internalToken);
    return { outcome: 'advanced-step' };
  }

  getSnapshot() {
    const s = this.engine.state;
    return {
      priorityPlayer: s.priorityPlayer,
      consecutivePasses: s.passes,
      livingPlayers: this.engine.livingPlayerIds(),
      stackDepth: s.stack.length,
      activePlayer: s.activePlayer,
      phase: s.phase,
      pendingChoicePlayer: s.pendingChoice?.playerId || null
    };
  }
}
