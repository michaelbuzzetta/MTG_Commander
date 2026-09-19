# Step 17 Completion Report — Card Library Migration and Support Classification

## Status

**COMPLETE for the Step 17 workflow checkpoint.**

This checkpoint builds directly on `MTG_Commander_Step16_Complete.zip` and implements an Oracle/rules-identity registry, measurable card support database, current-deck readiness reporting, coverage generation, and a conservative legacy-handler review process.

## Delivered

### 1. Oracle-to-script/rules implementation registry

Added `src/cards/support/OracleImplementationRegistry.js` and `OracleIdentity.js`. Real `oracleId` values are used when present; missing Oracle ids are represented by an explicit deterministic normalized-name fallback. Printing metadata is retained separately from the shared rules implementation. Records with the same Oracle id but differing Oracle text are version-split rather than silently conflated.

### 2. Support-status database

Added `CardSupportService` plus generated `card-support.json`. Every one of the 647 authoritative local card definitions now has a machine-readable status, implementation path, caveats, behavioral-test evidence, rules-validation version, and custom-hook metadata where applicable.

Fully supported certification is intentionally fail-closed. A card must be explicitly certified, executable, have card-specific behavioral coverage, and have no untracked caveats or required custom hook. Runtime cards with no known record default to partial support instead of being silently promoted.

### 3. Current-deck migration/readiness suite

Generated `deck-readiness.json` for all 13 current project decks. Every deck card maps to a support record. Partial/unsupported cards are explicit blockers, so strict-mode consumers never infer completeness from the fact that a deck loads.

### 4. Data-derived coverage report

Generated `coverage-report.json`. Current checkpoint totals:

- 647 cards
- 13 current decks
- 26 fully supported
- 621 partially supported
- 0 explicitly unsupported in the current source pool
- 178 cards with real Oracle ids from the checked-in/cached Scryfall snapshot
- 469 cards with an explicit local identity fallback
- implementation paths: 187 auto-template candidates, 447 declarative-scripted, 13 complex-scripted

Coverage percentages are derived from support records, never from estimated project maturity.

### 5. Legacy handler removal review

Generated `legacy-handler-removal.json`. It identifies card-specific production paths and single-card EffectEngine branches for review. Nothing is automatically deleted merely because it appears bespoke; removal requires an equivalent tested declarative implementation.

### 6. CI/check integration

Added:

- `npm run build-support`
- `npm run check-support`
- `npm run test:step17`

`npm run verify` now includes support-data validation before architecture/tests/build.

## Acceptance criteria

| Workflow criterion | Result |
| --- | --- |
| All printings resolve to the correct Oracle implementation | **PASS** — registry grouping, printing metadata separation, and same-Oracle/different-text fixtures are tested. |
| Current project decks contain no silently unsupported effects in strict mode | **PASS** — all 13 decks are mapped; partial cards remain explicit blockers and no deck is incorrectly strict-ready. |
| Coverage percentages are calculated from data, not estimates | **PASS** — generated report derives counts/percentages directly from support records. |
| Fully supported cards have passing tests and no untracked caveats | **PASS** — generator/check gate rejects full certification without explicit certification, executable support, card-specific tests, and caveat-free metadata. |

## Verification

Final verification on the Step 17 working tree:

- **398 / 398 non-stress repository tests passing** (run in three deterministic chunks because the single long command exceeded the container command timeout)
- **12 / 12 Step 17-specific tests passing**
- **92 / 92 targeted Steps 6 + 10–17 interaction tests passing**
- `npm run check-db`: **PASS — 647 cards / 13 decks**
- `npm run check-support`: **PASS — 647 cards / 13 decks; 26 full, 621 partial, 0 unsupported**
- `npm run check:architecture`: **PASS**
- `npm run audit:mutations`: completed; inventory refreshed (**313 internal direct mutation paths**)

## Production-build environment note

`npm run build` was attempted. Scryfall network refresh was unavailable, and the app correctly fell back to the checked-in 647-card local seed. The checkpoint intentionally does not include installed `node_modules`, so the command then stops at `vite build` with `vite: not found`. This is an environment/dependency-install limitation, not a rules/support-data test failure.

## Scope note

Step 17 does **not** claim that all 647 cards are fully implemented. Its purpose is to make support identity, implementation path, evidence, caveats, and deck readiness measurable and fail-closed. Step 18 is responsible for increasing scalable coverage through a reviewed Oracle-text template compiler.

## Next workflow step

Step 18 — **Oracle Text Template Compiler** — has not been started in this checkpoint.
