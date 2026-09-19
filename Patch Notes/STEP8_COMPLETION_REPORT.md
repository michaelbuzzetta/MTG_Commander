# Step 8 Completion Report — Zones, Zone Changes, Hidden Information and Last Known Information

## Status

**COMPLETE — gated Step 8 checkpoint. Step 9 has not been started.**

Step 8 centralizes player-zone movement, establishes viewer-specific hidden-information boundaries, tracks legally known hidden cards, and captures Last Known Information before zone changes. This checkpoint also carries forward the completed Step 7 cost/payment implementation so the package contains the full cumulative Steps 1–8 codebase.

## Implemented deliverables

### 1. Authoritative Zone API

Added `src/engine/zones/ZoneService.js` and `ZoneTypes.js`.

`ZoneService` is now the production owner of player-zone mutation. It provides lookup, detach/place/move, reorder, shuffle, within-zone movement, zone replacement, battlefield control transfer, and eliminated-player cleanup operations.

`ZoneManager.js` remains only as a compatibility facade. Legacy state-zone helpers were moved behind `src/engine/zones/legacyStateZoneApi.js` so direct player-zone editing remains contained inside the zone boundary.

### 2. Canonical MOVE_ZONE transaction

`ENGINE_EVENT.MOVE_ZONE` now performs the complete zone-change transaction:

- validates source/destination;
- captures source zone, owner/controller, and pre-move object identity;
- captures LKI before mutation;
- performs the authoritative move through `ZoneService`;
- creates a new rules-object incarnation;
- records previous/new `gameObjectId`, incremented `zoneChangeId`, and `lkiId` in event provenance;
- updates known information;
- emits leave-battlefield observations using pre-change data;
- handles spell copies without creating physical cards in destination zones.

### 3. Hidden-information permission layer

Added `HiddenInformationService` and `GameEngine.getPlayerStateSnapshot(viewerId)` integration.

Player/AI snapshots now enforce legal visibility:

- own hand visible;
- opponent hands opaque while preserving counts;
- all libraries opaque by default;
- only exact cards made known by look/reveal/search permissions become visible;
- private pending choices do not leak candidate ids to other players;
- event/trigger payloads are redacted when they embed hidden cards;
- raw LKI is engine-internal and not exposed through player snapshots.

Returned player snapshots are detached and immutable.

### 4. Known-information tracker

Added `KnownInformationTracker`.

The engine can now distinguish:

- private `look` knowledge;
- public `reveal` knowledge;
- exact search/choice authorization;
- stale knowledge that must be forgotten after a hidden-zone move;
- library knowledge invalidated by shuffling.

Known-information state is serialized with the canonical game state.

### 5. Last Known Information service

Added `LastKnownInformationService`.

Before a zone change the engine captures:

- owner/controller;
- previous object identity and zone;
- counters and damage state;
- attachments;
- base/face characteristics;
- derived power/toughness/characteristics;
- effective abilities;
- event/reason/turn/phase metadata.

Legacy fixtures are canonicalized before capture so LKI always has a stable rules-object identity. Records can be queried internally by prior `gameObjectId` or physical `instanceId` and are bounded by pruning.

### 6. Commander movement integration

Commander zone movement now uses the centralized path.

- Hand/library movement can create the command-zone replacement choice before the card moves.
- Graveyard/exile movement is observed first, with the existing state-based action opening the command-zone choice at the correct later point.
- Choosing the command zone performs another canonical `MOVE_ZONE`, preserving event provenance.

### 7. Token zone behavior

Tokens use `MOVE_ZONE` normally, allowing leave/dies information and LKI to exist. The state-based-action loop then removes tokens from non-battlefield zones, so tokens cannot remain illegally in hand/library/graveyard/exile/command.

### 8. Static architecture guard

`scripts/check-architecture.mjs` now rejects direct production mutation/replacement of `.library`, `.hand`, `.battlefield`, `.graveyard`, `.exile`, and `.command` arrays outside `src/engine/zones/`.

This makes the Step 8 zone boundary enforceable in CI/development rather than relying on convention.

### 9. Performance correction

The first secure viewer-snapshot implementation cloned full hidden libraries and unbounded history before redaction, which slowed long multiplayer simulations as history grew. The final implementation builds viewer snapshots from public metadata and per-zone visibility and includes only a bounded redacted history window.

This preserves hidden-information security without making four-player simulation progressively slower.

### 10. Dedicated Step 8 tests

Added `tests/step8-zones-hidden-lki.test.js` with **12/12 passing** tests covering:

1. opponent-hand and all-library concealment;
2. private look versus public reveal;
3. shuffle invalidation of library knowledge;
4. private pending-choice redaction;
5. exact hidden search/choice authorization;
6. object-incarnation/event provenance on `MOVE_ZONE`;
7. LKI pre-zone characteristics;
8. replacement-transform integration point;
9. commander hand/library replacement movement;
10. token move then cease-to-exist behavior;
11. serialization/restoration of known-information and LKI state;
12. static zone-mutation architecture guard.

## Acceptance criteria

| Workflow criterion | Result |
| --- | --- |
| No production code directly edits zone arrays | **PASS** — architecture checker rejects player-zone mutators outside `src/engine/zones/`. |
| AI knowledge tests prove hidden cards are inaccessible | **PASS** — viewer snapshots conceal unauthorized hands/libraries and private choice candidates. |
| Dies/LKI tests use pre-zone-change characteristics correctly | **PASS** — LKI captures controller, counters, effective abilities, and derived P/T before movement. |
| Commander replacement tests route to command zone properly | **PASS** — commander replacement/choice paths use canonical `MOVE_ZONE`. |

## Verification

Verification was run in deterministic shards because a monolithic `node --test tests/*.test.js` invocation causes the container's long simulation suites to contend for CPU and can exceed command-duration limits. The suites themselves pass when run in controlled groups.

Final verification:

- **303 / 303 non-stress repository tests passing**
- **1 / 1 long stress test passing**
- Effective total: **304 / 304 tests passing across deterministic shards**
- **79 / 79 dedicated workflow Step 1–8 tests passing**
- **12 / 12 Step 8-specific tests passing**
- `npm run check:architecture`: **PASS**
- `npm run check-db`: **PASS — 647 cards / 13 decks**
- deterministic multiplayer tests: **PASS**
- deterministic long stress regression: **PASS**
- mutation inventory regenerated after Step 8: **312 internal direct mutation locations**; production UI/AI remain at **0** direct authoritative-state mutation paths, and player-zone mutations are isolated to `src/engine/zones/`.

## Build environment note

A fresh Vite production build was attempted. Scryfall refresh correctly fell back to the local 647-card trainer catalog when network access was unavailable, but this execution container does not have `node_modules` installed, so the final Vite invocation stops with `vite: not found`.

This is an environment dependency limitation, not a failing rules/database test. The engine tests, architecture check, database validation, multiplayer regression, and stress regression all pass.

## Foundation gate status

Step 8 is the end of **Release A — Foundation and Engine Isolation**. Steps 1–8 now provide the authoritative engine/state/event/turn/stack/choice/cost/zone foundation required by the workflow.

Step 9 — **Triggered Ability Engine** — has **not** been started in this checkpoint.
