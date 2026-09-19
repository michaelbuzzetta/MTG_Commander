# Step 1 — Engine Isolation and Architectural Boundaries

Status: **implemented**

## Boundary

`src/engine/` owns authoritative game state and every production mutation path. React, UI helpers, and AI strategy consume immutable snapshots and legal-action/query results. They do not receive the mutable `GameState` object and do not call engine subsystem instances (`combat`, `targeting`, `static`, `effects`, `triggers`, `mana`, or `legal`) directly.

The current engine still contains legacy direct mutations internally. Step 1 does **not** rewrite those rules into the future event architecture; it isolates them behind `GameEngine` so Steps 2–3 can migrate them safely. The complete current inventory is generated in `step1-mutation-inventory.md` / `.json`.

## Top-level module boundaries

Step 1 now exposes explicit boundaries for the major project layers:

- `src/engine/` — authoritative rules state, actions, and read-only queries.
- `src/cards/` — card-facing boundary reserved for declarative card execution migration.
- `src/mechanics/` — reusable mechanic boundary reserved for Step 15 migration.
- `src/ai/` — strategy only; consumes snapshots/legal actions.
- `src/ui/` plus `src/App.jsx` / `src/components/` — rendering and player decisions only.
- `src/database/` — read-only production database/catalog facade.
- `tests/` — regression and architecture gates.

The existing implementation is intentionally not mass-moved merely to satisfy folder names; Step 1 creates the dependency boundaries first so later migrations can happen without destabilizing gameplay.

## Required public API

The Step 1 contract is versioned in `src/engine/public/api.js`.

- `createGame(deckA, deckB, db, options)` — creates a `GameEngine` without exposing construction details to consumers.
- `getStateSnapshot()` — returns a recursively frozen structured clone of authoritative state.
- `getLegalActions(playerId)` — returns an immutable legal-action list.
- `submitAction(playerId, action)` — validates and submits a non-choice action. Returns `{ ok: true, result }` or `{ ok: false, error }`.
- `submitChoice(playerId, action)` — submits the response to the currently pending rules choice using the same structured result format.
- `passPriority(playerId)` — dedicated priority gateway.
- `serializeReplay()` — serializes the current public action log and engine history. Full deterministic replay is intentionally deferred to Step 30.

Read-only supporting queries (`getCardDatabaseSnapshot`, `getDerivedStats`, `getLegalAttackers`, `getTargetCandidates`, etc.) exist so UI/AI can render and score decisions without accessing mutable subsystem objects.

## Structured error contract

Public action gateways do not throw for illegal user/AI requests. They return:

```js
{
  ok: false,
  error: {
    code: 'ILLEGAL_ACTION',
    message: '...',
    playerId: 'player',
    actionType: 'CAST_SPELL',
    turn: 1,
    phase: 'PRECOMBAT_MAIN'
  }
}
```

Validation occurs before application, so rejected illegal operations leave authoritative state unchanged. The deprecated `perform()` compatibility adapter preserves the older throwing behavior for existing tests/integrations while routing through the new gateway.

## Read-only database boundary

The React application loads generated card/deck data through `src/database/index.js`, which returns frozen built-in records and wraps the Scryfall catalog loader. Consumers use `getCardDatabaseSnapshot()` / `getCardDefinition()` once a game exists. Runtime token definitions are registered through `_registerRuntimeCardDefinition()` inside the engine, which invalidates the cached public database snapshot. Consumer code no longer reads `engine.db` directly.

## Compatibility adapters

`src/engine/compat/legacyAdapters.js` is the registry for temporary migration shims. Current entries include:

- `GameEngine.perform`
- direct `GameEngine.state` access used by engine internals / legacy test fixtures
- direct `GameEngine.db` access used by engine internals
- convenience action helpers such as `cast`, `playLand`, and `activateAbility`

Production React and AI code have already migrated away from these adapters. Later steps can remove the remaining test/internal compatibility surfaces when their dependent migrations are complete.

## Architecture enforcement

Run:

```bash
npm run check:architecture
```

The guard scans production consumer code and fails if UI/AI attempts to access authoritative `engine.state`, mutable `engine.db`, deprecated `perform()`, private engine helpers, mutable permanent lookup, or internal engine subsystem objects.

Run:

```bash
npm run audit:mutations
```

This regenerates the mutation-path inventory. Step 1 requires UI/AI authoritative mutation counts to remain zero.

## Step 1 acceptance status

- Existing core gameplay launches and completes regression/simulation games: **pass**.
- React and AI do not directly write authoritative state: **pass**.
- Static architecture guard detects forbidden new consumer access: **pass**.
- Production actions route through `GameEngine` public gateways: **pass**.
- Current direct internal mutation paths are inventoried for later migration: **pass**.
- Legacy behavior is preserved through explicit deprecated adapters: **pass**.
