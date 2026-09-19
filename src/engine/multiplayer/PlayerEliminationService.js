export class PlayerEliminationService {
  constructor(engine) { this.engine = engine; this.sequence = 0; }

  markLost(playerId, { reason = 'rules', commanderId = null } = {}) {
    const player = this.engine.state.players[playerId];
    if (!player || player.lost) return false;
    player.lost = true;
    player.eliminatedAtTurn = this.engine.state.turn;
    this.engine.log('PLAYER_ELIMINATED', { playerId, reason, commanderId });
    return true;
  }

  eliminate(playerId, details = {}) {
    const changed = this.markLost(playerId, details);
    if (changed) this.cleanup();
    return changed;
  }

  #survivingControllerFromHistory(card, eliminated) {
    const history = Array.isArray(card.controlHistory) ? [...card.controlHistory] : [];
    while (history.length) {
      const candidate = history.pop();
      if (candidate && this.engine.state.players[candidate] && !eliminated.has(candidate) && !this.engine.state.players[candidate].lost) {
        card.controlHistory = history;
        return candidate;
      }
    }
    card.controlHistory = [];
    return null;
  }

  cleanup() {
    const e = this.engine;
    const state = e.state;
    const eliminated = new Set(e.playerIds().filter(id => state.players[id]?.lost));
    const newlyEliminated = new Set([...eliminated].filter(id => !state.players[id]?.eliminationCleanupComplete));
    // Cleanup is a transaction for newly eliminated players, not a recurring
    // maintenance pass. Re-running it on every SBA/priority checkpoint bloats
    // replay history and repeatedly scans every zone in long multiplayer games.
    if (!newlyEliminated.size) return null;

    // Build the complete plan before mutating zones so the transaction is based
    // on one coherent pre-elimination state.
    const controlledByEliminated = [];
    const departingSourceIds = new Set();
    for (const player of Object.values(state.players)) {
      for (const zone of ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command']) {
        for (const card of player[zone] || []) {
          if (eliminated.has(card.owner)) {
            if (card.instanceId) departingSourceIds.add(card.instanceId);
            if (card.gameObjectId) departingSourceIds.add(card.gameObjectId);
          }
          if (zone === 'battlefield' && !eliminated.has(card.owner) && eliminated.has(card.controller)) controlledByEliminated.push(card.instanceId);
        }
      }
    }
    for (const item of state.stack || []) {
      if (eliminated.has(item.card?.owner) || eliminated.has(item.source?.owner)) {
        if (item.card?.instanceId) departingSourceIds.add(item.card.instanceId);
        if (item.source?.instanceId) departingSourceIds.add(item.source.instanceId);
      }
    }

    const effectBelongsToEliminated = effect => {
      const sourceId = effect?.sourceId || effect?.sourceInstanceId || effect?.source?.instanceId || effect?.source?.gameObjectId || null;
      return eliminated.has(effect?.controller) || eliminated.has(effect?.playerId) || eliminated.has(effect?.sourceOwner) || (sourceId && departingSourceIds.has(sourceId));
    };

    const summary = {
      sequence: ++this.sequence,
      eliminatedPlayers: [...newlyEliminated],
      ownedObjectsRemoved: 0,
      controlEffectsEnded: 0,
      residualControlledObjectsExiled: 0,
      stackObjectsRemoved: 0,
      triggersRemoved: 0,
      pendingChoiceCancelled: false
    };

    for (const eliminatedId of newlyEliminated) summary.ownedObjectsRemoved += e.zones.removeOwnedObjects(eliminatedId);

    // First end known control-changing effects by unwinding the controller
    // history. If an object is still controlled by a player who left after those
    // effects end, exile it under its surviving owner's zone rather than
    // inventing a new control effect that hands it to the owner.
    for (const instanceId of controlledByEliminated) {
      const card = e.zones.find(instanceId)?.card;
      if (!card || eliminated.has(card.owner)) continue;
      const restored = this.#survivingControllerFromHistory(card, eliminated);
      if (restored) {
        e.zones.transferBattlefieldControl(card.instanceId, restored);
        card.controller = restored;
        card.controlledSinceTurn = state.turn;
        card.attacking = false; card.attackTarget = null; card.blocking = null;
        summary.controlEffectsEnded += 1;
      } else {
        e._moveZoneNow(card, 'exile', card.owner, { reason: 'player-elimination-residual-control' });
        summary.residualControlledObjectsExiled += 1;
      }
    }

    const beforeStack = state.stack.length;
    e.stack.removeWhere(item => eliminated.has(item.controller || item.card?.controller) || eliminated.has(item.card?.owner) || eliminated.has(item.source?.owner));
    summary.stackObjectsRemoved = beforeStack - state.stack.length;

    const beforeTriggers = (state.pendingTriggers || []).length;
    state.pendingTriggers = (state.pendingTriggers || []).filter(trigger => !effectBelongsToEliminated(trigger));
    summary.triggersRemoved = beforeTriggers - state.pendingTriggers.length;
    state.triggerRegistrations = (state.triggerRegistrations || []).filter(trigger => !effectBelongsToEliminated(trigger));
    state.continuousEffects = (state.continuousEffects || []).filter(effect => !effectBelongsToEliminated(effect));
    state.preventionEffects = (state.preventionEffects || []).filter(effect => !effectBelongsToEliminated(effect));

    for (const [id, effect] of e.continuous?.runtimeEffects || []) if (effectBelongsToEliminated(effect)) e.continuous.unregister(id);
    for (const [id, effect] of e.replacements?.registry?.registered || []) if (effectBelongsToEliminated(effect)) e.replacements.registry.registered.delete(id);
    for (const [id, effect] of e.prevention?.runtimeEffects || []) if (effectBelongsToEliminated(effect)) e.prevention.runtimeEffects.delete(id);
    if (e.continuous?.clearExpired) e.continuous.clearExpired();

    if (state.pendingChoice?.playerId && eliminated.has(state.pendingChoice.playerId)) {
      state.pendingChoice = null;
      summary.pendingChoiceCancelled = true;
    }

    state.extraTurnQueue = (state.extraTurnQueue || []).filter(id => !eliminated.has(id));
    for (const id of eliminated) {
      state.extraTurns[id] = 0;
      if (state.turnModifiers?.skippedTurns) state.turnModifiers.skippedTurns[id] = 0;
      if (state.turnModifiers?.extraUpkeeps) state.turnModifiers.extraUpkeeps[id] = 0;
      if (state.turnModifiers?.skippedDrawSteps) state.turnModifiers.skippedDrawSteps[id] = 0;
      if (state.turnModifiers?.skippedCombatPhases) state.turnModifiers.skippedCombatPhases[id] = 0;
    }

    if (state.combat) {
      const combatTargetStillExists = target => {
        if (!target) return false;
        if (state.players[target]) return !eliminated.has(target) && !state.players[target].lost;
        return !!e.findPermanent(target);
      };
      state.combat.attackers = (state.combat.attackers || []).filter(id => !!e.findPermanent(id));
      state.combat.attackTargets = Object.fromEntries(Object.entries(state.combat.attackTargets || {}).filter(([aid, target]) => e.findPermanent(aid) && combatTargetStillExists(target)));
      state.combat.attackDefendingPlayers = Object.fromEntries(Object.entries(state.combat.attackDefendingPlayers || {}).filter(([aid, defender]) => e.findPermanent(aid) && !eliminated.has(defender)));
      state.combat.defendingEntities = Object.fromEntries(Object.entries(state.combat.defendingEntities || {}).filter(([entityId, entity]) => {
        if (eliminated.has(entity?.defendingPlayer) || eliminated.has(entity?.playerId)) return false;
        return entity?.type === 'player' ? combatTargetStillExists(entityId) : !!e.findPermanent(entityId);
      }));
      state.combat.blockers = Object.fromEntries(Object.entries(state.combat.blockers || {}).filter(([aid]) => e.findPermanent(aid)).map(([aid, ids]) => [aid, (ids || []).filter(id => !!e.findPermanent(id))]));
      state.combat.blocked = Object.fromEntries(Object.entries(state.combat.blocked || {}).filter(([aid]) => e.findPermanent(aid)));
      state.combat.damageAssignments = Object.fromEntries(Object.entries(state.combat.damageAssignments || {}).filter(([aid]) => e.findPermanent(aid)));
      state.combat.defendingPlayers = (state.combat.defendingPlayers || []).filter(id => !eliminated.has(id));
      state.combat.blockerQueue = (state.combat.blockerQueue || []).filter(id => !eliminated.has(id));
      if (state.combat.currentDefender && eliminated.has(state.combat.currentDefender)) state.combat.currentDefender = state.combat.blockerQueue[0] || null;
    }

    for (const id of newlyEliminated) if (state.players[id]) state.players[id].eliminationCleanupComplete = true;
    e.log('PLAYER_ELIMINATION_TRANSACTION', summary);
    return summary;
  }
}
