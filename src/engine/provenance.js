function objectId(value) {
  if (!value || typeof value !== 'object') return null;
  return value.instanceId || value.gameObjectId || value.id || null;
}

function collectAffected(payload = {}) {
  const candidates = [
    payload.target,
    payload.object,
    payload.card,
    payload.permanent,
    payload.recipient,
    ...(Array.isArray(payload.targets) ? payload.targets : [])
  ];
  const ids = [];
  for (const candidate of candidates) {
    if (typeof candidate === 'string') ids.push(candidate);
    else {
      const id = objectId(candidate);
      if (id) ids.push(id);
    }
  }
  for (const key of ['cardInstanceId', 'permanentId', 'targetId', 'objectId']) {
    if (payload[key]) ids.push(String(payload[key]));
  }
  if (payload.playerId) ids.push(`player:${payload.playerId}`);
  if (payload.targetPlayer) ids.push(`player:${payload.targetPlayer}`);
  return [...new Set(ids)];
}

export function buildEventProvenance(engine, payload = {}, { parentEventId = null, cause = null } = {}) {
  const source = payload.source || payload.sourceObject || payload.card || payload.object || null;
  return {
    sourceObjectId: objectId(source),
    sourceController: payload.sourceController || source?.controller || payload.controller || null,
    affected: collectAffected(payload),
    cause: cause || payload.cause || (engine._activeActionContext?.actionType ? `action:${engine._activeActionContext.actionType}` : null),
    parentEventId,
    turn: engine.state.turn,
    phase: engine.state.phase,
    activePlayer: engine.state.activePlayer,
    priorityPlayer: engine.state.priorityPlayer,
    actionSequence: engine._activeActionContext?.sequence || engine._actionSequence || 0,
    actionType: engine._activeActionContext?.actionType || null,
    actingPlayer: engine._activeActionContext?.playerId || null
  };
}

export function summarizeEventPayload(payload = {}) {
  const summary = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) {
      summary[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      summary[key] = value.map(item => {
        if (item == null || ['string', 'number', 'boolean'].includes(typeof item)) return item;
        return objectId(item) || '[object]';
      });
      continue;
    }
    const id = objectId(value);
    summary[key] = id || '[object]';
  }
  return summary;
}

export function summarizeEventResult(result) {
  if (result == null || ['string', 'number', 'boolean'].includes(typeof result)) return result;
  if (Array.isArray(result)) return result.map(value => objectId(value) || value?.cardId || '[object]');
  if (typeof result === 'object') {
    const id = objectId(result);
    if (id) return id;
    const summary = {};
    for (const key of ['amount', 'prevented', 'combat', 'targetPlayer', 'fromZone', 'toZone', 'count']) {
      if (key in result) summary[key] = result[key];
    }
    return Object.keys(summary).length ? summary : '[object]';
  }
  return String(result);
}
