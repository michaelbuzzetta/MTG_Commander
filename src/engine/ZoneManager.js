const PLAYER_ZONES = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'];

function resetZoneChangeState(card, toZone, destinationPlayerId) {
  card.zone = toZone;
  card.controller = toZone === 'battlefield' ? destinationPlayerId : card.owner;
  card.tapped = false;
  card.summoningSick = false;
  card.counters = {};
  card.damageMarked = 0;
  card.damagePrevention = 0;
  card.deathtouchMarked = false;
  card.attacking = false;
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
}


export class ZoneManager {
  static find(state, instanceId) {
    for (const player of Object.values(state.players)) {
      for (const zone of PLAYER_ZONES) {
        const index = player[zone].findIndex(card => card.instanceId === instanceId);
        if (index >= 0) return { player, zone, index, card: player[zone][index] };
      }
    }
    const index = state.stack.findIndex(item => item.card?.instanceId === instanceId);
    return index >= 0 ? { zone: 'stack', index, card: state.stack[index].card, stackItem: state.stack[index] } : null;
  }

  static move(state, instanceId, toZone, toPlayerId = null) {
    const found = this.find(state, instanceId);
    if (!found || !PLAYER_ZONES.includes(toZone)) return null;

    let card;
    if (found.zone === 'stack') {
      const [item] = state.stack.splice(found.index, 1);
      card = item.card;
    } else {
      [card] = found.player[found.zone].splice(found.index, 1);
    }

    return this.place(state, card, toZone, toPlayerId);
  }

  static place(state, card, toZone, toPlayerId = null) {
    if (!card || !PLAYER_ZONES.includes(toZone)) return null;
    const destinationId = toPlayerId || card.owner;
    const destination = state.players[destinationId];
    if (!destination) throw new Error(`Unknown destination player ${destinationId}`);

    resetZoneChangeState(card, toZone, destinationId);
    if (card.isCommander && ['graveyard', 'exile'].includes(toZone)) card.commanderZoneChoicePending = true;
    else delete card.commanderZoneChoicePending;
    destination[toZone].push(card);
    return card;
  }

  static remove(state, instanceId) {
    const found = this.find(state, instanceId);
    if (!found) return null;
    if (found.zone === 'stack') return state.stack.splice(found.index, 1)[0]?.card || null;
    return found.player[found.zone].splice(found.index, 1)[0] || null;
  }
}
