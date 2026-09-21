import { EVENT } from '../../engine/constants.js';

const OVERRIDES = Object.freeze({
  'Syr Konrad, the Grim': { abilities:[
    {type:'triggered',event:EVENT.CREATURE_DIED,condition:{notSelfEvent:true},effect:{type:'damageEachOpponent',amount:1}},
    {type:'triggered',event:EVENT.CARD_TO_GRAVEYARD,condition:{cardType:'Creature',fromZoneNot:'battlefield'},effect:{type:'damageEachOpponent',amount:1}},
    {type:'triggered',event:EVENT.CARD_LEFT_GRAVEYARD,condition:{cardType:'Creature',controllerEvent:true},effect:{type:'damageEachOpponent',amount:1}},
    {type:'activated',cost:{mana:'{1}{B}'},effect:{type:'eachPlayerMill',amount:1}}
  ]},
  'Harsh Mentor': { abilities:[
    {type:'triggered',event:EVENT.ABILITY_ACTIVATED,condition:{eventController:'opponent',nonManaAbility:true,sourcePermanentTypeAny:['Artifact','Creature','Land']},effect:{type:'damageEventController',amount:2}}
  ]},
  'Hexing Squelcher': {
    cantBeCountered:true, wardCost:{life:2}, controllerSpellsCantBeCountered:true, otherCreaturesWardLife:2
  },
  'Persistent Constrictor': { abilities:[
    {type:'triggered',event:EVENT.PHASE_BEGIN,condition:{phase:'UPKEEP',eventController:'opponent'},effect:{type:'persistentConstrictorUpkeep'}},
    {type:'triggered',event:EVENT.CREATURE_DIED,condition:{sourceEvent:true,sourceHadNoCounter:'-1/-1'},effect:{type:'persistentConstrictorReturn'}}
  ]},
  'The Lord of Pain': { keywords:['Menace'], abilities:[
    {type:'static',effect:{opponentsCantGainLife:true}},
    {type:'triggered',event:EVENT.SPELL_CAST,condition:{firstSpellThisTurn:true},targets:{kind:'player'},effect:{type:'lordOfPainDamage'}}
  ]},
  'Valgavoth, Harrower of Souls': { keywords:['Flying'], wardCost:{life:2}, abilities:[
    {type:'triggered',event:EVENT.LIFE_LOSS,condition:{eventController:'opponent',firstLifeLossThisTurn:true},effect:{type:'valgavothReward'}}
  ]}
});
export const TARGETED_DECK_PUNISHMENT3_NAMES=Object.freeze(Object.keys(OVERRIDES));
export function applyTargetedDeckPunishment3Implementations(db={}){const out=structuredClone(db);for(const card of Object.values(out)){const patch=OVERRIDES[card?.name];if(!patch)continue;Object.assign(card,structuredClone(patch),{targetedImplementation:'rakdos-deck-punishment-v3',certificationEligible:true});}return out;}
