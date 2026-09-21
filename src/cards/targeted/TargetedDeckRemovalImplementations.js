// Exact targeted implementations for the Rakdos deck removal/burn package.
const REMOVAL_OVERRIDES = Object.freeze({
  'Bedevil': {
    targets:{ kind:'permanent', types:['Artifact','Creature','Planeswalker'] },
    abilities:[], spellEffects:[{ type:'destroy' }]
  },
  'Terminate': {
    targets:{ kind:'permanent', type:'Creature' },
    abilities:[], spellEffects:[{ type:'destroy', cannotRegenerate:true }]
  },
  'Gut Shot': {
    targets:{ kind:'playerOrPermanent', types:['Creature','Planeswalker','Battle'] },
    abilities:[], spellEffects:[{ type:'damage', amount:1 }]
  },
  'Play with Fire': {
    targets:{ kind:'playerOrPermanent', types:['Creature','Planeswalker','Battle'] },
    abilities:[], spellEffects:[{ type:'damageThenScryIfPlayer', amount:2, scry:1 }]
  },
  'Smash to Smithereens': {
    targets:{ kind:'permanent', type:'Artifact' },
    abilities:[], spellEffects:[{ type:'destroyThenDamageController', amount:3 }]
  },
  'Hideous End': {
    targets:{ kind:'permanent', type:'Creature', filter:{ not:{ color:'B' } } },
    abilities:[], spellEffects:[{ type:'destroyThenControllerLosesLife', amount:2 }]
  },
  "Geth's Verdict": {
    targets:{ kind:'player', player:'opponent' },
    abilities:[], spellEffects:[{ type:'targetPlayerSacrificesCreatureThenLosesLife', amount:1 }]
  },
  'Toxic Deluge': {
    abilities:[],
    xMode:{ prefix:'toxic-x-', label:'Pay X life — X={X}', min:0, extraGenericFromX:false, lifeCostFromX:true, effects:[{ type:'allCreaturesMinusXMinusX' }] },
    spellEffects:[]
  }
});

export const TARGETED_DECK_REMOVAL_NAMES = Object.freeze(Object.keys(REMOVAL_OVERRIDES));
export function applyTargetedDeckRemovalImplementations(db={}) {
  const out=structuredClone(db);
  for(const card of Object.values(out)) {
    const patch=REMOVAL_OVERRIDES[card?.name];
    if(!patch) continue;
    Object.assign(card,structuredClone(patch),{targetedImplementation:'rakdos-deck-removal-v1',certificationEligible:true});
  }
  return out;
}
