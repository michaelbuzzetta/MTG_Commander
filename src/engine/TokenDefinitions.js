const UTILITY_TOKENS = Object.freeze({
  Treasure: Object.freeze({
    name: 'Treasure',
    typeLine: 'Artifact — Treasure',
    colors: [],
    subtypes: ['Treasure'],
    keywords: [],
    abilities: [
      {
        type: 'mana',
        tap: true,
        anyColor: true,
        colors: ['W', 'U', 'B', 'R', 'G'],
        amount: 1,
        cost: { sacrificeSelf: true }
      }
    ]
  }),
  Food: Object.freeze({
    name: 'Food',
    typeLine: 'Artifact — Food',
    colors: [],
    subtypes: ['Food'],
    keywords: [],
    abilities: [
      {
        type: 'activated',
        tap: true,
        cost: { mana: '{2}', sacrificeSelf: true },
        effect: { type: 'gainLife', amount: 3 }
      }
    ]
  }),
  Clue: Object.freeze({
    name: 'Clue',
    typeLine: 'Artifact — Clue',
    colors: [],
    subtypes: ['Clue'],
    keywords: [],
    abilities: [
      {
        type: 'activated',
        tap: false,
        cost: { mana: '{2}', sacrificeSelf: true },
        effect: { type: 'draw', amount: 1 }
      }
    ]
  })
});

export function canonicalTokenDefinition(token = {}) {
  const name = token.name || token.type || 'Token';
  const canonical = UTILITY_TOKENS[name];
  if (!canonical) {
    return {
      name,
      typeLine: token.typeLine || 'Token Creature',
      power: token.power ?? 0,
      toughness: token.toughness ?? 0,
      colors: [...(token.colors || [])],
      subtypes: [...(token.subtypes || [])],
      keywords: [...(token.keywords || [])],
      abilities: structuredClone(token.abilities || [])
    };
  }

  // Utility-token rules are canonical engine data. Call sites may provide cosmetic
  // fields, but cannot accidentally erase the standard activated abilities.
  return {
    ...structuredClone(canonical),
    ...token,
    name: canonical.name,
    typeLine: canonical.typeLine,
    colors: [...canonical.colors],
    subtypes: [...canonical.subtypes],
    keywords: [...canonical.keywords],
    abilities: structuredClone(canonical.abilities)
  };
}

export function isUtilityTokenName(name) {
  return !!UTILITY_TOKENS[name];
}
