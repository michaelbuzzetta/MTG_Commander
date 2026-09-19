import { reserveUid } from '../utils.js';
import { GAME_STATE_SCHEMA_VERSION, hydrateCanonicalGameState, validateCanonicalGameState } from './GameStateSchema.js';

const SPECIAL_NUMBER = '__mtgSpecialNumber';

function replacer(_key, value) {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    if (Number.isNaN(value)) return { [SPECIAL_NUMBER]: 'NaN' };
    return { [SPECIAL_NUMBER]: value > 0 ? 'Infinity' : '-Infinity' };
  }
  return value;
}

function reviver(_key, value) {
  if (value && typeof value === 'object' && SPECIAL_NUMBER in value) {
    if (value[SPECIAL_NUMBER] === 'NaN') return Number.NaN;
    if (value[SPECIAL_NUMBER] === 'Infinity') return Infinity;
    if (value[SPECIAL_NUMBER] === '-Infinity') return -Infinity;
  }
  return value;
}

function reserveObjectIds(state) {
  for (const player of Object.values(state.players || {})) {
    reserveUid(player.gameObjectId);
    for (const zone of ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command']) {
      for (const card of player[zone] || []) {
        reserveUid(card.instanceId);
        reserveUid(card.gameObjectId);
        reserveUid(card.previousGameObjectId);
      }
    }
  }
  for (const item of state.stack || []) {
    reserveUid(item.gameObjectId);
    if (item.card) {
      reserveUid(item.card.instanceId);
      reserveUid(item.card.gameObjectId);
      reserveUid(item.card.previousGameObjectId);
    }
  }
}

export function serializeGameState(state) {
  validateCanonicalGameState(state, { throwOnError: true });
  return JSON.stringify({
    schema: 'mtg-commander-game-state',
    schemaVersion: GAME_STATE_SCHEMA_VERSION,
    state
  }, replacer);
}

export function deserializeGameState(serialized, { db = {}, validate = true } = {}) {
  const envelope = typeof serialized === 'string' ? JSON.parse(serialized, reviver) : structuredClone(serialized);
  if (!envelope || envelope.schema !== 'mtg-commander-game-state') throw new Error('Unknown GameState serialization format');
  if (envelope.schemaVersion !== GAME_STATE_SCHEMA_VERSION) throw new Error(`Unsupported GameState schema version ${envelope.schemaVersion}`);
  const state = hydrateCanonicalGameState(envelope.state, db);
  reserveObjectIds(state);
  if (validate) validateCanonicalGameState(state, { throwOnError: true });
  return state;
}
