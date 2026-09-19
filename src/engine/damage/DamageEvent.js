function refId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return value.instanceId || value.gameObjectId || value.id || null;
}

function bool(value, fallback = false) { return value == null ? fallback : !!value; }

function normalizeRecipient(engine, input = {}) {
  const playerId = input.targetPlayer || (input.recipientKind === 'player' ? refId(input.recipient) : null);
  if (playerId && engine.state.players[playerId]) return { kind: 'player', id: playerId, object: engine.state.players[playerId] };
  const targetRef = input.targetId || input.target || (input.recipientKind === 'permanent' ? input.recipient : null);
  const id = refId(targetRef);
  const object = id ? engine.findPermanent(id) : null;
  if (object) return { kind: 'permanent', id: object.instanceId, object };
  return null;
}

function sourceRefForPayload(source) { return refId(source); }

function sourceSnapshot(engine, source) {
  if (!source) return null;
  const live = refId(source) ? (engine._queryObject(refId(source)) || source) : source;
  try { return structuredClone(live); } catch { return source; }
}

/**
 * Step 26 normalized representation of one damage event after replacement and
 * prevention have finished but before recipient-specific consequences commit.
 */
export class DamageEvent {
  constructor(fields = {}) {
    Object.assign(this, fields);
    Object.freeze(this.properties);
    Object.freeze(this.recipient);
    Object.freeze(this);
  }

  static fromEngineEvent(engine, event) {
    const p = event.payload || {};
    const recipient = normalizeRecipient(engine, p);
    if (!recipient) throw new Error('Damage recipient is no longer available');
    const source = p.source ? (engine._queryObject(refId(p.source)) || p.source) : null;
    const finalSourceId = refId(source);
    const sourceChanged = !!p.damageSourceId && finalSourceId !== p.damageSourceId;
    const sourceController = sourceChanged ? (source?.controller || null) : (p.sourceController || source?.controller || p.sourceSnapshot?.controller || null);
    const explicit = p.damageProperties || {};
    const explicitKeys = new Set(p.explicitDamageProperties || []);
    const derive = (key, fallback) => explicitKeys.has(key) ? bool(explicit[key], fallback) : (sourceChanged ? fallback : bool(explicit[key] ?? p[key], fallback));
    const properties = {
      deathtouch: derive('deathtouch', source ? engine.mechanics.hasDeathtouch(source) : false),
      lifelink: derive('lifelink', source ? engine.mechanics.hasLifelink(source) : false),
      infect: derive('infect', source ? engine.mechanics.hasInfect(source) : false),
      wither: derive('wither', source ? engine.mechanics.hasWither(source) : false)
    };
    return new DamageEvent({
      eventId: event.eventId || null,
      parentEventId: event.provenance?.parentEventId || p.parentEventId || null,
      source,
      sourceSnapshot: sourceSnapshot(engine, source || p.sourceSnapshot),
      sourceController,
      sourceOwner: source?.owner || p.sourceSnapshot?.owner || p.sourceOwner || null,
      commanderIdentity: sourceChanged ? (source ? engine.commanders.identity(source) : null) : (p.commanderIdentity || (source ? engine.commanders.identity(source) : null)),
      recipient: { kind: recipient.kind, id: recipient.id },
      recipientObject: recipient.object,
      amount: Math.max(0, Number(p.amount || 0)),
      preventedAmount: Math.max(0, Number(p.preventedAmount || 0)),
      combat: !!p.combat,
      preventable: p.preventable !== false && p.unpreventable !== true,
      damageType: p.damageTypeExplicit ? (p.damageType || (p.combat ? 'combat' : 'noncombat')) : (p.combat ? 'combat' : 'noncombat'),
      properties,
      batchId: p.batchId || null,
      batchIndex: Number.isInteger(p.batchIndex) ? p.batchIndex : null,
      batchSize: Number.isInteger(p.batchSize) ? p.batchSize : null,
      metadata: structuredClone(p.damageMetadata || {})
    });
  }

  static request(engine, input = {}, options = {}) {
    const recipient = normalizeRecipient(engine, input);
    if (!recipient) throw new Error('Damage recipient is no longer available');
    const source = input.source ? (engine._queryObject(refId(input.source)) || input.source) : null;
    const sourceController = input.sourceController || source?.controller || null;
    const commanderIdentity = input.commanderIdentity || (source ? engine.commanders.identity(source) : null);
    const direct = ['deathtouch','lifelink','infect','wither'].filter(key => Object.prototype.hasOwnProperty.call(input, key));
    const explicitDamageProperties = [...new Set([...Object.keys(input.damageProperties || {}), ...direct])];
    const properties = {
      deathtouch: input.damageProperties?.deathtouch ?? input.deathtouch ?? (source ? engine.mechanics.hasDeathtouch(source) : false),
      lifelink: input.damageProperties?.lifelink ?? input.lifelink ?? (source ? engine.mechanics.hasLifelink(source) : false),
      infect: input.damageProperties?.infect ?? input.infect ?? (source ? engine.mechanics.hasInfect(source) : false),
      wither: input.damageProperties?.wither ?? input.wither ?? (source ? engine.mechanics.hasWither(source) : false)
    };
    const payload = {
      amount: Math.max(0, Number(input.amount || 0)),
      source,
      sourceController,
      sourceOwner: source?.owner || input.sourceOwner || null,
      sourceSnapshot: sourceSnapshot(engine, source),
      commanderIdentity,
      damageSourceId: sourceRefForPayload(source),
      explicitDamageProperties,
      combat: !!input.combat,
      damageType: input.damageType || (input.combat ? 'combat' : 'noncombat'),
      damageTypeExplicit: input.damageType != null,
      preventable: input.preventable !== false,
      damageProperties: properties,
      batchId: options.batchId || input.batchId || null,
      batchIndex: options.batchIndex ?? input.batchIndex ?? null,
      batchSize: options.batchSize ?? input.batchSize ?? null,
      damageMetadata: structuredClone(input.damageMetadata || {})
    };
    if (recipient.kind === 'player') payload.targetPlayer = recipient.id;
    else payload.targetId = recipient.id;
    return payload;
  }

  snapshot() {
    return {
      eventId: this.eventId,
      parentEventId: this.parentEventId,
      sourceId: refId(this.source) || refId(this.sourceSnapshot),
      sourceController: this.sourceController,
      sourceOwner: this.sourceOwner,
      commanderIdentity: this.commanderIdentity,
      recipient: structuredClone(this.recipient),
      amount: this.amount,
      preventedAmount: this.preventedAmount,
      combat: this.combat,
      damageType: this.damageType,
      properties: structuredClone(this.properties),
      batchId: this.batchId,
      batchIndex: this.batchIndex,
      batchSize: this.batchSize,
      metadata: structuredClone(this.metadata)
    };
  }
}
