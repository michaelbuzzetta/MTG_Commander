# Step 1 Compatibility Adapter Registry

The executable registry lives at `src/engine/compat/legacyAdapters.js`. This file is the human-readable migration checklist.

| Adapter | Replacement | Production status | Removal condition |
|---|---|---|---|
| `GameEngine.perform` | `submitAction`, `submitChoice`, `passPriority` | No production callers | Remove after legacy tests/integrations migrate |
| `GameEngine.state` | `getStateSnapshot()` | No UI/AI callers | Remove/privatize after internal state model migration |
| `GameEngine.db` | `getCardDatabaseSnapshot()`, `getCardDefinition()` | No UI/AI callers | Privatize after engine database access is encapsulated |
| action convenience helpers | structured action submission | Legacy only | Remove after callers use public action objects |

Every compatibility surface must continue routing into the authoritative engine; no adapter may create a second mutation path.
