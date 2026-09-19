# Step 20 Completion Report — Pregame, Deck Validation and Mulligans

## Status

**COMPLETE for the Step 20 workflow checkpoint.**

This checkpoint builds directly on `MTG_Commander_Step19_Complete.zip` and implements format-aware pregame legality, commander/companion designation, deterministic starting order/shuffling, multiplayer London mulligans and event-driven pregame card actions.

## Delivered

### 1. Format-aware Commander deck validation

Added `src/engine/pregame/FormatValidator.js`. Before opening hands are drawn, the engine can validate Commander deck size, legal commander/pair designation, designated-card presence, color identity, singleton rules, configured banned/restricted sources, unresolved cards and companion legality. All 13 current project decks pass the validator.

Illegal decks fail before `state.started` is committed or opening cards are drawn.

### 2. Companion designation and deck-building restrictions

Companions are represented in `state.pregame.companions`, revealed at pregame and kept outside the command zone. Standard named companion deck-building rules have explicit validators. Unknown companion restrictions fail explicitly rather than being silently accepted in strict validation.

### 3. Seeded starting order and opening libraries

Added `SeededRandom`. Supplying `seed` to `GameEngine` makes initial shuffles and random starting-player selection deterministic. Reset rewinds the seeded pregame RNG, reproducing starting order and opening hands. Existing injected RNG callers remain compatible.

The `startingPlayer` option supports `first`, `random`, or an explicit player ID; multiplayer order is rotated consistently around the selected starting player.

### 4. Commander/London mulligans

The pregame state records the format free-mulligan count. Multiplayer games receive one free mulligan. Every mulligan shuffles the current opening hand back and draws seven; on keep the player bottoms `mulligansTaken - freeMulligans` cards. Existing UI/AI mulligan actions remain compatible.

### 5. Pregame action hooks

Added `PregameActionService`, which collects card-declared actions after all players keep and resolves them before the first turn. Optional actions use `CHOOSE_PREGAME_ACTION` and the normal legal-action/choice path.

Implemented reusable support for:

- Leyline-style begin-on-battlefield actions
- Gemstone-Caverns-style non-starting-player actions with another-card exile and luck counter
- explicit `pregameActions` metadata
- simple conservative Leyline Oracle-text inference

Zone movement is routed through `MOVE_ZONE`; counters use the event system, so pregame actions are logged and observable by the same rules infrastructure as ordinary gameplay.

## Acceptance criteria

| Workflow criterion | Result |
| --- | --- |
| Illegal decks are rejected with specific reasons | **PASS** — size, commander, singleton, color identity, bans, unresolved cards and companion restrictions return structured diagnostics and can fail before the opening draw. |
| Seeded game creation yields reproducible opening libraries/hands | **PASS** — same seed reproduces shuffle/order/opening hands; reset reproduces the same checkpoint. |
| Multiplayer mulligans follow selected rules | **PASS** — seven-card redraws plus one multiplayer free mulligan and correct bottom count on keep. |
| Pregame permanents/actions appear before turn one without bypassing event logging | **PASS** — Leyline/Gemstone-style actions complete before first turn via authoritative zone/counter events. |

## Verification

Final verification on the Step 20 working tree:

- **438 / 438 non-stress repository tests passing**, executed in bounded complete batches
- **12 / 12 Step 20-specific tests passing**
- **132 / 132 targeted Steps 6 + 10–20 tests passing**
- `npm run check-db`: **PASS — 647 cards / 13 decks**
- `npm run check-support`: **PASS — 26 fully supported / 621 partial / 0 explicitly unsupported**
- `npm run check-oracle-templates`: **PASS — 647 analyzed / 4 exact high-confidence / 643 review-required**
- `npm run check:architecture`: **PASS**
- `npm run audit:mutations`: completed; inventory refreshed (**321 internal direct mutation paths**)
- deterministic AI stress corpus: **50 / 50 seeded scenarios PASS** when run in bounded batches

The full monolithic stress invocation exceeded the tool wall-clock window, so the identical 50 deterministic scenarios were run in bounded batches; every scenario passed without repeated-state deadlock or legality failure.

## Production-build environment note

`npm run build` was attempted. Scryfall refresh was unavailable and correctly fell back to the checked-in 647-card seed. This archive intentionally does not contain installed `node_modules`, so the final Vite command stops with `vite: not found`. All engine/database/support/compiler/architecture/test gates above run without that missing local package installation.

## Scope note

Step 20 establishes format/pre-turn correctness and generic hooks. It does not yet centralize every permission/restriction that affects actions during the game; that work belongs to later workflow steps. The Step 20 seeded PRNG is intentionally shaped for later migration into Step 30's project-wide replay/randomness service.

## Next workflow step

Step 21 — **Permissions, Restrictions and Requirements** — has not been started in this checkpoint.
