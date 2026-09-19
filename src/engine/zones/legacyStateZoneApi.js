import { beginNewObjectIncarnation, ensureCanonicalCardObject } from '../state/GameObject.js';
import { PLAYER_ZONES } from './ZoneTypes.js';

function matchesId(card, id) { return card?.instanceId === id || card?.gameObjectId === id; }

function reset(card, toZone, destinationPlayerId, definition = {}) {
  ensureCanonicalCardObject(card, definition);
  beginNewObjectIncarnation(card, toZone, destinationPlayerId, definition);
  card.tapped = false;
  card.summoningSick = false;
  card.counters = {};
  card.damageMarked = 0;
  card.damagePrevention = 0;
  card.deathtouchMarked = false;
  card.attacking = false;
  card.attackTarget = null;
  card.blocking = null;
  card.modifiers = { power: 0, toughness: 0, keywords: [] };
  card.createdTurn = null;
  card.controlledSinceTurn = null;
  card.chosenType = null;
  card.attachedTo = null;
  card.phasedOut = false;
  card.foretold = false;
  card.faceDown = false;
  card.exiledBy = null;
  card.castMode = null;
  return card;
}

export function legacyFind(state, id) {
  for (const player of Object.values(state.players)) {
    for (const zone of PLAYER_ZONES) {
      const index = player[zone].findIndex(card => matchesId(card, id));
      if (index >= 0) return { player, playerId: player.id, zone, index, card: player[zone][index] };
    }
  }
  const index = state.stack.findIndex(item => matchesId(item.card, id) || item.gameObjectId === id || item.id === id);
  return index >= 0 ? { zone: 'stack', index, card: state.stack[index].card, stackItem: state.stack[index] } : null;
}

export function legacyPlace(state, card, toZone, toPlayerId = null, db = {}) {
  if (!card || !PLAYER_ZONES.includes(toZone)) return null;
  const destinationId = toPlayerId || card.owner;
  const destination = state.players[destinationId];
  if (!destination) throw new Error(`Unknown destination player ${destinationId}`);
  reset(card, toZone, destinationId, db[card.cardId] || {});
  destination[toZone].push(card);
  return card;
}

export function legacyMove(state, id, toZone, toPlayerId = null, db = {}) {
  const found = legacyFind(state, id);
  if (!found || !PLAYER_ZONES.includes(toZone)) return null;
  let card;
  if (found.zone === 'stack') {
    const [item] = state.stack.splice(found.index, 1);
    card = item.card;
  } else [card] = found.player[found.zone].splice(found.index, 1);
  return legacyPlace(state, card, toZone, toPlayerId, db);
}

export function legacyRemove(state, id) {
  const found = legacyFind(state, id);
  if (!found) return null;
  if (found.zone === 'stack') return state.stack.splice(found.index, 1)[0]?.card || null;
  return found.player[found.zone].splice(found.index, 1)[0] || null;
}
