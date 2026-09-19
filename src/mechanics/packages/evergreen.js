const combat = ['combat', 'continuous'];
const targeting = ['targeting', 'continuous'];
const damage = ['events', 'damage', 'continuous'];

export const EVERGREEN_MECHANICS = [
  { id: 'flying', name: 'Flying', category: 'evergreen', dependencies: combat, hooks: ['block-legality'], oraclePatterns: [/\bflying\b/], conformance: ['combat', 'continuous'] },
  { id: 'reach', name: 'Reach', category: 'evergreen', dependencies: combat, hooks: ['block-legality'], oraclePatterns: [/\breach\b/], conformance: ['combat', 'continuous'] },
  { id: 'first strike', name: 'First strike', category: 'evergreen', dependencies: combat, aliases: ['first-strike'], hooks: ['combat-damage-step'], oraclePatterns: [/\bfirst strike\b/], conformance: ['combat'] },
  { id: 'double strike', name: 'Double strike', category: 'evergreen', dependencies: combat, aliases: ['double-strike'], hooks: ['combat-damage-step'], oraclePatterns: [/\bdouble strike\b/], conformance: ['combat'] },
  { id: 'deathtouch', name: 'Deathtouch', category: 'evergreen', dependencies: damage, hooks: ['damage', 'combat-assignment'], oraclePatterns: [/\bdeathtouch\b/], conformance: ['combat', 'events', 'sba'] },
  { id: 'trample', name: 'Trample', category: 'evergreen', dependencies: damage, hooks: ['combat-assignment'], oraclePatterns: [/\btrample\b/], conformance: ['combat'] },
  { id: 'vigilance', name: 'Vigilance', category: 'evergreen', dependencies: combat, hooks: ['attack-declaration'], oraclePatterns: [/\bvigilance\b/], conformance: ['combat'] },
  { id: 'lifelink', name: 'Lifelink', category: 'evergreen', dependencies: damage, hooks: ['damage'], oraclePatterns: [/\blifelink\b/], conformance: ['events', 'replacement'] },
  { id: 'haste', name: 'Haste', category: 'evergreen', dependencies: ['combat', 'costs', 'continuous'], hooks: ['summoning-sickness'], oraclePatterns: [/\bhaste\b/], conformance: ['combat', 'costs', 'continuous'] },
  { id: 'hexproof', name: 'Hexproof', category: 'evergreen', dependencies: targeting, hooks: ['target-legality'], oraclePatterns: [/\bhexproof\b/], keywordPatterns: [/^hexproof(?: from .+)?$/], conformance: ['targeting', 'continuous'] },
  { id: 'ward', name: 'Ward', category: 'evergreen', dependencies: ['targeting', 'stack', 'costs', 'continuous'], hooks: ['target-trigger', 'payment'], oraclePatterns: [/\bward\b/], keywordPatterns: [/^ward(?:\s|$)/], conformance: ['targeting', 'costs', 'stack'] },
  { id: 'menace', name: 'Menace', category: 'evergreen', dependencies: combat, hooks: ['block-requirement'], oraclePatterns: [/\bmenace\b/], conformance: ['combat'] },
  { id: 'protection', name: 'Protection', category: 'evergreen', dependencies: [...targeting, 'damage', 'attachments'], hooks: ['target-legality', 'damage-prevention', 'attachment-legality', 'block-legality'], oraclePatterns: [/\bprotection from\b/], keywordPatterns: [/^protection from .+$/], conformance: ['targeting', 'combat', 'replacement', 'continuous'] },
  { id: 'indestructible', name: 'Indestructible', category: 'evergreen', dependencies: ['events', 'sba', 'continuous'], hooks: ['destroy', 'sba'], oraclePatterns: [/\bindestructible\b/], conformance: ['events', 'sba', 'continuous'] },
  { id: 'flash', name: 'Flash', category: 'evergreen', dependencies: ['turn', 'priority', 'stack'], hooks: ['casting-timing'], oraclePatterns: [/\bflash\b/], conformance: ['stack', 'timing'] },
  { id: 'defender', name: 'Defender', category: 'evergreen', dependencies: combat, hooks: ['attack-legality'], oraclePatterns: [/\bdefender\b/], conformance: ['combat'] },
  { id: 'shroud', name: 'Shroud', category: 'evergreen', dependencies: targeting, hooks: ['target-legality'], oraclePatterns: [/\bshroud\b/], conformance: ['targeting', 'continuous'] },
  { id: 'fear', name: 'Fear', category: 'evergreen', dependencies: combat, hooks: ['block-legality'], oraclePatterns: [/\bfear\b/], conformance: ['combat'] },
  { id: 'intimidate', name: 'Intimidate', category: 'evergreen', dependencies: combat, hooks: ['block-legality'], oraclePatterns: [/\bintimidate\b/], conformance: ['combat'] },
  { id: 'horsemanship', name: 'Horsemanship', category: 'evergreen', dependencies: combat, hooks: ['block-legality'], oraclePatterns: [/\bhorsemanship\b/], conformance: ['combat'] },
  { id: 'shadow', name: 'Shadow', category: 'evergreen', dependencies: combat, hooks: ['block-legality'], oraclePatterns: [/\bshadow\b/], conformance: ['combat'] },
  { id: 'plainswalk', name: 'Plainswalk', category: 'evergreen', dependencies: combat, hooks: ['block-legality'], oraclePatterns: [/\bplainswalk\b/], conformance: ['combat', 'continuous'] },
  { id: 'swampwalk', name: 'Swampwalk', category: 'evergreen', dependencies: combat, hooks: ['block-legality'], oraclePatterns: [/\bswampwalk\b/], conformance: ['combat', 'continuous'] },
  { id: 'mountainwalk', name: 'Mountainwalk', category: 'evergreen', dependencies: combat, hooks: ['block-legality'], oraclePatterns: [/\bmountainwalk\b/], conformance: ['combat', 'continuous'] },
  { id: 'forestwalk', name: 'Forestwalk', category: 'evergreen', dependencies: combat, hooks: ['block-legality'], oraclePatterns: [/\bforestwalk\b/], conformance: ['combat', 'continuous'] },
  { id: 'islandwalk', name: 'Islandwalk', category: 'evergreen', dependencies: combat, hooks: ['block-legality'], oraclePatterns: [/\bislandwalk\b/], conformance: ['combat', 'continuous'] }
];
