# Step 25 Completion Report — Token Registry and Generated Game Objects

## Status

**COMPLETE for the Step 25 workflow checkpoint.**

This checkpoint builds directly on Step 24 and replaces ad hoc generated-token definitions with a reusable token registry and token-creation service that still routes through the authoritative `CREATE_TOKEN` event/replacement pipeline.

## Delivered

- Added `src/engine/tokens/TokenDefinition.js`, `TokenRegistry.js`, `TokenService.js`, `CommonTokens.js`, and the public token module index.
- Added normalized `TokenDefinition` records with stable definition IDs, copiable/base characteristics, abilities, faces, attachment metadata, token family metadata, and source/alias information.
- Added a reusable registry for official/common definitions plus card-local custom definitions without forcing same-name custom tokens to share rules identity.
- Preserved legacy inline token IDs such as `token:Pest` / `token:Merfolk` when unambiguous so existing deck data, tests, and replay references remain compatible.
- Routed generated tokens through the existing `CREATE_TOKEN` replacement/event path with quantity, controller, source, entry-state, entry-counter, attachment, and token-copy metadata.
- Added replacement-derived token definitions so effects may legally replace one generated token type/shape with another without mutating the common registry.
- Added Academy Manufactor-style multi-token batch support through the same `CREATE_TOKEN` event path.
- Added common reusable definitions for Treasure, Clue, Food, Blood, Map, Powerstone, Incubator, and the supported Role token family.
- Added Incubator front/back characteristics, entry counters, and transform support while preserving counters.
- Added Role creation-attached behavior, attachment-sourced continuous bonuses, and same-controller Role uniqueness handling.
- Integrated Step 22 copiable values with token copies. Temporary buffs, counters, tapped state, and marked damage are not copied unless an effect explicitly makes such state part of token creation metadata.
- Deterministically reuses generated token definitions when the same copiable characteristics are copied more than once.
- Token objects receive independent object/instance IDs even when they share one reusable token definition.
- Extended token SBA cleanup so tokens can briefly move zones and produce zone-change/trigger observations, then cease to exist and cannot persist in hand, library, graveyard, exile, or command.
- Kept `src/engine/TokenDefinitions.js` as a compatibility facade over the new registry instead of maintaining a second token-rules table.

## Acceptance criteria

- Token doublers interact through replacement effects: **PASS**.
- Created tokens have correct base characteristics and independent game-object IDs: **PASS**.
- Copied tokens use copiable values instead of rendered/derived state: **PASS**.
- Tokens cannot persist illegally outside the battlefield/stack lifecycle: **PASS**.

## Regression defects found and fixed

During Step 25 integration, broader regressions exposed compatibility issues for legacy custom token identifiers such as `token:Pest` and `token:Merfolk`. The registry now preserves the historical `token:<Name>` identity for the first unambiguous inline custom definition and only creates fingerprinted IDs when a same-name rules collision actually requires a separate identity. The affected Category 5 and Explorers regression coverage passes after the fix.

An Incubator test also caught duplicate entry-counter application when a token event used token batches. Batch-specific and event-wide entry metadata are now merged exactly once.

## Verification

- **527 / 527 non-stress repository tests passing** across all 53 non-stress test files, executed in bounded batches to avoid the command runtime ceiling.
- **19 / 19 Step 25-specific tests passing**.
- **221 / 221 targeted Step 6 + Steps 10–25 interaction tests passing**.
- **50 / 50 seeded stress games passing**, executed as five bounded 10-game batches using the existing deterministic stress scenario.
- Authoritative database validation: **647 cards / 13 decks**.
- Step 17 support data validation: **26 fully supported / 621 partial / 0 unsupported**.
- Step 18 Oracle compiler validation: **4 exact high-confidence auto-compilations / 643 review-required**.
- Architecture boundary check: **PASS**.
- Direct-mutation audit refreshed: **332 paths inventoried**.
- Post-generation regression covering Steps 17, 18, and 22–25: **100 / 100 passing**.

## Production build attempt

`npm run build` was attempted. The prebuild Scryfall refresh failed because this sandbox has no outbound fetch for that operation, correctly fell back to the local 647-card seed, and then the Vite bundle step stopped with `vite: not found` because this container does not have the project's `node_modules` installed. This is an environment dependency limitation rather than a Step 25 rules/test failure.

## Scope note

Step 25 provides the generic generated-object substrate. Token definitions are now reusable data, token generation is observable/replacement-aware, token copies share Step 22 copiable-value rules, and token disappearance shares the SBA/zone engine. Step 26 can therefore centralize damage without needing token-specific damage or death handling.

## Next workflow step

Step 26 — **Damage System**.
