// Exact rules overrides for the Rakdos deck mana/cost package requested 2026-09-20.
const MANA_OVERRIDES = Object.freeze({
  'Dark Ritual': {
    targets: null,
    abilities: [],
    spellEffects: [{ type:'addMana', mana:{ B:3 } }]
  },
  'Jet Medallion': {
    abilities:[{ type:'static', filter:{ color:'B' }, effect:{ spellCostReduction:1 } }]
  },
  'Ruby Medallion': {
    abilities:[{ type:'static', filter:{ color:'R' }, effect:{ spellCostReduction:1 } }]
  },
  'Crypt Ghast': {
    abilities:[
      { type:'triggered', event:'SPELL_CAST', condition:{controllerEvent:true}, effect:{ type:'optionalEffect', prompt:'Pay {W/B} for extort?', cost:{mana:'{W/B}'}, then:{type:'extort',pay:true,prepaid:true} } }
    ],
    extort:true,
    swampManaBonus:{ B:1 }
  }
});

export const TARGETED_DECK_MANA_NAMES = Object.freeze(Object.keys(MANA_OVERRIDES));

export function applyTargetedDeckManaImplementations(db={}) {
  const out=structuredClone(db);
  for(const card of Object.values(out)) {
    const patch=MANA_OVERRIDES[card?.name];
    if(!patch) continue;
    Object.assign(card,structuredClone(patch),{targetedImplementation:'rakdos-deck-mana-v1',certificationEligible:true});
  }
  return out;
}
