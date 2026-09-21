// Exact targeted implementations for power-based and land-count damage cards in the Rakdos deck.
const DAMAGE_OVERRIDES = Object.freeze({
  "Chandra's Ignition": {
    targets:{ kind:'permanent', type:'Creature', controller:'you' }, abilities:[],
    spellEffects:[{ type:'chandrasIgnition' }]
  },
  'Backlash': {
    targets:{ kind:'permanent', type:'Creature', filter:{ tapped:false } }, abilities:[],
    spellEffects:[{ type:'tapCreatureDamageItsControllerEqualPower' }]
  },
  'Delirium': {
    onlyDuringOpponentsTurn:true,
    targets:{ kind:'permanent', type:'Creature', controller:'opponent' }, abilities:[],
    spellEffects:[{ type:'deliriumCreature' }]
  },
  'Price of Progress': {
    targets:null, abilities:[], spellEffects:[{ type:'priceOfProgress' }]
  }
});
export const TARGETED_DECK_DAMAGE_NAMES=Object.freeze(Object.keys(DAMAGE_OVERRIDES));
export function applyTargetedDeckDamageImplementations(db={}){
 const out=structuredClone(db); for(const card of Object.values(out)){const patch=DAMAGE_OVERRIDES[card?.name]; if(!patch)continue; Object.assign(card,structuredClone(patch),{targetedImplementation:'rakdos-deck-damage-v1',certificationEligible:true});} return out;
}
