export const CASTING_MECHANICS = [
  { id: 'kicker', name: 'Kicker', category: 'casting', dependencies: ['costs','stack'], hooks: ['additional-cost'], oraclePatterns: [/\b(?:multi)?kicker\b/], conformance: ['costs','stack'] },
  { id: 'flashback', name: 'Flashback', category: 'casting', dependencies: ['costs','zones','stack'], hooks: ['graveyard-cast','replacement-destination'], oraclePatterns: [/\bflashback\b/], conformance: ['costs','zones','stack'] },
  { id: 'escape', name: 'Escape', category: 'casting', dependencies: ['costs','zones','stack'], hooks: ['graveyard-cast','additional-cost'], oraclePatterns: [/\bescape[—\s]/], conformance: ['costs','zones','stack'] },
  { id: 'suspend', name: 'Suspend', category: 'casting', dependencies: ['costs','zones','triggers','stack','counters'], hooks: ['special-action','upkeep-trigger','free-cast'], oraclePatterns: [/\bsuspend\b/], conformance: ['costs','zones','triggers','stack'] },
  { id: 'foretell', name: 'Foretell', category: 'casting', dependencies: ['costs','zones','stack'], hooks: ['special-action','exile-cast'], oraclePatterns: [/\bforetell\b/], conformance: ['costs','zones','stack'] },
  { id: 'adventure', name: 'Adventure', category: 'casting', dependencies: ['card-faces','stack','zones'], hooks: ['alternate-face-cast'], oraclePatterns: [/\badventure\b/], conformance: ['stack','zones'] },
  { id: 'delve', name: 'Delve', category: 'casting', dependencies: ['costs','zones'], hooks: ['cost-payment'], oraclePatterns: [/\bdelve\b/], conformance: ['costs','zones'] },
  { id: 'convoke', name: 'Convoke', category: 'casting', dependencies: ['costs','continuous'], hooks: ['cost-payment'], oraclePatterns: [/\bconvoke\b/], conformance: ['costs','continuous'] },
  { id: 'improvise', name: 'Improvise', category: 'casting', dependencies: ['costs'], hooks: ['cost-payment'], oraclePatterns: [/\bimprovise\b/], conformance: ['costs'] },
  { id: 'affinity', name: 'Affinity', category: 'casting', dependencies: ['costs','continuous'], hooks: ['cost-reduction'], oraclePatterns: [/\baffinity for\b/], conformance: ['costs','continuous'] },
  { id: 'prototype', name: 'Prototype', category: 'casting', dependencies: ['card-faces','costs','continuous'], hooks: ['alternate-characteristics'], oraclePatterns: [/\bprototype\b/], conformance: ['costs','continuous'] },
  { id: 'mutate', name: 'Mutate', category: 'casting', dependencies: ['costs','stack','zones','continuous'], hooks: ['alternate-cast','merge'], oraclePatterns: [/\bmutate\b/], conformance: ['costs','zones','continuous'] },
  { id: 'ninjutsu', name: 'Ninjutsu', category: 'casting', dependencies: ['costs','combat','zones'], hooks: ['combat-activation'], oraclePatterns: [/\bninjutsu\b/], conformance: ['costs','combat','zones'] },
  { id: 'unearth', name: 'Unearth', category: 'casting', dependencies: ['costs','zones','triggers'], hooks: ['graveyard-activation','replacement-destination'], oraclePatterns: [/\bunearth\b/], conformance: ['costs','zones','triggers'] },
  { id: 'reconfigure', name: 'Reconfigure', category: 'casting', dependencies: ['costs','attachments','continuous'], hooks: ['attachment-action'], oraclePatterns: [/\breconfigure\b/], conformance: ['costs','continuous'] }
];
