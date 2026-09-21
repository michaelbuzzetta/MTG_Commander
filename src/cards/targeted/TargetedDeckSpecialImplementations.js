import { EVENT } from '../../engine/constants.js';

const OVERRIDES = Object.freeze({
  'Deadly Rollick': {
    freeIfControlCommander:true,
    targets:{kind:'permanent',type:'Creature'}, abilities:[], spellEffects:[{type:'exile'}]
  },
  'Pyroblast': {
    abilities:[], modes:[
      {id:'counter-blue-spell',label:'Counter target spell if it is blue',manaCost:'{R}',targets:{kind:'spell',zone:'stack'},effects:[{type:'counterTargetIfBlue'}]},
      {id:'destroy-blue-permanent',label:'Destroy target permanent if it is blue',manaCost:'{R}',targets:{kind:'permanent'},effects:[{type:'destroyTargetIfBlue'}]}
    ]
  },
  'Forsaken Wastes': {
    abilities:[
      {type:'static',effect:{playersCantGainLife:true}},
      {type:'triggered',event:EVENT.PHASE_BEGIN,condition:{phase:'UPKEEP'},effect:{type:'activePlayerLosesLife',amount:1}},
      {type:'triggered',event:'BECOMES_TARGET',condition:{sourceSelf:true,bySpell:true},effect:{type:'eventControllerLoseLife',amount:5}}
    ]
  },
  'Glistening Oil': {
    abilities:[
      {type:'static',filter:{attachedToSource:true},effect:{keyword:'infect'}},
      {type:'triggered',event:EVENT.PHASE_BEGIN,condition:{phase:'UPKEEP',controllerEvent:true},effect:{type:'addCounterAttached',counter:'-1/-1',amount:1}},
      {type:'triggered',event:EVENT.LEAVE_BATTLEFIELD,condition:{sourceSelf:true,toZone:'graveyard'},effect:{type:'returnEventCardToOwnerHand'}}
    ]
  },
  'Thief of Blood': {
    keywords:['flying'],
    asEntersRemoveAllPermanentCounters:true
  }
});
export const TARGETED_DECK_SPECIAL_NAMES=Object.freeze(Object.keys(OVERRIDES));
export function applyTargetedDeckSpecialImplementations(db={}){const out=structuredClone(db);for(const card of Object.values(out)){const patch=OVERRIDES[card?.name];if(!patch)continue;Object.assign(card,structuredClone(patch),{targetedImplementation:'rakdos-deck-special-v1',certificationEligible:true});}return out;}
