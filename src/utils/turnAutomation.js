const RESPONSE_ACTION_TYPES = new Set(['CAST_SPELL', 'CAST_COMMANDER', 'ACTIVATE_ABILITY']);
const COMBAT_RESPONSE_PHASES = new Set(['DECLARE_ATTACKERS', 'DECLARE_BLOCKERS']);

export function automationActor(engine) {
  const s = engine?.state;
  if (!s || s.winner) return null;
  return s.pendingChoice?.playerId || (s.pregame?.active ? s.pregame.currentPlayer : s.priorityPlayer);
}

export function meaningfulResponseActions(engine, playerId = 'player') {
  if (!engine?.state?.players?.[playerId] || engine.state.players[playerId].lost) return [];
  return engine.getLegalActions(playerId).filter(action => RESPONSE_ACTION_TYPES.has(action.type));
}

export function combatInvolvesPlayer(engine, playerId = 'player') {
  const s = engine?.state;
  if (!s?.combat?.attackers?.length) return false;
  return s.combat.attackers.some(attackerId => s.combat.attackTargets?.[attackerId] === playerId);
}

export function humanAutomationDecision(engine, {
  playerId = 'player',
  autoPass = true,
  holdPriority = false,
  skipNextPriority = false
} = {}) {
  const s = engine?.state;
  if (!s || s.winner || !s.started) return { mode: 'WAIT', reason: 'Game is not running.' };

  const actor = automationActor(engine);
  if (actor !== playerId) return { mode: 'WAIT', reason: 'Another player is acting.' };

  if (s.pregame?.active) return { mode: 'PAUSE', reason: 'Your opening-hand decision is required.', kind: 'choice' };
  if (s.pendingChoice?.playerId === playerId) return { mode: 'PAUSE', reason: 'A game effect requires your choice.', kind: 'choice' };
  if (s.turnActionPending === 'DECLARE_ATTACKERS' && s.activePlayer === playerId) return { mode: 'PAUSE', reason: 'Declare your attackers.', kind: 'turn-action' };
  if (s.turnActionPending === 'DECLARE_BLOCKERS' && s.combat.currentDefender === playerId) return { mode: 'PAUSE', reason: 'You are being attacked. Declare blockers.', kind: 'blockers' };

  // The human player's own turn remains deliberately manual. Automation only
  // drives opponents and their priority passes.
  if (s.activePlayer === playerId) return { mode: 'PAUSE', reason: 'Your turn is manual.', kind: 'your-turn' };
  if (s.priorityPlayer !== playerId) return { mode: 'WAIT', reason: 'You do not have priority.' };

  if (skipNextPriority) return { mode: 'AUTO_PASS', reason: 'Resume after your response.', kind: 'resume' };
  if (!autoPass) return { mode: 'PAUSE', reason: 'Auto-pass is off. You have priority.', kind: 'manual-priority' };
  if (holdPriority) return { mode: 'PAUSE', reason: 'Priority held. Act now or pass to resume the AI turn.', kind: 'held-priority' };

  const responses = meaningfulResponseActions(engine, playerId);
  if (!responses.length) return { mode: 'AUTO_PASS', reason: 'No meaningful legal response is available.', kind: 'no-response' };

  if (s.stack?.length) {
    return {
      mode: 'PAUSE',
      reason: 'A spell or ability is on the stack and you have a legal response.',
      kind: 'stack-response',
      actions: responses
    };
  }

  if (COMBAT_RESPONSE_PHASES.has(s.phase) && combatInvolvesPlayer(engine, playerId) && !s.turnActionPending) {
    return {
      mode: 'PAUSE',
      reason: 'Combat involving you is waiting and you have a legal instant-speed action.',
      kind: 'combat-response',
      actions: responses
    };
  }

  return { mode: 'AUTO_PASS', reason: 'No event requires a response.', kind: 'routine-priority' };
}
