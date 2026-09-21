import { EVENT } from '../../engine/constants.js';

const OVERRIDES = Object.freeze({
  'Roiling Vortex': { abilities:[
    {type:'triggered',event:EVENT.PHASE_BEGIN,condition:{phase:'UPKEEP'},effect:{type:'damageActivePlayer',amount:1}},
    {type:'triggered',event:EVENT.SPELL_CAST,condition:{manaSpentExactly:0},effect:{type:'damageEventController',amount:5}},
    {type:'activated',cost:{mana:'{R}'},effect:{type:'opponentsCantGainLifeThisTurn'}}
  ]},
  'Underworld Dreams': { abilities:[{type:'triggered',event:EVENT.CARD_DRAWN,condition:{eventController:'opponent'},effect:{type:'damageEventController',amount:1}}]},
  'Mogis, God of Slaughter': { creatureUnlessDevotion:{colors:['B','R'],threshold:7}, keywords:['Indestructible'], abilities:[
    {type:'triggered',event:EVENT.PHASE_BEGIN,condition:{phase:'UPKEEP',eventController:'opponent'},effect:{type:'mogisPunishment',amount:2}}
  ]},
  'Razorkin Needlehead': { ownTurnKeywords:['First strike'], abilities:[{type:'triggered',event:EVENT.CARD_DRAWN,condition:{eventController:'opponent'},effect:{type:'damageEventController',amount:1}}]},
  'Blood Seeker': { abilities:[{type:'triggered',event:EVENT.ENTER_BATTLEFIELD,condition:{eventController:'opponent',type:'Creature'},optional:true,effect:{type:'eventControllerLoseLife',amount:1}}]},
  'Kederekt Parasite': { abilities:[{type:'triggered',event:EVENT.CARD_DRAWN,condition:{eventController:'opponent',controllerControlsColorPermanent:'R'},optional:true,effect:{type:'damageEventController',amount:1}}]},
  'Zo-Zu the Punisher': { abilities:[{type:'triggered',event:EVENT.LAND_PLAYED,effect:{type:'damageEventController',amount:2}}]},
  'Scrawling Crawler': { abilities:[
    {type:'triggered',event:EVENT.PHASE_BEGIN,condition:{phase:'UPKEEP',controllerEvent:true},effect:{type:'eachPlayerDraw',amount:1}},
    {type:'triggered',event:EVENT.CARD_DRAWN,condition:{eventController:'opponent'},effect:{type:'eventControllerLoseLife',amount:1}}
  ]}
});
export const TARGETED_DECK_PUNISHMENT2_NAMES=Object.freeze(Object.keys(OVERRIDES));
export function applyTargetedDeckPunishment2Implementations(db={}){const out=structuredClone(db);for(const card of Object.values(out)){const patch=OVERRIDES[card?.name];if(!patch)continue;Object.assign(card,structuredClone(patch),{targetedImplementation:'rakdos-deck-punishment-v2',certificationEligible:true});}return out;}
