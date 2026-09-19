# Step 16 Completion Report — Card Scripting Language / Declarative Ability Model

## Status

**COMPLETE for the Step 16 workflow checkpoint.**

This checkpoint builds directly on `MTG_Commander_Step15_Complete.zip` and adds the declarative scripting layer required for Release C scalable card support, while preserving the authoritative engine boundaries from Steps 1–15.

## Delivered

### 1. Ability IR/schema

Added `src/cards/scripts/AbilityIR.js` with a versioned ability model for static, activated, triggered, replacement, spell, and characteristic-defining abilities. Scripts compile to the engine's existing `abilities`, `spellEffects`, and `modes` data rather than creating a separate execution model.

### 2. Effect primitive library

Added `EffectPrimitiveLibrary.js` with stable primitives for the Step 16 effect vocabulary: draw, discard, mill, damage, life changes, destroy/exile/sacrifice, tap/untap, token creation, copy/counter, search/reveal/shuffle, zone movement, counter changes, characteristic changes, ability grant/removal, extra/skip turn/combat operations, and control change.

Existing rules primitives are reused where available. Generic Step 16 helpers delegate to zone/knowledge/continuous-effect services and existing event paths.

### 3. Selector/filter DSL

Added `SelectorDSL.js` with validation and normalization for zone, kind, type/subtype, color, mana value, controller/owner/player relations, legendary/name/id, combat/tapped/counter state, and arbitrary `and`/`or`/`not` composition. Target selectors feed the Step 6 target framework.

### 4. Sequencing and conditional logic

Added declarative support for sequence, if/otherwise, for-each selection, bounded repeat, optional may choices, variable/event-derived quantities, and references to prior selected objects. Optional effects reuse the existing generic choice flow.

### 5. Script validator/compiler

Added `ScriptValidator.js` and `CardScriptCompiler.js`. All script-bearing card definitions are validated and compiled when the GameEngine loads the database, before game objects are created. Invalid scripts produce exact path diagnostics and fail closed.

### 6. Custom-hook registry

Added `CustomHookRegistry.js`. A custom hook must be explicitly registered with an id, version, handler, and optional test metadata before any script referencing it can compile. Version mismatches or missing hooks fail visibly.

### 7. Runtime integration

Added `CardScriptService.js` and `CardScriptRuntime.js`, integrated into `GameEngine` and `EffectEngine`. Scripted triggered abilities use TriggerEngine; activated abilities use normal costs/targets/stack; replacement abilities use Step 10; static/CDA behavior uses Step 11; modes use normal spell casting/resolution; selectors use Step 6; zone/knowledge behavior routes through existing services.

## Acceptance criteria

| Workflow criterion | Result |
| --- | --- |
| Representative vanilla, ETB, activated, replacement, static and modal cards can be expressed without editing core engine code | **PASS** — dedicated tests cover all of these forms plus CDA/control flow. |
| Invalid scripts fail at load time with actionable diagnostics | **PASS** — unknown primitives/selectors, impossible bounds and missing/unregistered hook requirements fail before gameplay with precise paths. |
| Scripted cards use the same rules primitives as hand-written engine tests | **PASS** — tests exercise normal trigger, stack, cost, target, replacement, continuous-layer, zone/knowledge and choice paths. |

## Verification

Final verification on the Step 16 working tree:

- **386 / 386 non-stress repository tests passing**
- **16 / 16 Step 16-specific tests passing**
- **80 / 80 targeted Steps 6 + 10–16 interaction tests passing**
- `npm run check:architecture`: **PASS**
- `npm run check-db`: **PASS — 647 cards / 13 decks**
- `npm run audit:mutations`: completed; inventory refreshed (**315 internal direct mutation paths**) with production player-zone mutation boundaries still guarded by the architecture check.

## Production-build environment note

`npm run build` was attempted. The container could not reach Scryfall and correctly fell back to the local 647-card seed. This checkpoint intentionally does not include installed `node_modules`, so the build then stops at `vite build` with `vite: not found`. This is an environment/dependency-install limitation; the rules tests, architecture validation, and database validation are green.

## Scope note

Step 16 provides the declarative language and execution path. It does not migrate/classify every Oracle card; that is Step 17. Deep copy semantics and generalized library-search semantics remain scheduled for Steps 22 and 27 respectively, so Step 16's generic nodes intentionally reuse the current engine capabilities rather than prematurely duplicating those future systems.

## Release gate

Step 16 advances **Release C — Scalable Card Support**. The codebase now has both a reusable mechanic layer (Step 15) and a validated declarative card-authoring layer (Step 16).

## Next workflow step

Step 17 — **Card Library Migration and Support Classification** — has not been started in this checkpoint.
