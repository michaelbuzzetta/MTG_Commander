const ENTRIES = [
  {
    id: 'GameEngine.perform',
    kind: 'method',
    status: 'deprecated',
    replacement: 'submitAction / submitChoice / passPriority',
    consumers: 'tests and older integrations only',
    note: 'Production React and AI code no longer calls perform().'
  },
  {
    id: 'GameEngine.state',
    kind: 'property',
    status: 'deprecated-in-consumers',
    replacement: 'getStateSnapshot()',
    consumers: 'engine internals and legacy test fixtures only',
    note: 'Production UI/AI access is forbidden by the Step 1 architecture guard.'
  },
  {
    id: 'GameEngine.db',
    kind: 'property',
    status: 'deprecated-in-consumers',
    replacement: 'getCardDatabaseSnapshot() / getCardDefinition()',
    consumers: 'engine internals only',
    note: 'Production UI/AI access is forbidden by the Step 1 architecture guard.'
  },
  {
    id: 'GameEngine convenience action helpers',
    kind: 'method-family',
    status: 'deprecated',
    replacement: 'submitAction / submitChoice',
    consumers: 'older integrations only',
    members: ['mulligan', 'keepHand', 'bottomCards', 'discardCards', 'cast', 'playLand', 'activateMana', 'activateAbility', 'chooseExplore']
  }
];

export const LEGACY_ADAPTER_REGISTRY = Object.freeze(ENTRIES.map(entry => Object.freeze({ ...entry, members: entry.members ? Object.freeze([...entry.members]) : undefined })));

export function getLegacyAdapterRegistry() {
  return structuredClone(LEGACY_ADAPTER_REGISTRY);
}
