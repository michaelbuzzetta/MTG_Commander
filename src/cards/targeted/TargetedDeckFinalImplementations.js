import { EVENT } from '../../engine/constants.js';

const O=Object.freeze({
 'Chandra, Awakened Inferno':{cantBeCountered:true,loyaltyAbilities:[
  {cost:+2,effect:{type:'chandraEmblemEachOpponent'}},
  {cost:-3,effect:{type:'chandraSweep',amount:3,excludeSubtype:'Elemental'}},
  {cost:'-X',targets:{kind:'permanent',typeAny:['Creature','Planeswalker']},effect:{type:'damage',amount:'X',exileIfWouldDieThisTurn:true}}
 ]},
 'Gleeful Arsonist':{abilities:[
  {type:'triggered',event:EVENT.SPELL_CAST,condition:{eventController:'opponent',cardTypeNot:'Creature'},effect:{type:'damageEventControllerEqualSourcePower'}},
  {type:'triggered',event:EVENT.CREATURE_DIED,condition:{sourceEvent:true,sourceHadNoCounter:'+1/+1'},effect:{type:'undyingReturn'}}
 ]},
 'Grim Tutor':{abilities:[],spellEffects:[{type:'grimTutor'}]},
 'Kardur, Doomscourge':{abilities:[
  {type:'triggered',event:EVENT.ENTER_BATTLEFIELD,condition:{sourceEvent:true},effect:{type:'kardurGoadUntilNextTurn'}},
  {type:'triggered',event:EVENT.CREATURE_DIED,condition:{eventWasAttacking:true},effect:{type:'eachOpponentLoseLife',amount:1}},{type:'triggered',event:EVENT.CREATURE_DIED,condition:{eventWasAttacking:true},effect:{type:'gainLife',amount:1}}
 ]},
 "Kaya's Ghostform":{targets:{kind:'permanent',controller:'you',typeAny:['Creature','Planeswalker']},abilities:[{type:'triggered',event:[EVENT.CREATURE_DIED,EVENT.LEAVE_BATTLEFIELD],condition:{attachedObjectEvent:true,toZoneAny:['graveyard','exile']},effect:{type:'returnAttachedCardToBattlefieldUnderYourControl'}}]},
 'Lindblum, Industrial Regency // Mage Siege':{targetedMdfc:true,frontFace:{entersTapped:true,abilities:[{type:'mana',tap:true,mana:{R:1}}]},backFace:{spellEffects:[{type:'createMageSiegeWizard'}]}},
 'Molten Influence':{targets:{kind:'stackObject',typeAny:['Instant','Sorcery']},abilities:[],spellEffects:[{type:'moltenInfluence'}]},
 'My Precious // Allure of Power':{targetedMdfc:true,frontFace:{equipCost:{mana:'{2}',life:2},abilities:[{type:'static',filter:{attachedToSource:true},effect:{keywords:['hexproof'],cantBeBlocked:true}}]},backFace:{additionalCosts:[{type:'sacrifice',filter:{type:'Creature'},count:1}],spellEffects:[{type:'draw',amount:2}]}},
 'Nightshade Harvester':{abilities:[{type:'triggered',event:EVENT.LAND_PLAYED,condition:{eventController:'opponent'},effect:{type:'nightshadeHarvester'}}]},
 'No Mercy':{abilities:[{type:'triggered',event:EVENT.LIFE_LOSS,condition:{controllerEvent:true,damageFromCreature:true},effect:{type:'destroyDamageSource'}}]},
 'Smoke':{maxCreaturesUntappedDuringUntap:1},
 'Spikefield Hazard // Spikefield Cave':{targetedMdfc:true,frontFace:{targets:{kind:'any'},spellEffects:[{type:'damage',amount:1,exileIfWouldDieThisTurn:true}]},backFace:{entersTapped:true,abilities:[{type:'mana',tap:true,mana:{R:1}}]}},
 'Tainted Strike':{targets:{kind:'permanent',type:'Creature'},abilities:[],spellEffects:[{type:'pump',power:1,toughness:0,keywords:['infect'],until:'endOfTurn'}]},
 "Tarrian's Soulcleaver":{equipCost:'{2}',abilities:[{type:'static',filter:{attachedToSource:true},effect:{keywords:['vigilance']}},{type:'triggered',event:[EVENT.CREATURE_DIED,EVENT.CARD_TO_GRAVEYARD],condition:{anotherArtifactOrCreatureFromBattlefield:true},effect:{type:'addCounterAttached',counter:'+1/+1',amount:1}}]},
 'The Reaver Cleaver':{equipCost:'{3}',abilities:[{type:'static',filter:{attachedToSource:true},effect:{power:1,toughness:1,keywords:['trample']}},{type:'triggered',event:EVENT.COMBAT_DAMAGE_PLAYER,condition:{attachedCreatureSource:true},effect:{type:'createTreasureEqualEventDamage'}}]},
 'Virtue of Courage // Embereth Blaze':{targetedAdventure:true,abilities:[{type:'triggered',event:EVENT.LIFE_LOSS,condition:{eventController:'opponent',noncombatDamageFromControllerSource:true},effect:{type:'virtueOfCourageExile'}}],adventure:{targets:{kind:'any'},effects:[{type:'damage',amount:2}]}},
 'Vorrac Battlehorns':{equipCost:'{1}',abilities:[{type:'static',filter:{attachedToSource:true},effect:{keywords:['trample'],maxBlockers:1}}]},
 'Urabrask // The Great Work':{targetedTransform:true,keywords:['first strike'],abilities:[
  {type:'triggered',event:EVENT.SPELL_CAST,condition:{controllerEvent:true,cardTypeAny:['Instant','Sorcery']},targets:{kind:'player',relation:'opponent'},effect:{type:'urabraskCastTrigger'}},
  {type:'activated',sorcerySpeed:true,cost:{mana:'{R}'},condition:{instantSorcerySpellsCastThisTurnAtLeast:3},effect:{type:'transformUrabraskToGreatWork'}}
 ],backFaceChapters:[{chapter:1,effect:{type:'greatWorkChapter1'}},{chapter:2,effect:{type:'createToken',token:'Treasure',amount:3}},{chapter:3,effect:{type:'greatWorkChapter3'}}]}
});
export const TARGETED_DECK_FINAL_NAMES=Object.freeze(Object.keys(O));
export function applyTargetedDeckFinalImplementations(db={}){const out=structuredClone(db);for(const c of Object.values(out)){const p=O[c?.name];if(!p)continue;Object.assign(c,structuredClone(p),{targetedImplementation:'rakdos-deck-final-v1',certificationEligible:true});}return out;}
