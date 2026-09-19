import db from '../src/data/generated/cards.json' with { type: 'json' };
import decks from '../src/data/generated/decks.json' with { type: 'json' };
import { GameEngine } from '../src/engine/GameEngine.js';
import { makeCardInstance } from '../src/engine/GameState.js';
export { db, decks };

export function rawEngine(a = 'explorers', b = 'blech') {
  const x = decks.find(d => d.id === a), y = decks.find(d => d.id === b);
  const e = new GameEngine(x, y, db, { rng: () => 0.42 });
  e.start();
  return e;
}

export function engine(a = 'explorers', b = 'blech') {
  const e = rawEngine(a, b);
  e.perform('player', { type: 'KEEP_HAND' });
  e.perform('ai', { type: 'KEEP_HAND' });
  return e;
}

export function putBattlefield(e, pid, cardId, extra = {}) {
  const p = e.state.players[pid];
  const definition = e.db?.[cardId] || db?.[cardId] || {};
  const c = makeCardInstance(cardId, pid, 'battlefield', {
    controller: pid,
    tapped: false,
    summoningSick: false,
    counters: {},
    damageMarked: 0,
    attacking: false,
    blocking: null,
    modifiers: { power: 0, toughness: 0, keywords: [] },
    createdTurn: e.state.turn,
    controlledSinceTurn: e.state.turn,
    ...extra
  }, definition);
  p.battlefield.push(c);
  return c;
}

export function setPhase(e, phase, { activePlayer = 'player', priorityPlayer = activePlayer, turnActionPending = null } = {}) {
  e.state.activePlayer = activePlayer;
  e.state.phase = phase;
  e.state.phaseIndex = ['UNTAP','UPKEEP','DRAW','PRECOMBAT_MAIN','BEGIN_COMBAT','DECLARE_ATTACKERS','DECLARE_BLOCKERS','FIRST_STRIKE_DAMAGE','COMBAT_DAMAGE','END_COMBAT','POSTCOMBAT_MAIN','END_STEP','CLEANUP'].indexOf(phase);
  e.state.priorityPlayer = priorityPlayer;
  e.state.turnActionPending = turnActionPending;
  e.state.passes = 0;
  e.state.stack = [];
}

export function relocateZone(e, playerId, fromZone, toZone = 'library') {
  const player = e.state.players[playerId];
  if (!player) throw new Error(`Unknown player ${playerId}`);
  const cards = [...player[fromZone]];
  for (const card of cards) e.zones.move(card.instanceId, toZone, playerId);
  return cards.length;
}
