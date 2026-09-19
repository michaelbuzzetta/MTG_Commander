export const COUNTER_SEMANTIC = Object.freeze({
  PLUS_ONE_PLUS_ONE: '+1/+1',
  MINUS_ONE_MINUS_ONE: '-1/-1',
  LOYALTY: 'loyalty',
  DEFENSE: 'defense',
  LORE: 'lore',
  STUN: 'stun',
  SHIELD: 'shield',
  TIME: 'time',
  POISON: 'poison',
  ENERGY: 'energy',
  EXPERIENCE: 'experience'
});

export const BUILTIN_COUNTER_SEMANTICS = Object.freeze({
  '+1/+1': Object.freeze({ category: 'pt', layer: 'pt-counters' }),
  '-1/-1': Object.freeze({ category: 'pt', layer: 'pt-counters' }),
  loyalty: Object.freeze({ category: 'planeswalker-resource', entryDefault: 'loyalty' }),
  defense: Object.freeze({ category: 'battle-resource', entryDefault: 'defense' }),
  lore: Object.freeze({ category: 'saga-progress', hook: 'saga-chapter' }),
  stun: Object.freeze({ category: 'untap-replacement', hook: 'replace-untap' }),
  shield: Object.freeze({ category: 'damage-destroy-replacement', hook: 'shield' }),
  time: Object.freeze({ category: 'time-resource' }),
  poison: Object.freeze({ category: 'player-loss-resource' }),
  energy: Object.freeze({ category: 'player-resource' }),
  experience: Object.freeze({ category: 'player-resource' })
});
