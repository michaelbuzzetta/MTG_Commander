import { EVENT } from '../constants.js';

/**
 * Rules-defined turn-based actions. These operations deliberately do not use
 * the stack. The surrounding TurnEngine decides when priority can be granted.
 */
export class TurnBasedActions {
  #internalToken;

  constructor(engine, internalToken) {
    this.engine = engine;
    this.#internalToken = internalToken;
  }

  #assertInternal(token) {
    if (token !== this.#internalToken) throw new Error('Turn-based actions are internal rules operations');
  }

  run(stepKey, token) {
    this.#assertInternal(token);
    const e = this.engine;
    const s = e.state;
    const p = s.players[s.activePlayer];

    switch (stepKey) {
      case 'UNTAP': {
        s.cardsDrawnThisTurn[s.activePlayer] = 0;
        s.priorityPlayer = null;
        e.legality?.beginTurn();
        e.timing?.beginTurn();
        for (const c of p.battlefield) {
          // Phasing happens during the untap step before the normal untap action.
          if (c.phasedOut) c.phasedOut = false;
          if (c.tapped && (!e.legality || e.legality.allowsOperation('UNTAP', s.activePlayer, { object: c, source: c, definition: e.db[c.cardId], zone: 'battlefield' }))) e.untapPermanent(c);
          const controlledSince = c.controlledSinceTurn ?? c.createdTurn;
          if (c.summoningSick && controlledSince != null && controlledSince < s.turn) c.summoningSick = false;
        }
        p.landPlaysRemaining = 1 + Number(p.additionalLandPlays || 0);
        p.additionalLandPlays = 0;
        s.castingPermissions = (s.castingPermissions || []).filter(permission => permission.untilTurn != null && permission.untilTurn >= s.turn);
        e.log('TURN_BASED_ACTION', { action: 'UNTAP', playerId: s.activePlayer, step: stepKey });
        return { automaticAdvance: true };
      }
      case 'DRAW':
        e.draw(s.activePlayer);
        e.log('TURN_BASED_ACTION', { action: 'DRAW_FOR_TURN', playerId: s.activePlayer, step: stepKey });
        return { automaticAdvance: false };
      case 'DECLARE_ATTACKERS':
        s.turnActionPending = 'DECLARE_ATTACKERS';
        s.priorityPlayer = s.activePlayer;
        e.log('TURN_BASED_ACTION_PENDING', { action: 'DECLARE_ATTACKERS', playerId: s.activePlayer, step: stepKey });
        return { pendingAction: true };
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
        e.log('TURN_BASED_ACTION_PENDING', { action: 'DECLARE_BLOCKERS', playerId: s.combat.currentDefender, step: stepKey });
        return { pendingAction: !!s.combat.currentDefender };
      }
      case 'FIRST_STRIKE_DAMAGE':
        e.combat.damageStep(true, this.#internalToken);
        s.priorityPlayer = s.winner ? null : s.activePlayer;
        e.log('TURN_BASED_ACTION', { action: 'FIRST_STRIKE_COMBAT_DAMAGE', playerId: s.activePlayer, step: stepKey });
        return { automaticAdvance: false };
      case 'COMBAT_DAMAGE':
        e.combat.damageStep(false, this.#internalToken);
        s.priorityPlayer = s.winner ? null : s.activePlayer;
        e.log('TURN_BASED_ACTION', { action: 'COMBAT_DAMAGE', playerId: s.activePlayer, step: stepKey });
        return { automaticAdvance: false };
      case 'CLEANUP':
        e.prevention?.pruneExpired({ forceEndOfTurn: true, turn: s.turn });
        e._beginCleanup(this.#internalToken);
        e.log('TURN_BASED_ACTION', { action: 'CLEANUP', playerId: s.activePlayer, step: stepKey, cleanupIteration: s.cleanupIteration });
        return { automaticAdvance: false };
      default:
        return { automaticAdvance: false };
    }
  }
}
