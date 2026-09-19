function clone(value) {
  try { return structuredClone(value); } catch { return value; }
}

function idOf(value) {
  if (!value || typeof value !== 'object') return null;
  return value.instanceId || value.gameObjectId || value.id || null;
}

function isFiniteNumberish(value) {
  return typeof value !== 'number' || Number.isFinite(value);
}

export class InvariantViolationError extends Error {
  constructor(failures, context = {}) {
    const summary = failures.slice(0, 3).map(f => f.message).join('; ');
    super(`Runtime invariant violation${summary ? `: ${summary}` : ''}`);
    this.name = 'InvariantViolationError';
    this.code = 'INVARIANT_VIOLATION';
    this.failures = clone(failures);
    this.context = clone(context);
  }
}

/**
 * Step 32 development/simulation guardrail.
 *
 * Invariants are evaluated only at stable transaction boundaries. The checker
 * intentionally does not run inside an event commit where Magic may briefly
 * pass through a state that an SBA will immediately repair.
 */
export class InvariantChecker {
  constructor(engine, { enabled = true, throwOnFailure = true, maxFailures = 100 } = {}) {
    this.engine = engine;
    this.enabled = !!enabled;
    this.throwOnFailure = throwOnFailure !== false;
    this.maxFailures = Math.max(1, Number(maxFailures) || 100);
    this.checkSequence = 0;
    this.lastReport = null;
    this.lastFailure = null;
    // Snapshot the physical, non-token cards that exist when the engine is
    // constructed. A normal Magic card can move between zones and gain a new
    // gameObjectId, but its physical instanceId must not silently disappear.
    this.expectedPhysicalCards = new Map();
    for (const row of this._allZoneObjects()) {
      const object = row.object;
      if (!object?.instanceId || object.isToken || object.token || object.isCopy) continue;
      this.expectedPhysicalCards.set(object.instanceId, {
        owner: object.owner || row.playerId || null,
        cardId: object.cardId || null
      });
    }
  }

  setEnabled(enabled) { this.enabled = !!enabled; return this.enabled; }

  _fail(failures, code, message, detail = {}) {
    if (failures.length >= this.maxFailures) return;
    failures.push({ code, message, detail: clone(detail) });
  }

  _allZoneObjects() {
    const state = this.engine.state;
    const zones = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'];
    const rows = [];
    for (const [playerId, player] of Object.entries(state.players || {})) {
      for (const zone of zones) {
        for (const object of player?.[zone] || []) rows.push({ playerId, zone, object });
      }
    }
    for (const stackItem of state.stack || []) {
      if (stackItem?.type === 'spell' && stackItem.card && !stackItem.isCopy) {
        rows.push({ playerId: stackItem.controller || stackItem.card.owner || null, zone: 'stack', object: stackItem.card, stackItemId: stackItem.id });
      }
    }
    // A resolving spell can be temporarily removed from state.stack while an
    // engine ChoiceRequest is pending. It is still the authoritative spell
    // object on the stack for rules/inventory purposes until resolution ends.
    const pendingItem = state.pendingResolution?.item;
    const pendingCard = pendingItem?.type === 'spell' && pendingItem.card && !pendingItem.isCopy ? pendingItem.card : null;
    const pendingAlreadyListed = pendingCard && rows.some(row => row.object?.instanceId === pendingCard.instanceId);
    if (pendingCard && !pendingAlreadyListed) {
      rows.push({
        playerId: pendingItem.controller || pendingCard.owner || null,
        zone: 'stack',
        object: pendingCard,
        stackItemId: pendingItem.id || null,
        pendingResolution: true
      });
    }
    return rows;
  }

  _checkZoneUniqueness(failures) {
    const seen = new Map();
    const gameObjectIds = new Map();
    for (const row of this._allZoneObjects()) {
      const object = row.object;
      const instanceId = object?.instanceId;
      if (!instanceId) {
        this._fail(failures, 'OBJECT_MISSING_INSTANCE_ID', 'A card/token object in a zone has no instanceId.', { playerId: row.playerId, zone: row.zone, cardId: object?.cardId || null });
        continue;
      }
      if (object.gameObjectId) {
        const current = gameObjectIds.get(object.gameObjectId) || [];
        current.push({ instanceId, playerId: row.playerId, zone: row.zone });
        gameObjectIds.set(object.gameObjectId, current);
      }
      const positions = seen.get(instanceId) || [];
      positions.push({ playerId: row.playerId, zone: row.zone, stackItemId: row.stackItemId || null });
      seen.set(instanceId, positions);
      if (object.zone !== row.zone) {
        this._fail(failures, 'OBJECT_ZONE_MISMATCH', `Object ${instanceId} says it is in ${object.zone} but is stored in ${row.zone}.`, { instanceId, declaredZone: object.zone, actualZone: row.zone });
      }
    }
    for (const [instanceId, positions] of seen.entries()) {
      if (positions.length > 1) this._fail(failures, 'OBJECT_IN_MULTIPLE_ZONES', `Physical object ${instanceId} appears in more than one zone.`, { instanceId, positions });
    }
    for (const [gameObjectId, positions] of gameObjectIds.entries()) {
      if (positions.length > 1) this._fail(failures, 'DUPLICATE_GAME_OBJECT_ID', `Active objects share gameObjectId ${gameObjectId}.`, { gameObjectId, positions });
    }
    for (const [instanceId, expected] of this.expectedPhysicalCards.entries()) {
      // Eliminating a player intentionally removes objects they own from the game.
      if (expected.owner && this.engine.state.players?.[expected.owner]?.lost) continue;
      if (!seen.has(instanceId)) this._fail(failures, 'PHYSICAL_CARD_DISAPPEARED', `Physical card ${instanceId} is not present in any authoritative zone.`, { instanceId, owner: expected.owner, cardId: expected.cardId });
    }
  }

  _checkStack(failures) {
    const state = this.engine.state;
    const stackIds = new Set();
    const stackObjectIds = new Set();
    for (const item of state.stack || []) {
      if (!item?.id) this._fail(failures, 'STACK_ITEM_MISSING_ID', 'A stack object has no stable id.', { item });
      else if (stackIds.has(item.id)) this._fail(failures, 'DUPLICATE_STACK_ID', `Duplicate stack id ${item.id}.`, { id: item.id });
      else stackIds.add(item.id);
      if (!item?.gameObjectId) this._fail(failures, 'STACK_ITEM_MISSING_OBJECT_ID', 'A stack object has no gameObjectId.', { id: item?.id || null });
      else if (stackObjectIds.has(item.gameObjectId)) this._fail(failures, 'DUPLICATE_STACK_OBJECT_ID', `Duplicate stack gameObjectId ${item.gameObjectId}.`, { gameObjectId: item.gameObjectId });
      else stackObjectIds.add(item.gameObjectId);
      if (!state.players?.[item?.controller]) this._fail(failures, 'STACK_CONTROLLER_MISSING', `Stack object ${item?.id || '?'} references missing controller ${item?.controller}.`, { itemId: item?.id || null, controller: item?.controller || null });
      if (item?.type === 'spell' && !item.isCopy && !item.card) this._fail(failures, 'SPELL_MISSING_CARD', `Spell ${item?.id || '?'} has no card object.`, { itemId: item?.id || null });
    }
  }

  _checkPlayersTurnPriority(failures) {
    const state = this.engine.state;
    const order = state.playerOrder || [];
    const playerIds = Object.keys(state.players || {});
    if (!order.length) this._fail(failures, 'EMPTY_TURN_ORDER', 'Player turn order is empty.');
    if (new Set(order).size !== order.length) this._fail(failures, 'DUPLICATE_TURN_ORDER_PLAYER', 'Turn order contains duplicate player ids.', { playerOrder: order });
    for (const id of order) if (!state.players?.[id]) this._fail(failures, 'TURN_ORDER_UNKNOWN_PLAYER', `Turn order references missing player ${id}.`, { playerId: id });
    for (const id of playerIds) {
      const p = state.players[id];
      if (p?.id !== id) this._fail(failures, 'PLAYER_ID_MISMATCH', `Player map key ${id} does not match player.id ${p?.id}.`, { key: id, id: p?.id || null });
    }
    if (state.activePlayer && !state.players?.[state.activePlayer]) this._fail(failures, 'INVALID_ACTIVE_PLAYER', `Active player ${state.activePlayer} does not exist.`, { activePlayer: state.activePlayer });
    if (state.priorityPlayer) {
      const priority = state.players?.[state.priorityPlayer];
      if (!priority) this._fail(failures, 'INVALID_PRIORITY_PLAYER', `Priority player ${state.priorityPlayer} does not exist.`, { priorityPlayer: state.priorityPlayer });
      else if (priority.lost) this._fail(failures, 'ELIMINATED_PLAYER_HAS_PRIORITY', `Eliminated player ${state.priorityPlayer} has priority.`, { priorityPlayer: state.priorityPlayer });
    }
    // In multiplayer, the active player can legally leave the game during
    // their own turn. The turn continues without that player until the next
    // normal turn begins (CR 800 multiplayer semantics), while priority must
    // skip eliminated players. Therefore an eliminated activePlayer is not,
    // by itself, an invariant violation.
  }

  _checkAttachments(failures) {
    for (const relation of this.engine.state.attachments || []) {
      const attached = this.engine._queryObject?.(relation.attachedId || relation.attachedGameObjectId);
      const host = relation.hostKind === 'player'
        ? this.engine.state.players?.[relation.hostId]
        : this.engine._queryObject?.(relation.hostId || relation.hostGameObjectId);
      if (!attached) this._fail(failures, 'ATTACHMENT_SOURCE_MISSING', `Attachment ${relation.id || '?'} references a missing attached object.`, { relation });
      if (!host) this._fail(failures, 'ATTACHMENT_HOST_MISSING', `Attachment ${relation.id || '?'} references a missing host.`, { relation });
      if (attached && attached.zone !== 'battlefield') this._fail(failures, 'ATTACHMENT_SOURCE_NOT_BATTLEFIELD', `Attached object ${attached.instanceId} is not on the battlefield.`, { relationId: relation.id, zone: attached.zone });
      // Invariant checks are run only at stable transaction boundaries, after
      // SBAs have had the chance to detach/clean up illegal relationships.
      if (attached && host && this.engine.attachments?.relationshipLegal && !this.engine.attachments.relationshipLegal(relation)) {
        this._fail(failures, 'ILLEGAL_ATTACHMENT_RELATIONSHIP', `Attachment ${relation.id || '?'} has an illegal host at a stable boundary.`, { relation });
      }
    }
  }

  _checkNumericState(failures) {
    for (const [playerId, player] of Object.entries(this.engine.state.players || {})) {
      for (const [field, value] of Object.entries({ life: player.life, landPlaysRemaining: player.landPlaysRemaining, mulligans: player.mulligans })) {
        if (!isFiniteNumberish(value)) this._fail(failures, 'INVALID_NUMERIC_PLAYER_STATE', `${playerId}.${field} is not finite.`, { playerId, field, value });
      }
      for (const row of this._allZoneObjects().filter(r => r.playerId === playerId)) {
        const object = row.object;
        for (const [field, value] of Object.entries({ damageMarked: object?.damageMarked, zoneChangeId: object?.zoneChangeId })) {
          if (!isFiniteNumberish(value)) this._fail(failures, 'INVALID_NUMERIC_OBJECT_STATE', `${object?.instanceId || '?'} ${field} is not finite.`, { instanceId: object?.instanceId || null, field, value });
        }
        if (row.zone === 'battlefield' && this.engine.continuous?.characteristics) {
          try {
            const derived = this.engine.continuous.characteristics(object);
            for (const field of ['power', 'toughness', 'loyalty', 'defense', 'manaValue']) {
              const value = derived?.[field];
              if (typeof value === 'number' && !Number.isFinite(value)) this._fail(failures, 'INVALID_DERIVED_CHARACTERISTIC', `Derived ${field} for ${object.instanceId} is not finite.`, { instanceId: object.instanceId, field, value });
            }
          } catch (error) {
            this._fail(failures, 'DERIVED_CHARACTERISTIC_FAILURE', `Derived characteristics failed for ${object?.instanceId || '?'}.`, { instanceId: object?.instanceId || null, error: error?.message || String(error) });
          }
        }
      }
    }
  }

  _checkUnsupportedRuntimeNodes(failures) {
    const visit = (value, path, seen = new Set(), depth = 0) => {
      if (value == null || depth > 10 || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      const type = String(value.type || '').toLowerCase();
      if (value.unsupported === true || type === 'unsupported' || type === 'unsupported-node') {
        this._fail(failures, 'UNSUPPORTED_RUNTIME_NODE', `Unsupported script/effect node is present at ${path}.`, { path, type: value.type || null });
      }
      if (Array.isArray(value)) value.forEach((v, i) => visit(v, `${path}[${i}]`, seen, depth + 1));
      else for (const [key, nested] of Object.entries(value)) visit(nested, `${path}.${key}`, seen, depth + 1);
    };
    visit(this.engine.state.stack || [], 'state.stack');
    visit(this.engine.state.pendingChoice, 'state.pendingChoice');
    visit(this.engine.state.pendingResolution, 'state.pendingResolution');
  }

  check({ boundary = 'manual', throwOnFailure = this.throwOnFailure } = {}) {
    if (!this.enabled) return { ok: true, skipped: true, boundary, failures: [] };
    const failures = [];
    this._checkZoneUniqueness(failures);
    this._checkStack(failures);
    this._checkPlayersTurnPriority(failures);
    this._checkAttachments(failures);
    this._checkNumericState(failures);
    this._checkUnsupportedRuntimeNodes(failures);
    const report = {
      ok: failures.length === 0,
      sequence: ++this.checkSequence,
      boundary,
      turn: this.engine.state.turn,
      phase: this.engine.state.phase,
      actionSequence: this.engine._actionSequence || 0,
      eventSequence: this.engine.events?.sequenceCursor || 0,
      stateHash: (() => { try { return this.engine.replay?.stateHash?.() || null; } catch { return null; } })(),
      failures
    };
    this.lastReport = clone(report);
    if (!report.ok) {
      const error = new InvariantViolationError(failures, { boundary, turn: report.turn, phase: report.phase, actionSequence: report.actionSequence });
      this.engine.logger?.recordDeveloper?.('invariant-failure', error.message, report);
      let diagnosticBundle = null;
      try {
        diagnosticBundle = this.engine.logger?.diagnosticBundle?.({ includeState: true, includeReplay: true }) || null;
      } catch (bundleError) {
        diagnosticBundle = {
          schema: 'mtg-commander-invariant-crash-bundle',
          schemaVersion: 1,
          reproduction: {
            seed: this.engine.random?.snapshot?.().seed ?? null,
            turn: this.engine.state.turn,
            phase: this.engine.state.phase,
            actionIndex: this.engine._actionSequence || 0,
            eventIndex: this.engine.events?.sequenceCursor || 0,
            rulesVersion: this.engine.rulesVersion || null,
            cardDatabaseVersion: this.engine.cardDatabaseVersion || null,
            stateHash: report.stateHash
          },
          invariantReport: clone(report),
          logs: {
            player: this.engine.logger?.playerLog?.() || [],
            developer: this.engine.logger?.developerLog?.() || [],
            verbose: this.engine.logger?.verboseTrace?.() || []
          },
          eventLog: this.engine.events?.getLogSnapshot?.() || [],
          state: clone(this.engine.state),
          bundleError: bundleError?.message || String(bundleError)
        };
      }
      this.lastFailure = { report: clone(report), diagnosticBundle };
      if (throwOnFailure) throw error;
    }
    return clone(report);
  }
}
