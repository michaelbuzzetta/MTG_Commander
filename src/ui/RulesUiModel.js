/**
 * Step 39 presentation-only view models.
 *
 * These helpers intentionally accept immutable engine snapshots / legal actions
 * and never decide Magic legality themselves. React can render the returned
 * metadata, but the rules engine remains the only authority for what can happen.
 */

function asArray(value) { return Array.isArray(value) ? value : []; }

export function buildLegalActionIndex(actions = []) {
  const byCard = new Map();
  const byPermanent = new Map();
  const byType = new Map();
  for (const action of asArray(actions)) {
    if (!action?.type) continue;
    const typed = byType.get(action.type) || [];
    typed.push(action);
    byType.set(action.type, typed);
    if (action.cardInstanceId) {
      const rows = byCard.get(action.cardInstanceId) || [];
      rows.push(action);
      byCard.set(action.cardInstanceId, rows);
    }
    if (action.permanentId) {
      const rows = byPermanent.get(action.permanentId) || [];
      rows.push(action);
      byPermanent.set(action.permanentId, rows);
    }
  }
  return { byCard, byPermanent, byType, all: asArray(actions) };
}

export function cardActionPresentation({ instanceId, zone = null, index, pendingChoice = false, targeting = false, hasPriority = true } = {}) {
  const legal = [
    ...(index?.byCard?.get(instanceId) || []),
    ...(index?.byPermanent?.get(instanceId) || [])
  ];
  if (legal.length) {
    const labels = [...new Set(legal.map(action => action.type.replaceAll('_', ' ').toLowerCase()))];
    return {
      state: 'legal',
      legal: true,
      actionCount: legal.length,
      actions: legal,
      tooltip: `Rules engine: legal now (${labels.join(', ')}).`
    };
  }
  if (pendingChoice) return { state: 'blocked', legal: false, actionCount: 0, actions: [], tooltip: 'Complete the current required choice first.' };
  if (targeting) return { state: 'blocked', legal: false, actionCount: 0, actions: [], tooltip: 'A target selection is currently in progress.' };
  if (!hasPriority && ['hand', 'command', 'battlefield'].includes(zone)) return { state: 'blocked', legal: false, actionCount: 0, actions: [], tooltip: 'You do not currently have priority for this action.' };
  return { state: 'neutral', legal: false, actionCount: 0, actions: [], tooltip: 'No legal action is currently exposed by the rules engine for this object.' };
}

function objectName(ref, db = {}, fallback = 'Object') {
  if (!ref) return fallback;
  return db[ref.cardId]?.name || ref.name || ref.cardId || fallback;
}

export function stackObjectLabel(item, db = {}) {
  if (!item) return 'Unknown stack object';
  if (item.type === 'ward') return `Ward — ${objectName(item.source, db, 'permanent')}`;
  if (item.type === 'spell') return objectName(item.card, db, 'Spell');
  if (item.type === 'trigger') return `${objectName(item.source, db, 'Source')} — triggered ability`;
  if (item.type === 'ability') return `${objectName(item.source, db, 'Source')} — activated ability`;
  return objectName(item.card || item.source, db, 'Spell or ability');
}

export function buildStackPriorityModel(view = {}, db = {}, playerLabel = id => id || 'Unknown', targetLabel = target => typeof target === 'string' ? target : (target?.id || target?.instanceId || target?.playerId || String(target))) {
  const bottomToTop = asArray(view.stackBottomToTop);
  const items = [...bottomToTop].reverse().map((item, displayIndex) => ({
    ...item,
    displayIndex,
    label: stackObjectLabel(item, db),
    controllerLabel: playerLabel(item.controller),
    targetLabels: asArray(item.targets).map(targetLabel)
  }));
  return {
    phase: view.phase || '',
    activePlayer: view.activePlayer || null,
    activePlayerLabel: playerLabel(view.activePlayer),
    priorityPlayer: view.priorityPlayer || null,
    priorityPlayerLabel: playerLabel(view.priorityPlayer),
    consecutivePasses: Number(view.consecutivePasses || 0),
    livingPlayers: asArray(view.livingPlayers),
    stackDepth: Number(view.stackDepth || items.length),
    items
  };
}

export function paymentPresentation(plan = null, state = {}, db = {}) {
  if (!plan) return null;
  const permanents = new Map();
  for (const player of Object.values(state.players || {})) {
    for (const permanent of player.battlefield || []) permanents.set(permanent.instanceId, permanent);
  }
  const sources = asArray(plan.activations).map(activation => {
    const permanent = permanents.get(activation.permanentId);
    const name = permanent ? (db[permanent.cardId]?.name || permanent.cardId) : activation.permanentId;
    const mana = Object.entries(activation.mana || {}).filter(([, amount]) => Number(amount) > 0).map(([symbol, amount]) => `${symbol}${Number(amount) > 1 ? `×${amount}` : ''}`).join(' ');
    return { id: activation.permanentId, label: `${name}${mana ? ` → ${mana}` : ''}`, requiresTap: activation.requiresTap !== false };
  });
  return {
    finalManaCost: plan.lockedCost?.finalManaCost || '',
    nonManaCosts: asArray(plan.lockedCost?.nonManaCosts),
    lifePayment: Number(plan.lifePayment || 0),
    sources,
    legacy: !!plan.legacy
  };
}

export function normalizeUnsupportedInteraction(error, context = {}) {
  const raw = error?.error || error || {};
  const message = String(raw.message || raw.reason || error || 'Unsupported interaction encountered.');
  const explicit = raw.code === 'UNSUPPORTED_INTERACTION'
    || raw.name === 'UnsupportedInteraction'
    || /unsupported|not supported|not implemented/i.test(message);
  if (!explicit) return null;
  return {
    title: raw.mode === 'sandbox' ? 'Sandbox approximation' : 'Unsupported interaction',
    message,
    diagnosticId: raw.diagnosticId || raw.diagnostic?.diagnosticId || raw.diagnostic?.id || context.diagnosticId || `ui-${Date.now().toString(36)}`,
    cardId: raw.cardId || null,
    cardName: context.cardName || raw.cardName || null,
    ability: context.ability || raw.ability || null,
    scriptNode: raw.scriptNode || null,
    rulesVersion: context.rulesVersion || raw.rulesVersion || null,
    gameId: raw.gameId || null,
    eventId: raw.eventId || null,
    stackObjectId: raw.stackObjectId || null,
    supportStatus: raw.supportStatus || null,
    suggestedSupportStatus: raw.suggestedSupportStatus || null,
    mode: raw.mode || null,
    rollback: raw.rollback || null,
    statisticsEligible: raw.statisticsEligible !== false,
    detail: raw.detail || raw.context || null
  };
}
