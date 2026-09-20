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
        // Day/night changes during the untap step and uses the previous turn's
        // spell count. Transform every daybound/nightbound permanent to the
        // face appropriate for the resulting designation.
        const previous = Number(s.spellsCastLastTurn || 0);
        if (s.dayNight === 'day' && previous === 0) s.dayNight = 'night';
        else if (s.dayNight === 'night' && previous >= 2) s.dayNight = 'day';
        for (const player of Object.values(s.players)) for (const permanent of [...player.battlefield]) {
          const definition = e.copy?.definitionForObject(permanent) || e.db[permanent.cardId] || {};
          const kws = (definition.keywords || []).map(k => String(k).toLowerCase());
          if (!s.dayNight && (kws.includes('daybound') || kws.includes('nightbound'))) s.dayNight = 'day';
          const current = Number(permanent.faceState?.currentFaceIndex || 0);
          if ((s.dayNight === 'night' && kws.includes('daybound') && current === 0) || (s.dayNight === 'day' && kws.includes('nightbound') && current !== 0)) {
            e.events.dispatch('TRANSFORM', { permanentId: permanent.instanceId }, { cause:'day-night', stabilize:false });
          }
        }
        s.priorityPlayer = null;
        e.legality?.beginTurn();
        e.timing?.beginTurn();
        // Phasing happens before untapping. Attachments phase indirectly with
        // their host even when another player controls the attachment.
        const allBattlefield = Object.values(s.players).flatMap(player => player.battlefield || []);
        const phaseInIds = new Set();
        const phaseOutIds = new Set();
        for (const c of p.battlefield) {
          const phaseDefinition = e.copy?.definitionForObject(c) || e.db[c.cardId] || {};
          const hasPhasing = phaseDefinition.phasing === true || (phaseDefinition.keywords || []).some(keyword => String(keyword).toLowerCase() === 'phasing');
          if (!hasPhasing) continue;
          if (c.phasedOut) phaseInIds.add(c.instanceId); else phaseOutIds.add(c.instanceId);
        }
        for (const id of phaseInIds) {
          const host = allBattlefield.find(card => card.instanceId === id); if (host) host.phasedOut = false;
          for (const card of allBattlefield) if (card.phasedOutWith === id) { card.phasedOut = false; delete card.phasedOutWith; }
        }
        for (const id of phaseOutIds) {
          const host = allBattlefield.find(card => card.instanceId === id); if (host) host.phasedOut = true;
          let frontier=[id]; const seen=new Set(frontier);
          while(frontier.length){ const parent=frontier.shift(); for(const card of allBattlefield){ if(card.attachedTo===parent&&!seen.has(card.instanceId)){card.phasedOut=true;card.phasedOutWith=id;seen.add(card.instanceId);frontier.push(card.instanceId);}} }
        }
        for (const c of p.battlefield) {
          if (c.phasedOut) continue;
          const untapDefinition = e.copy?.definitionForObject(c) || e.db[c.cardId] || {};
          if (c.skipNextUntap) { delete c.skipNextUntap; }
          else if (!untapDefinition.doesNotUntap && c.tapped && (!e.legality || e.legality.allowsOperation('UNTAP', s.activePlayer, { object: c, source: c, definition: untapDefinition, zone: 'battlefield' }))) e.untapPermanent(c);
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
