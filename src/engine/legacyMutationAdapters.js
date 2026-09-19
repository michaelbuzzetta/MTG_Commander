import { ENGINE_EVENT } from './EventTypes.js';

/**
 * Step 3 migration registry for pre-event helper APIs.
 *
 * These helpers remain callable by existing engine/card code while their state
 * transitions are routed through EventDispatcher. The registry is documentation
 * plus a machine-readable migration checklist; it is not a second mutation path.
 */
const ENTRIES = [
  { legacy: 'GameEngine.draw', event: ENGINE_EVENT.DRAW_CARD, status: 'routed' },
  { legacy: 'GameEngine._moveZoneNow', event: ENGINE_EVENT.MOVE_ZONE, status: 'routed' },
  { legacy: 'GameEngine.changeLife', event: `${ENGINE_EVENT.GAIN_LIFE} / ${ENGINE_EVENT.LOSE_LIFE}`, status: 'routed' },
  { legacy: 'GameEngine.tapPermanent', event: ENGINE_EVENT.TAP, status: 'routed' },
  { legacy: 'GameEngine.untapPermanent', event: ENGINE_EVENT.UNTAP, status: 'routed' },
  { legacy: 'EffectEngine.addCounters', event: ENGINE_EVENT.ADD_COUNTER, status: 'routed' },
  { legacy: 'GameEngine.removeCounters', event: ENGINE_EVENT.REMOVE_COUNTER, status: 'routed' },
  { legacy: 'EffectEngine.createTokenRaw', event: ENGINE_EVENT.CREATE_TOKEN, status: 'routed' },
  { legacy: 'GameEngine.discardCard', event: ENGINE_EVENT.DISCARD_CARD, status: 'routed' },
  { legacy: 'GameEngine.mill', event: ENGINE_EVENT.MILL_CARD, status: 'routed' },
  { legacy: 'GameEngine.shuffleLibrary', event: ENGINE_EVENT.SHUFFLE, status: 'routed' },
  { legacy: 'GameEngine.dealDamageToPlayer', event: ENGINE_EVENT.DEAL_DAMAGE, status: 'routed' },
  { legacy: 'GameEngine.dealDamageToPermanent', event: ENGINE_EVENT.DEAL_DAMAGE, status: 'routed' },
  { legacy: 'GameEngine.destroy', event: ENGINE_EVENT.DESTROY, status: 'routed' },
  { legacy: 'GameEngine.sacrifice', event: ENGINE_EVENT.SACRIFICE, status: 'routed' },
  { legacy: 'GameEngine.exile', event: ENGINE_EVENT.EXILE, status: 'routed' },
  { legacy: 'GameEngine.changeController', event: ENGINE_EVENT.CONTROL_CHANGE, status: 'routed' },
  { legacy: 'GameEngine.cast / submitAction(CAST_*)', event: ENGINE_EVENT.CAST, status: 'routed' },
  { legacy: 'GameEngine._applyDeclareAttackers', event: ENGINE_EVENT.ATTACK, status: 'routed-by-action' },
  { legacy: 'GameEngine._applyDeclareBlockers', event: ENGINE_EVENT.BLOCK, status: 'routed-by-action' }
];

export const LEGACY_MUTATION_EVENT_ADAPTERS = Object.freeze(
  ENTRIES.map(entry => Object.freeze({ ...entry }))
);

export function getLegacyMutationEventAdapterRegistry() {
  return structuredClone(LEGACY_MUTATION_EVENT_ADAPTERS);
}
