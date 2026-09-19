# Step 10 Completion Report — Replacement and Prevention Effects

## Status

**COMPLETE — gated Step 10 checkpoint. Step 11 has not been started.**

Step 10 adds a generic pre-commit replacement/prevention layer to the universal Step 3 event lifecycle. Replacement effects are discovered or registered as reusable definitions, multiple applicable effects can be ordered by the correct affected player, transformed events are re-evaluated and finally revalidated before commit, and damage prevention is handled by a separate consumable-shield service after damage replacement.

## Implemented deliverables

### 1. ReplacementEffect registry

Added `src/engine/replacement/ReplacementEffect.js` and `ReplacementRegistry.js`.

A replacement definition contains canonical event types, applicability predicate, affected-player resolution, transform function, source/controller metadata, usage limit, optional duration, and diagnostic metadata.

The registry supports both programmatic definitions and card-backed data declarations discovered from battlefield permanents. The current authoritative database contains **11 replacement declarations across 10 cards**, all of which now flow through this generic subsystem.

### 2. Replacement selection and re-evaluation

Added `ReplacementService` and installed it as the first `EventDispatcher` transformer.

For each proposed event, the service:

- collects applicable replacements;
- excludes replacements already applied to that event;
- enforces per-event usage limits;
- applies the chosen replacement;
- re-evaluates the transformed event;
- repeats until stable;
- prevents malformed replacement recursion with a safety bound.

When multiple noncommutative effects apply, the correct affected player receives a generic `REPLACEMENT_ORDER` choice. The existing Step 6 UI/AI choice protocol is reused rather than adding card-specific dialogs.

### 3. Event-type replacement

`EventDispatcher` now allows a replacement to change an event's canonical type. After all transformers run, the dispatcher obtains the handler for the final type and validates that transformed event before state mutation.

A dedicated regression test replaces `DRAW_CARD` with `GAIN_LIFE` and proves that no card is drawn and the gain-life handler performs the final mutation.

### 4. Entry replacement integration

`MOVE_ZONE` replacements can redirect a destination and attach pre-entry state. Battlefield-entry state is applied inside the atomic zone transaction before ETB trigger observation.

The generic entry state currently covers:

- enters tapped;
- enters with counters.

The same transaction/choice boundary is the foundation for later copy-entry semantics; full copiable-value rules remain assigned to the workflow's dedicated copy-engine step rather than being duplicated prematurely.

### 5. PreventionEffect and shield service

Added `PreventionEffect.js` and `PreventionService.js`.

Damage prevention now supports:

- finite consumable shields;
- unlimited/all-damage shields;
- optional source/class predicates;
- existing shield counters;
- end-of-turn expiration;
- explicit unpreventable damage through `preventable: false` / `unpreventable: true`.

Replacement transformers run before prevention transformers. Thus a replacement may change a damage event first, then prevention acts on the final preventable amount.

Shield consumption is committed only inside the authoritative `DEAL_DAMAGE` handler, so prevention resources are not consumed before the event successfully commits.

### 6. Canonical state/serialization

Added `GameState.preventionEffects` and schema/type support. Serializable prevention shields survive save/restore, and older state snapshots hydrate the missing field safely.

Step 4 cleanup now prunes expiring end-of-turn prevention shields.

### 7. Existing card/effect migration

Removed the old `src/engine/ReplacementEngine.js`.

`EffectEngine` now routes existing counter and token replacement behavior through the generic replacement service, including the current Hardened Scales/Branching Evolution/Doubling Season family and token doubling/Academy Manufactor behavior. Existing damage-prevention effects now create `PreventionService` shields.

Known mathematically commutative replacement combinations resolve without a meaningless order dialog while still using the same replacement pipeline.

### 8. Diagnostic trace

Each completed event records applied `replacementTrace` and `preventionTrace` entries. The replacement service also exposes a developer trace containing:

- `considered` replacement sets;
- `selected` replacement;
- `choice_requested` where ordering requires player input;
- `applied` transformation with before/after payload summaries.

`GameEngine.getReplacementTraceSnapshot()` and `getPreventionEffectsSnapshot()` expose immutable diagnostic views.

### 9. Dedicated Step 10 tests

Added `tests/step10-replacement-prevention.test.js` with **11 / 11 passing** tests covering:

1. affected-player ordering of noncommutative counter replacements;
2. protection against the same replacement reapplying to one event;
3. replacement of one canonical event type with another;
4. graveyard-to-exile zone replacement;
5. tapped/counter battlefield-entry replacement state;
6. token replacement composition including Academy Manufactor and a token doubler;
7. damage replacement before prevention;
8. unpreventable damage bypassing shields without consuming them;
9. prevention serialization and end-of-turn expiration;
10. generic Step 6 UI/AI replacement-order choice integration;
11. considered/selected/applied replacement diagnostics.

## Acceptance criteria

| Workflow criterion | Result |
| --- | --- |
| Multiple replacement effects can be ordered by the correct affected player | **PASS** — generic `REPLACEMENT_ORDER` choice is owned by the inferred/declared affected player. |
| The same replacement cannot loop on one event illegally | **PASS** — per-event applied-ID/usage tracking plus recursion guard. |
| Damage prevention interacts with damage replacement in tested order | **PASS** — replacements run first, prevention second, authoritative damage commit third. |
| Counter/token/draw/zone replacement scenarios pass regression tests | **PASS** — all four categories have direct Step 10 coverage. |

## Verification

Final verification on the Step 10 working tree:

- **327 / 327 non-stress repository tests passing**
- **1 / 1 long deterministic stress/deadlock test passing**
- Effective total: **328 / 328 tests passing across deterministic shards**
- **11 / 11 Step 10-specific tests passing**
- `npm run check:architecture`: **PASS**
- `npm run check-db`: **PASS — 647 cards / 13 decks**
- `npm run audit:mutations`: **315 internal direct mutation locations**
- production UI direct authoritative-state mutation paths: **0**
- production AI direct authoritative-state mutation paths: **0**
- player-zone mutations remain isolated to `src/engine/zones/`
- long deterministic stress test: **PASS** in approximately 32.3 seconds in this container

## Production-build environment note

A fresh `npm run build` was attempted. The Scryfall refresh could not reach the network and correctly retained the local **647-card** seed catalog. The container still does not contain the project's installed `node_modules`, so the build command then stops with:

`sh: 1: vite: not found`

This is the same environment dependency limitation as prior checkpoints, not a failing rules-engine/database regression. The engine tests, architecture guard, database validation, and stress suite all pass.

## Next gate

Step 10 is the second increment in **Release B — Core Rules Correctness**. Step 11 — **Continuous Effects, Derived Characteristics and Layers** — has **not** been started in this checkpoint.
