import assert from 'node:assert/strict';
import { engine } from '../helpers.js';
import { makeCardInstance } from '../../src/engine/GameState.js';
import { hashState } from '../../src/engine/replay/StateHasher.js';

let fixtureSequence = 0;

export function primitiveEngine() {
  const e = engine();
  e.setInvariantChecks(false); // Primitive tests intentionally construct minimal isolated states.
  return e;
}

export function defineCard(e, id, definition = {}) {
  const def = {
    id,
    name: definition.name || id,
    manaCost: definition.manaCost || '',
    manaValue: definition.manaValue ?? 0,
    typeLine: definition.typeLine || 'Creature — Primitive Test',
    colorIdentity: definition.colorIdentity || [],
    colors: definition.colors || [],
    subtypes: definition.subtypes || ['Primitive Test'],
    keywords: definition.keywords || [],
    power: definition.power ?? 2,
    toughness: definition.toughness ?? 2,
    abilities: definition.abilities || [],
    spellEffects: definition.spellEffects || [],
    oracleText: definition.oracleText || '',
    ...definition
  };
  e._registerRuntimeCardDefinition(id, def);
  return e.db[id];
}

export function battlefieldCard(e, playerId = 'player', definition = {}, extra = {}) {
  const id = definition.id || `step33-card-${++fixtureSequence}`;
  const def = defineCard(e, id, definition);
  const card = makeCardInstance(id, playerId, 'battlefield', {
    controller: playerId,
    summoningSick: false,
    createdTurn: e.state.turn,
    controlledSinceTurn: e.state.turn,
    ...extra
  }, def);
  e.zones.place(card, 'battlefield', playerId);
  card.summoningSick = extra.summoningSick ?? false;
  return card;
}

export function stateHash(e) {
  return hashState(e.state);
}

export function assertStateUnchanged(e, before, message = 'failed primitive must not partially mutate authoritative state') {
  assert.equal(stateHash(e), before, message);
}

export function zoneOf(e, ref) {
  return e.zones.find(typeof ref === 'string' ? ref : ref?.instanceId)?.zone || null;
}

export function manaPool(e, playerId, values = {}) {
  const player = e.state.players[playerId];
  for (const color of ['W','U','B','R','G','C']) player.manaPool[color] = Number(values[color] || 0);
  return player.manaPool;
}

export function simpleLockedCost(playerId, finalManaCost = '', nonManaCosts = []) {
  return Object.freeze({
    kind: 'locked-cost',
    playerId,
    finalManaCost,
    variables: Object.freeze({}),
    nonManaCosts: Object.freeze(nonManaCosts.map(cost => Object.freeze({ ...cost }))),
    stages: Object.freeze({})
  });
}
