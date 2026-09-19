import { makeCardInstance } from '../GameState.js';
import { ENGINE_EVENT } from '../events/index.js';
import { TokenRegistry } from './TokenRegistry.js';

function count(value) { return Math.max(0, Math.floor(Number(value) || 0)); }
function refId(ref) { return typeof ref === 'string' ? ref : (ref?.instanceId || ref?.gameObjectId || ref?.id || null); }

export class TokenService {
  constructor(engine, registry = new TokenRegistry()) {
    this.engine = engine;
    this.registry = registry;
  }

  resolveDefinition(ref, options = {}) { return this.registry.resolve(ref, options); }
  getDefinition(ref) { return this.registry.get(ref); }
  registrySnapshot() { return this.registry.snapshot(); }

  buildPayload(playerId, token, amount = 1, options = {}) {
    const definition = this.resolveDefinition(token, { namespace: options.namespace || null });
    return {
      playerId,
      controller: playerId,
      amount: count(amount),
      tokenDefinition: definition,
      source: options.source || null,
      sourceController: options.sourceController || options.source?.controller || playerId,
      entryCounters: structuredClone(options.entryCounters || []),
      attachmentTargetId: refId(options.attachTo || options.attachmentTargetId),
      tokenEntryState: structuredClone(options.entryState || {}),
      tokenCopyMetadata: options.tokenCopyMetadata ? structuredClone(options.tokenCopyMetadata) : null
    };
  }

  create(playerId, token, amount = 1, options = {}) {
    const payload = this.buildPayload(playerId, token, amount, options);
    if (options.skipReplacements) return this.engine.events.dispatch(ENGINE_EVENT.CREATE_TOKEN, payload, { cause: options.cause || 'create-token', stabilize: options.stabilize ?? false, skipReplacements: true });
    return this.engine.replacements.dispatchWithChoice(ENGINE_EVENT.CREATE_TOKEN, payload, {
      cause: options.cause || 'create-token', stabilize: options.stabilize ?? false,
      affectedPlayerId: playerId, replacementOrder: options.replacementOrder || null
    });
  }

  createFromCopiableValues(playerId, values, amount = 1, options = {}) {
    const definition = this.registry.fromCopiableValues(values, { namespace: options.namespace || 'copy', modifications: values?.copyModifications || null });
    return this.create(playerId, definition, amount, {
      ...options,
      cause: options.cause || 'create-token-copy',
      tokenCopyMetadata: { copiableValues: structuredClone(values), ...(options.tokenCopyMetadata || {}) }
    });
  }

  validateCreate(payload = {}) {
    if (!this.engine.state.players[payload.playerId]) throw new Error(`Unknown player ${payload.playerId}`);
    const batches = payload.tokenBatches || [{ amount: payload.amount, tokenDefinition: payload.tokenDefinition }];
    if (!batches.length) throw new Error('Token event requires at least one token batch');
    for (const batch of batches) {
      if (!(Number(batch.amount) >= 0)) throw new Error('Token amount must be nonnegative');
      this.resolveDefinition(batch.tokenDefinition || batch.tokenDefinitionId || batch.tokenName);
    }
    return true;
  }

  commitCreate(payload = {}) {
    const playerId = payload.playerId;
    const hasExplicitBatches = Array.isArray(payload.tokenBatches);
    const batches = payload.tokenBatches || [{ amount: payload.amount, tokenDefinition: payload.tokenDefinition }];
    const created = [];
    for (const batch of batches) {
      const definition = this.resolveDefinition(batch.tokenDefinition || batch.tokenDefinitionId || batch.tokenName);
      this.engine._registerRuntimeCardDefinition(definition.id, { ...structuredClone(definition), id: definition.id, spellEffects: definition.spellEffects || [] }, { internal: true, reason: 'token-definition-materialization' });
      for (let index = 0; index < count(batch.amount); index++) {
        const entryState = { ...(payload.tokenEntryState || {}), ...(hasExplicitBatches ? (batch.entryState || {}) : {}) };
        const card = makeCardInstance(definition.id, playerId, 'battlefield', {
          controller: playerId,
          isToken: true,
          tokenDefinitionId: definition.id,
          tokenSourceId: refId(payload.source),
          summoningSick: (definition.types || []).some(type => String(type).toLowerCase() === 'creature') || /(?:^|\s)Creature(?:\s|—|$)/i.test(definition.typeLine || ''),
          createdTurn: this.engine.state.turn,
          controlledSinceTurn: this.engine.state.turn,
          ...entryState
        }, this.engine.db[definition.id]);
        this.engine.zones.place(card, 'battlefield', playerId);
        card.summoningSick = this.engine.static.isType(card, 'Creature');
        card.createdTurn = this.engine.state.turn;
        card.controlledSinceTurn = this.engine.state.turn;

        const copyMetadata = (hasExplicitBatches ? batch.tokenCopyMetadata : null) || payload.tokenCopyMetadata;
        if (copyMetadata) {
          card.copyMetadata = { isTokenCopy: true, copiableValues: structuredClone(copyMetadata.copiableValues || null) };
          if (copyMetadata.tapped) card.tapped = true;
          if (copyMetadata.attacking) {
            card.attacking = true;
            card.attackTarget = copyMetadata.attackTarget || null;
            if (!this.engine.state.combat.attackers.includes(card.instanceId)) this.engine.state.combat.attackers.push(card.instanceId);
            if (card.attackTarget) this.engine.state.combat.attackTargets[card.instanceId] = card.attackTarget;
          }
          if (copyMetadata.sacrificeAtEndTurn) card.sacrificeAtEndTurn = this.engine.state.turn;
          if (copyMetadata.exileAtEndCombat) card.exileAtEndCombat = true;
        }

        const entryCounters = [...(payload.entryCounters || []), ...(hasExplicitBatches ? (batch.entryCounters || []) : [])];
        for (const counter of entryCounters) {
          const n = Math.max(0, Number(counter.amount || 0));
          if (n > 0) this.engine.counters.add(card, counter.type || counter.counterType || '+1/+1', n, { source: payload.source || null, cause: 'token-entry-counter' });
        }

        const attachmentTargetId = (hasExplicitBatches ? batch.attachmentTargetId : null) || payload.attachmentTargetId;
        if (attachmentTargetId) this.engine.attachments.attach(card, attachmentTargetId, { reason: 'token-created-attached', attachmentType: this.engine.attachments.kind(card) });

        created.push(card);
        this.engine.emit('TOKEN_CREATED', { controller: playerId, target: card, copy: !!copyMetadata, source: payload.source || null, tokenDefinitionId: definition.id });
        this.engine.emit('ENTER_BATTLEFIELD', { controller: playerId, target: card, copy: !!copyMetadata, source: payload.source || null });
      }
    }
    return created;
  }
}
