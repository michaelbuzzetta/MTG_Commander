const OVERRIDES=Object.freeze({
 'Deflecting Swat':{freeIfControlCommander:true,targets:{kind:'stackObject',singleTargetOnly:true},abilities:[],spellEffects:[{type:'chooseNewTargetsForStackObject',may:true}]},
 'Redirect Lightning':{abilities:[],modes:[
  {id:'pay-life',label:'Pay 5 life',manaCost:'{R}',additionalLifeCost:5,targets:{kind:'stackObject',singleTargetOnly:true},effects:[{type:'changeSingleTargetOfStackObject'}]},
  {id:'pay-mana',label:'Pay {2}',manaCost:'{2}{R}',targets:{kind:'stackObject',singleTargetOnly:true},effects:[{type:'changeSingleTargetOfStackObject'}]}
 ]},
 'Rakdos Charm':{abilities:[],modes:[
  {id:'graveyard',label:"Exile target player's graveyard",manaCost:'{B}{R}',targets:{kind:'player'},effects:[{type:'exileTargetPlayersGraveyard'}]},
  {id:'artifact',label:'Destroy target artifact',manaCost:'{B}{R}',targets:{kind:'permanent',type:'Artifact'},effects:[{type:'destroy'}]},
  {id:'creatures',label:'Each creature deals 1 damage to its controller',manaCost:'{B}{R}',effects:[{type:'eachCreatureDealsDamageToController',amount:1}]}
 ]},
 'Untimely Malfunction':{abilities:[],modes:[
  {id:'artifact',label:'Destroy target artifact',manaCost:'{1}{R}',targets:{kind:'permanent',type:'Artifact'},effects:[{type:'destroy'}]},
  {id:'retarget',label:'Change the target of target spell or ability with a single target',manaCost:'{1}{R}',targets:{kind:'stackObject',singleTargetOnly:true},effects:[{type:'changeSingleTargetOfStackObject'}]},
  {id:'cant-block',label:"One or two target creatures can't block this turn",manaCost:'{1}{R}',targets:{kind:'permanent',type:'Creature',minTargets:1,maxTargets:2},effects:[{type:'cantBlockUntilEOT'}]}
 ]},
 'Mount Doom':{abilities:[
  {type:'mana',tap:true,cost:{life:1},manaOptions:[{B:1},{R:1}]},
  {type:'activated',tap:true,cost:{mana:'{1}{B}{R}'},effect:{type:'damageEachOpponent',amount:1}},
  {type:'activated',tap:true,sorcerySpeed:true,cost:{mana:'{5}{B}{R}',sacrificeSelf:true,sacrifice:1},selection:{type:'Artifact',legendary:true,min:1,max:1,tap:false},targets:{kind:'permanent',type:'Creature',minTargets:0,maxTargets:2},effect:{type:'destroyAllCreaturesExceptTargets'}}
 ]}
});
export const TARGETED_DECK_INTERACTION_NAMES=Object.freeze(Object.keys(OVERRIDES));
export function applyTargetedDeckInteractionImplementations(db={}){const out=structuredClone(db);for(const c of Object.values(out)){const p=OVERRIDES[c?.name];if(!p)continue;Object.assign(c,structuredClone(p),{targetedImplementation:'rakdos-deck-interaction-v1',certificationEligible:true});}return out;}
