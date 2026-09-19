# Step 15 Completion Report — Reusable Mechanic Library

## Status

**COMPLETE for the Step 15 workflow checkpoint.**

This checkpoint builds directly on `MTG_Commander_Step14_Complete.zip` and adds a registry-driven reusable mechanic layer while preserving the authoritative rules architecture from Steps 1–14.

## Delivered

### 1. Mechanic registry and package model

Added `src/mechanics/MechanicRegistry.js` and `src/mechanics/MechanicLibrary.js`. Mechanic definitions now carry stable ids, category, aliases, subsystem dependencies, recognition patterns, rules hooks, conformance surfaces, and metadata.

Four packages are registered under `src/mechanics/packages/`:

- `evergreen.js`
- `commander.js`
- `casting.js`
- `specialty.js`

The package catalog covers every mechanic family named in the Step 15 workflow: evergreen combat/targeting keywords, common Commander mechanics, cost/casting mechanics, and the listed specialty/legacy mechanics.

### 2. Evergreen behavior migrated to shared mechanics

The combat, targeting, damage/prevention, SBA, cost, and casting paths now consume shared mechanic queries for flying/reach, first strike, double strike, deathtouch, trample, vigilance, lifelink, haste, hexproof, ward, menace, protection, indestructible, and flash where those rules are currently executable by the core engine.

This removes duplicated keyword interpretation from the major engine consumers and makes those behaviors reusable for any card carrying the same mechanic.

### 3. Reusable Commander/common mechanic hooks

Added shared support for:

- mechanic-generated prowess, exalted, and myriad trigger definitions;
- investigate through generic Clue token creation;
- populate through the generic token copy path;
- devotion and domain as reusable game-state values;
- centralized registry/hook contracts for goad, encore, cascade, discover, proliferate, Treasure/Clue/Food, surveil, scry, connive, landfall, and related mechanics.

### 4. Reusable cost/casting hooks

Affinity now exposes a shared generic-mana reduction. Convoke, improvise, and delve expose legal payment-contribution candidates from current battlefield/graveyard state. The complete Step 15 casting-mechanic list is centrally recognized and carries explicit dependencies/hooks so future card scripts bind to the mechanic layer instead of editing core engine logic.

### 5. Specialty mechanic contracts

Persist, undying, exploit, devour, dredge, storm, rebound, morph, manifest, disguise, Saga, Battle, and Vehicle are registered with stable dependency/hook contracts. This preserves a single extension point for the later card-scripting and advanced-rule phases rather than creating new one-off card branches.

## Acceptance criteria

| Workflow criterion | Result |
| --- | --- |
| Cards sharing a mechanic call shared implementation | **PASS** — shared registry identity and engine integrations are covered by dedicated tests. |
| Adding another card with an existing mechanic does not require engine modifications | **PASS** — recognition is keyword/tag/Oracle-pattern driven; shared behavior is mechanic keyed rather than card-name keyed. |
| Mechanic tests cover targeting, zones, triggers and continuous effects when relevant | **PASS** — Step 15 tests exercise targeting/protection/ward, token/zone operations, generated triggers, cost hooks, derived state and continuous-keyword reads. |

## Verification

Final verification on the Step 15 working tree:

- **370 / 370 non-stress repository tests passing**
- **13 / 13 Step 15-specific tests passing**
- **64 / 64 targeted Steps 6 + 10–15 interaction tests passing**
- `npm run check:architecture`: **PASS**
- `npm run check-db`: **PASS — 647 cards / 13 decks**
- `npm run audit:mutations`: completed; inventory refreshed (**313 internal direct mutation paths**) with player-zone mutation boundaries still guarded by the architecture check.

## Production-build environment note

`npm run build` was attempted. The container could not reach Scryfall and correctly continued with the local 647-card seed. This checkpoint intentionally does not bundle installed `node_modules`, so the build then stops at `vite build` with `vite: not found`. This is an environment/dependency-install limitation; the rules tests, architecture validation, and database validation are green.

## Release gate

Step 15 starts **Release C — Scalable Card Support**. The reusable mechanic registry/library is now the stable layer that Step 16's declarative card scripting model can target.

## Next workflow step

Step 16 — **Card Scripting Language / Declarative Ability Model** — has not been started in this checkpoint.
