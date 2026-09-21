import { EVENT } from '../../engine/constants.js';
import { ENGINE_EVENT } from '../../engine/events/EventTypes.js';

const OVERRIDES = Object.freeze({
  'Bloodchief Ascension': {
    abilities:[
      { type:'triggered', event:EVENT.END_STEP, condition:{ opponentLostLifeThisTurnAtLeast:2 }, effect:{ type:'addCounterSource', counter:'quest', amount:1 } },
      { type:'triggered', event:EVENT.CARD_TO_GRAVEYARD, condition:{ eventController:'opponent', sourceCounterAtLeast:{counter:'quest',amount:3} }, effect:{ type:'bloodchiefDrain', amount:2 } }
    ]
  },
  'Exquisite Blood': {
    abilities:[{ type:'triggered', event:EVENT.LIFE_LOSS, condition:{eventController:'opponent'}, effect:{type:'gainLife',amountFromEvent:'amount'} }]
  },
  'Solphim, Mayhem Dominus': {
    abilities:[
      { type:'replacement', event:ENGINE_EVENT.DEAL_DAMAGE, filter:{ sourceController:'you', noncombat:true, recipientController:'opponent' }, effect:'double' },
      { type:'activated', cost:{mana:'{1}{R/P}{R/P}',discard:2}, handSelection:{count:2}, effect:{type:'addCounterSource',counter:'indestructible',amount:1} }
    ]
  },
  'Sulfuric Vortex': {
    abilities:[
      { type:'triggered', event:EVENT.PHASE_BEGIN, condition:{phase:'UPKEEP'}, effect:{type:'damageActivePlayer',amount:2} },
      { type:'static', effect:{playersCantGainLife:true} }
    ]
  }
});
export const TARGETED_DECK_PUNISHMENT_NAMES=Object.freeze(Object.keys(OVERRIDES));
export function applyTargetedDeckPunishmentImplementations(db={}){const out=structuredClone(db);for(const card of Object.values(out)){const patch=OVERRIDES[card?.name];if(!patch)continue;Object.assign(card,structuredClone(patch),{targetedImplementation:'rakdos-deck-punishment-v1',certificationEligible:true});}return out;}
