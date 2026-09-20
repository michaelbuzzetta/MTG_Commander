const role = (name, oracleText, effect = null, extraAbilities = []) => ({
  id: `token:role:${name.toLowerCase().replace(/\s+/g, '-')}`,
  name: `${name} Role`,
  typeLine: 'Token Enchantment — Aura Role',
  colors: [],
  subtypes: ['Aura', 'Role'],
  tokenFamily: 'Role',
  roleType: name,
  oracleText: `Enchant creature\n${oracleText}`,
  enchantFilter: { kind: 'permanent', zone: 'battlefield', type: 'Creature' },
  abilities: [
    ...(effect ? [{ type: 'static', filter: { attachedToSource: true }, effect }] : []),
    ...extraAbilities
  ]
});

export const COMMON_TOKEN_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'token:treasure', name: 'Treasure', typeLine: 'Token Artifact — Treasure', colors: [], subtypes: ['Treasure'],
    tokenFamily: 'utility', oracleText: '{T}, Sacrifice this artifact: Add one mana of any color.',
    abilities: [{ type: 'mana', tap: true, anyColor: true, colors: ['W','U','B','R','G'], amount: 1, cost: { sacrificeSelf: true } }]
  }),
  Object.freeze({
    id: 'token:clue', name: 'Clue', typeLine: 'Token Artifact — Clue', colors: [], subtypes: ['Clue'],
    tokenFamily: 'utility', oracleText: '{2}, Sacrifice this artifact: Draw a card.',
    abilities: [{ type: 'activated', tap: false, cost: { mana: '{2}', sacrificeSelf: true }, effect: { type: 'draw', amount: 1 } }]
  }),
  Object.freeze({
    id: 'token:food', name: 'Food', typeLine: 'Token Artifact — Food', colors: [], subtypes: ['Food'],
    tokenFamily: 'utility', oracleText: '{2}, {T}, Sacrifice this artifact: You gain 3 life.',
    abilities: [{ type: 'activated', tap: true, cost: { mana: '{2}', sacrificeSelf: true }, effect: { type: 'gainLife', amount: 3 } }]
  }),
  Object.freeze({
    id: 'token:blood', name: 'Blood', typeLine: 'Token Artifact — Blood', colors: [], subtypes: ['Blood'],
    tokenFamily: 'utility', oracleText: '{1}, {T}, Discard a card, Sacrifice this artifact: Draw a card.',
    abilities: [{ type: 'activated', tap: true, cost: { mana: '{1}', sacrificeSelf: true, discard: 1 }, effect: { type: 'draw', amount: 1 }, metadata: { requiresDiscardSelection: 1 } }]
  }),
  Object.freeze({
    id: 'token:map', name: 'Map', typeLine: 'Token Artifact — Map', colors: [], subtypes: ['Map'],
    tokenFamily: 'utility', oracleText: '{1}, {T}, Sacrifice this artifact: Target creature you control explores. Activate only as a sorcery.',
    abilities: [{ type: 'activated', tap: true, cost: { mana: '{1}', sacrificeSelf: true }, sorcerySpeed: true, targets: { kind: 'permanent', type: 'Creature', controller: 'you' }, effect: { type: 'explore' } }]
  }),
  Object.freeze({
    id: 'token:powerstone', name: 'Powerstone', typeLine: 'Token Artifact — Powerstone', colors: [], subtypes: ['Powerstone'],
    tokenFamily: 'utility', oracleText: '{T}: Add {C}. This mana can’t be spent to cast a nonartifact spell.',
    abilities: [{ type: 'mana', tap: true, mana: { C: 1 }, spendRestriction: 'powerstone' }]
  }),
  Object.freeze({
    id: 'token:incubator', name: 'Incubator', typeLine: 'Token Artifact — Incubator', colors: [], subtypes: ['Incubator'],
    tokenFamily: 'Incubator', layout: 'transform',
    oracleText: '{2}: Transform this artifact.',
    abilities: [{ type: 'activated', cost: { mana: '{2}' }, effect: { type: 'transformSelf' } }],
    cardFaces: [
      { name: 'Incubator', typeLine: 'Token Artifact — Incubator', colors: [], subtypes: ['Incubator'], oracleText: '{2}: Transform this artifact.', abilities: [{ type: 'activated', cost: { mana: '{2}' }, effect: { type: 'transformSelf' } }] },
      { name: 'Phyrexian', typeLine: 'Token Artifact Creature — Phyrexian', colors: [], subtypes: ['Phyrexian'], power: 0, toughness: 0, oracleText: '', abilities: [] }
    ]
  }),
  Object.freeze(role('Cursed', 'Enchanted creature has base power and toughness 1/1.', { setPower: 1, setToughness: 1 })),
  Object.freeze(role('Monster', 'Enchanted creature gets +1/+1 and has trample.', { power: 1, toughness: 1, keywords: ['trample'] })),
  Object.freeze(role('Royal', 'Enchanted creature gets +1/+1 and has ward {1}.', { power: 1, toughness: 1, keywords: ['ward {1}'] })),
  Object.freeze(role('Sorcerer', 'Enchanted creature gets +1/+1 and has “Whenever this creature attacks, scry 1.”', { power: 1, toughness: 1 }, [{ type: 'triggered', event: 'ATTACK_DECLARED', filter: { attachedToSource: true }, effect: { type: 'scry', amount: 1 } }])),
  Object.freeze(role('Virtuous', 'Enchanted creature gets +1/+1 for each enchantment you control.', null, [{ type: 'static', filter: { attachedToSource: true }, effect: { powerToughnessPerControllerEnchantment: true } }])),
  Object.freeze(role('Wicked', 'Enchanted creature gets +1/+1. When this Aura is put into a graveyard from the battlefield, each opponent loses 1 life.', { power: 1, toughness: 1 }, [{ type: 'triggered', event: 'DIED', effect: { type: 'eachOpponentLoseLife', amount: 1 } }])),
  Object.freeze(role('Young Hero', 'Enchanted creature has “Whenever this creature attacks, if its toughness is 3 or less, put a +1/+1 counter on it.”', null, [{ type: 'triggered', event: 'ATTACK_DECLARED', filter: { attachedToSource: true }, condition: { toughnessMax: 3 }, effect: { type: 'addCounter', counter: '+1/+1', amount: 1 } }]))
]);
