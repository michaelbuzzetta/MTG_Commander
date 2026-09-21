// Exact rules overrides for the Rakdos targeted-deck lands requested on 2026-09-20.
// These are applied by card name so every printing shares the same Oracle behavior.
const LAND_OVERRIDES = Object.freeze({
  'Blazemire Verge': {
    abilities: [
      { type:'mana', tap:true, mana:{ B:1 } },
      { type:'mana', tap:true, mana:{ R:1 }, condition:{ controlLandSubtypeAny:['Swamp','Mountain'] } }
    ]
  },
  'Graven Cairns': {
    abilities: [
      { type:'mana', tap:true, mana:{ C:1 } },
      { type:'mana', tap:true, cost:{ mana:'{B/R}' }, manaOptions:[{B:2},{B:1,R:1},{R:2}] }
    ]
  },
  'Haunted Ridge': {
    entersTappedUnless:{ kind:'controlCount', type:'Land', other:true, operator:'>=', amount:2 },
    abilities:[{ type:'mana', tap:true, manaOptions:[{B:1},{R:1}] }]
  },
  'Leechridden Swamp': {
    entersTapped:true,
    abilities:[
      { type:'mana', tap:true, mana:{B:1} },
      { type:'activated', tap:true, cost:{mana:'{B}'}, condition:{ controlPermanents:{ color:'B', min:2 } }, effect:{type:'eachOpponentLoseLife',amount:1} }
    ]
  },
  'Luxury Suite': {
    entersTappedUnless:{ kind:'opponentCount', operator:'>=', amount:2 },
    abilities:[{ type:'mana', tap:true, manaOptions:[{B:1},{R:1}] }]
  },
  'Minas Morgul, Dark Fortress': {
    entersTapped:true,
    abilities:[
      { type:'mana', tap:true, mana:{B:1} },
      { type:'activated', tap:true, cost:{mana:'{3}{B}'}, targets:{kind:'permanent',type:'Creature'}, effect:{type:'addCounterTarget',counter:'shadow',amount:1} }
    ],
    counterGrantedCharacteristics:{ counter:'shadow', subtype:'Wraith', keyword:'shadow' }
  },
  'Reliquary Tower': {
    noMaximumHandSize:true,
    abilities:[{ type:'mana', tap:true, mana:{C:1} }]
  },
  'Shivan Gorge': {
    abilities:[
      { type:'mana', tap:true, mana:{C:1} },
      { type:'activated', tap:true, cost:{mana:'{2}{R}'}, effect:{type:'damageEachOpponent',amount:1} }
    ]
  },
  "Witch's Clinic": {
    abilities:[
      { type:'mana', tap:true, mana:{C:1} },
      { type:'activated', tap:true, cost:{mana:'{2}'}, targets:{kind:'permanent',type:'Creature',commander:true}, effect:{type:'pump',power:0,toughness:0,keywords:['lifelink']} }
    ]
  }
});

export const TARGETED_DECK_LAND_NAMES = Object.freeze([...Object.keys(LAND_OVERRIDES), 'Mountain', 'Swamp']);

export function applyTargetedDeckLandImplementations(db = {}) {
  const out = structuredClone(db);
  for (const card of Object.values(out)) {
    const patch = LAND_OVERRIDES[card?.name];
    if (!patch) continue;
    Object.assign(card, structuredClone(patch), {
      targetedImplementation: 'rakdos-deck-lands-v1',
      certificationEligible: true
    });
  }
  return out;
}
