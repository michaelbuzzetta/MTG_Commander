function normalized(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

export class MultiplayerRelationService {
  constructor(engine) { this.engine = engine; }

  livingPlayerIds() { return this.engine.playerIds().filter(id => !this.engine.state.players[id]?.lost); }

  opponentsOf(playerId) {
    return this.livingPlayerIds().filter(id => id !== playerId && !this.areTeammates(playerId, id));
  }

  teammatesOf(playerId) {
    return this.livingPlayerIds().filter(id => id !== playerId && this.areTeammates(playerId, id));
  }

  areTeammates(a, b) {
    if (!a || !b || a === b) return false;
    const pa = this.engine.state.players[a];
    const pb = this.engine.state.players[b];
    return !!(pa && pb && pa.teamId != null && pb.teamId != null && pa.teamId === pb.teamId);
  }

  defendingPlayerIds(context = {}) {
    const combat = this.engine.state.combat || {};
    if (context.defendingPlayerId && this.engine.state.players[context.defendingPlayerId] && !this.engine.state.players[context.defendingPlayerId].lost) return [context.defendingPlayerId];
    const sourceId = context.sourceObject?.instanceId || context.sourceObject?.gameObjectId || context.sourceId || null;
    const fromAttacker = sourceId ? combat.attackDefendingPlayers?.[sourceId] : null;
    if (fromAttacker && !this.engine.state.players[fromAttacker]?.lost) return [fromAttacker];
    if (combat.currentDefender && !this.engine.state.players[combat.currentDefender]?.lost) return [combat.currentDefender];
    return [...new Set((combat.defendingPlayers || []).filter(id => this.engine.state.players[id] && !this.engine.state.players[id].lost))];
  }

  resolve(relation, { actorPlayerId = null, targetPlayerId = null, sourceObject = null, defendingPlayerId = null } = {}) {
    const key = normalized(relation);
    const living = this.livingPlayerIds();
    const actor = actorPlayerId || sourceObject?.controller || null;
    if (!key || key === 'any') return targetPlayerId ? [targetPlayerId] : living;
    if (this.engine.state.players[relation]) return living.includes(relation) ? [relation] : [];
    if (['you', 'self', 'controller'].includes(key)) return actor && living.includes(actor) ? [actor] : [];
    if (['opponent', 'opponents', 'each opponent', 'target opponent'].includes(key)) return actor ? this.opponentsOf(actor) : [];
    if (['player', 'each player', 'all players'].includes(key)) return living;
    if (['another player', 'other player'].includes(key)) return actor ? living.filter(id => id !== actor) : living;
    if (['teammate', 'teammates', 'each teammate'].includes(key)) return actor ? this.teammatesOf(actor) : [];
    if (['active player'].includes(key)) return this.engine.state.activePlayer && !this.engine.state.players[this.engine.state.activePlayer]?.lost ? [this.engine.state.activePlayer] : [];
    if (['defending player'].includes(key)) return this.defendingPlayerIds({ sourceObject, defendingPlayerId });
    return targetPlayerId ? [targetPlayerId] : living;
  }

  matches(relation, candidatePlayerId, context = {}) {
    if (!relation) return true;
    if (!candidatePlayerId || !this.engine.state.players[candidatePlayerId] || this.engine.state.players[candidatePlayerId].lost) return false;
    return this.resolve(relation, context).includes(candidatePlayerId);
  }
}
