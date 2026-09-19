/**
 * Read/submit facade exposed to AI strategy code.
 *
 * Step 29 deliberately does not hand the authoritative GameEngine object to
 * strategy code. The facade exposes immutable player-scoped snapshots, public
 * battlefield/rules queries, legal-action discovery, and validated submission
 * gateways only. There is no `state`, mutable database, or internal subsystem
 * surface on this object.
 */
export class AIEngineFacade {
  #engine;

  constructor(engine, playerId) {
    this.#engine = engine;
    this.playerId = playerId;
  }

  _assertSelf(playerId = this.playerId) {
    if (playerId !== this.playerId) throw new Error('AI may only request its own private player view');
    return playerId;
  }

  getPlayerStateSnapshot(playerId = this.playerId) {
    return this.#engine.getPlayerStateSnapshot(this._assertSelf(playerId));
  }

  getKnownInformationSnapshot(playerId = this.playerId) {
    return this.#engine.getKnownInformationSnapshot(this._assertSelf(playerId));
  }

  getCardDatabaseSnapshot() { return this.#engine.getCardDatabaseSnapshot(); }
  getLegalActions(playerId = this.playerId) { return this.#engine.getLegalActions(this._assertSelf(playerId)); }
  getPendingChoiceRequest() { return this.#engine.getPendingChoiceRequest(); }
  getPermanentSnapshot(instanceId) { return this.#engine.getPermanentSnapshot(instanceId); }
  getDerivedStats(ref) { return this.#engine.getDerivedStats(ref); }
  getEffectiveAbilities(ref) { return this.#engine.getEffectiveAbilities(ref); }
  getLegalAttackers(playerId = this.playerId) { return this.#engine.getLegalAttackers(this._assertSelf(playerId)); }
  getAttachmentSnapshot() { return this.#engine.getAttachmentSnapshot(); }
  isObjectType(ref, type) { return this.#engine.isObjectType(ref, type); }
  objectHasSubtype(ref, subtype) { return this.#engine.objectHasSubtype(ref, subtype); }
  canBlock(blockerRef, attackerRef) { return this.#engine.canBlock(blockerRef, attackerRef); }
  // Turn-order/relation queries are public game information and may name any
  // player; only private state/knowledge snapshot methods are self-scoped.
  opponents(playerId = this.playerId) { return this.#engine.opponents(playerId); }
  opponent(playerId = this.playerId) { return this.#engine.opponent(playerId); }
  nextPlayer(playerId) { return this.#engine.nextPlayer(playerId); }
  isActionLegal(playerId, action) { return this.#engine.isActionLegal(this._assertSelf(playerId), action); }

  submitAction(playerId, action) { return this.#engine.submitAction(this._assertSelf(playerId), action); }
  submitChoice(playerId, action) { return this.#engine.submitChoice(this._assertSelf(playerId), action); }
  passPriority(playerId = this.playerId) { return this.#engine.passPriority(this._assertSelf(playerId)); }

  recordAIDecision(record) { return this.#engine.recordAIDecision(this.playerId, record); }
  getAIDecisionLogSnapshot() { return this.#engine.getAIDecisionLogSnapshot(); }
}
