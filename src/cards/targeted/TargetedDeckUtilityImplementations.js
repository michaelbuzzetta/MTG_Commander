import { EVENT } from '../../engine/constants.js';

const OVERRIDES = Object.freeze({
  'Lightning Greaves': {
    equipCost: '{0}',
    abilities: [
      { type:'static', filter:{ attachedToSource:true }, effect:{ keywords:['haste','shroud'] } }
    ]
  },
  'Shadowspear': {
    equipCost: '{2}',
    abilities: [
      { type:'static', filter:{ attachedToSource:true }, effect:{ power:1, toughness:1, keywords:['trample','lifelink'] } },
      { type:'activated', cost:{ mana:'{1}' }, effect:{ type:'opponentsPermanentsLoseKeywordsUntilEOT', keywords:['hexproof','indestructible'] } }
    ]
  },
  'Sol Ring': {
    abilities: [
      { type:'mana', tap:true, mana:{ C:2 } }
    ]
  },
  'Arcane Signet': {
  abilities: [
    {
      type: 'mana',
      tap: true,
      anyColor: true,
      amount: 1
    }
  ]
},
  'Repercussion': {
    abilities: [
      { type:'triggered', event:'DAMAGE_DEALT_TO_CREATURE', condition:{ creatureDamaged:true }, effect:{ type:'repercussionDamage' } }
    ]
  }
});

export const TARGETED_DECK_UTILITY_NAMES = Object.freeze(Object.keys(OVERRIDES));
export function applyTargetedDeckUtilityImplementations(db={}) {
  const out=structuredClone(db);
  for (const card of Object.values(out)) {
    const patch=OVERRIDES[card?.name];
    if(!patch) continue;
    Object.assign(card,structuredClone(patch),{targetedImplementation:'rakdos-deck-utility-v1',certificationEligible:true});
  }
  return out;
}
