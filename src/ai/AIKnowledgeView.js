/**
 * Player-scoped immutable knowledge snapshot for AI strategy.
 * Hidden cards are represented by the engine's redacted placeholders; this
 * class additionally fails closed if a placeholder ever carries a card id.
 */
export class AIKnowledgeView {
  constructor(engineFacade, playerId) {
    this.engine = engineFacade;
    this.playerId = playerId;
    this.state = null;
    this.db = null;
    this.known = null;
  }

  _assertRedaction(state) {
    for (const [playerId, player] of Object.entries(state?.players || {})) {
      if (playerId === this.playerId) continue;
      for (const zone of ['hand', 'library', 'exile']) {
        for (const card of player?.[zone] || []) {
          if (!card?.hidden) continue;
          if (card.cardId != null || card.gameObjectId != null) {
            throw new Error(`Hidden-information leak detected in ${playerId}.${zone}`);
          }
        }
      }
    }
  }

  refresh() {
    const state = this.engine.getPlayerStateSnapshot(this.playerId);
    this._assertRedaction(state);
    this.state = state;
    this.db = this.engine.getCardDatabaseSnapshot();
    this.known = this.engine.getKnownInformationSnapshot(this.playerId);
    return Object.freeze({ state: this.state, db: this.db, known: this.known });
  }
}
