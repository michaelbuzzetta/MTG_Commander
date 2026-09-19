# Step 9 Completion Report — Triggered Ability Engine

## Status

**COMPLETE — gated Step 9 checkpoint. Step 10 has not been started.**

Step 9 converts the project's ordinary triggered abilities into data-driven subscriptions over the Step 3 event stream, queues them until the appropriate rules boundary, implements multiplayer APNAP placement/ordering, adds generic intervening-if behavior, and adds first-class delayed/reflexive trigger registrations.

## Implemented deliverables

### 1. TriggerDefinition model

Added `src/engine/triggers/TriggerDefinition.js`.

Every card data entry with `ability.type === "triggered"` is normalized into a canonical definition containing its event pattern, source zones, source/card/ability identity, controller relation, source/affected filters, conditions, intervening-if predicate, optionality, targets, effect, and trigger kind.

The current authoritative card database contains **79 data-declared triggered abilities across 70 cards**, and all of them normalize through this generic definition path.

### 2. Trigger registry

Added `TriggerRegistry` for two sources of definitions:

- normal card-backed triggered abilities, compiled from card data on demand;
- persistent temporary delayed/reflexive registrations stored in canonical `GameState.triggerRegistrations`.

Temporary definitions serialize/restore with the game state and support one-shot/repeatable behavior plus event/turn/phase expiration metadata.

### 3. Event-stream TriggerMatcher

Added `TriggerMatcher` and connected `TriggerEngine` to the generic `EventDispatcher.subscribe('*', ...)` interface.

The matcher evaluates:

- event pattern;
- source zones;
- source card/object identity;
- controller relationships;
- composable Step 6 `sourceFilter` and `affectedFilter` predicates;
- current trigger condition vocabulary;
- intervening-if conditions.

The dispatcher no longer has a bespoke `triggers.collect(...)` path. Completed event records are published once and the trigger subsystem independently observes them.

### 4. Pending trigger queue

Added `PendingTriggerQueue` and canonical `GameState.pendingTriggers` handling.

Matched abilities capture their source/LKI snapshot, triggering event/provenance, controller, effect, targeting state, optional decision, and trigger-definition identity. They are queued rather than resolved during the triggering event.

Public action execution now defers trigger placement until the action has completed and the current state-based-action pass has stabilized. The cleanup path explicitly flushes cleanup-generated triggers before determining whether another cleanup step is required.

### 5. Four-player APNAP ordering

Simultaneous trigger placement uses the actual living-player turn order rotated from the active player.

- Active player's triggers are stacked first.
- Nonactive players follow in turn order.
- Eliminated players are skipped.
- Each player orders only their own simultaneous triggers.
- `TRIGGER_ORDER` uses the existing engine-owned choice mechanism.

Dedicated tests verify the complete four-player ordering behavior.

### 6. Intervening-if support

Intervening-if conditions are checked:

1. when an event would cause the ability to trigger; and
2. again when the triggered ability resolves.

The resolution pipeline suppresses the effect and emits a diagnostic entry when the resolution-time condition fails.

### 7. Delayed and reflexive triggers

Added `registerDelayedTrigger()` and `registerReflexiveTrigger()`.

These use the same TriggerMatcher, pending queue, APNAP handling, choices, targeting, and stack as card triggers. They may retain source snapshots, survive the original source leaving the battlefield, expire after firing, or expire at configured event/turn/phase boundaries.

### 8. Source-zone and LKI correctness

Battlefield remains the default trigger source zone. Other zones are consulted only when a trigger explicitly declares them, preventing cards in hidden zones from accidentally gaining battlefield-style triggered abilities.

Leave/dies triggers use Step 8 LKI, preserving the source's prior object identity and characteristics. Stack-source triggered abilities are also supported for spells that explicitly declare `sourceZone: "stack"`.

### 9. Migrated one-off cast trigger

`Bygone Marvels` previously used the bespoke `castCopyCondition` field and a manual trigger stack insertion in `GameEngine._applyCast`.

That special case has been removed. Its Descend 8 cast trigger is now ordinary card data using:

- `event: SPELL_CAST`;
- `sourceZone: stack`;
- a generic graveyard permanent-count condition;
- the reusable `copySpellByInstance` effect.

A dedicated regression test proves the trigger is discovered from the spell on the stack through `TriggerDefinition` rather than the deleted one-off handler.

### 10. Hidden-information preservation

Step 8 viewer snapshots now also redact delayed/reflexive registration source snapshots when the viewer is not permitted to know the underlying hidden object. Pending trigger source/event data remains redacted through the existing hidden-information service.

### 11. Dedicated Step 9 tests

Added `tests/step9-triggered-abilities.test.js` with **13/13 passing** tests covering:

1. event-stream trigger discovery and non-immediate resolution;
2. four-player rotated APNAP placement;
3. per-player simultaneous-trigger ordering;
4. intervening-if trigger-time/resolution-time checks;
5. delayed one-shot trigger behavior;
6. delayed trigger expiration;
7. reflexive trigger registration;
8. explicit nonbattlefield source zones;
9. leave/dies LKI source snapshots;
10. serialization/restoration of temporary trigger registrations;
11. composable source/affected trigger filters;
12. normalization of every existing data-declared triggered ability;
13. data-driven Bygone Marvels stack-source cast trigger.

## Acceptance criteria

| Workflow criterion | Result |
| --- | --- |
| Simultaneous four-player triggers stack correctly | **PASS** — rotated APNAP batching and per-controller ordering are tested. |
| Intervening-if tests pass both trigger-time and resolution-time checks | **PASS**. |
| Delayed triggers expire after firing or becoming impossible/as configured | **PASS** — one-shot and explicit expiration cases tested. |
| Migrated cards no longer use bespoke callbacks | **PASS for ordinary data-declared triggers** — 79 current triggered abilities use `TriggerDefinition`; Bygone Marvels' former one-off cast handler was removed. |

## Verification

Final verification on the packaged working tree:

- **316 / 316 non-stress repository tests passing**
- **1 / 1 long deterministic stress test passing**
- Effective total: **317 / 317 tests passing across deterministic shards**
- **92 / 92 dedicated workflow Step 1–9 tests passing**
- **13 / 13 Step 9-specific tests passing**
- `npm run check:architecture`: **PASS**
- `npm run check-db`: **PASS — 647 cards / 13 decks**
- deterministic multiplayer simulation/regressions: **PASS**
- long stress/deadlock regression: **PASS**
- mutation inventory regenerated after Step 9: **312 internal direct mutation locations**; production UI/AI remain at **0** direct authoritative-state mutation paths, and player-zone mutations remain isolated to `src/engine/zones/`.

## Build environment note

A fresh Vite production build was attempted. The Scryfall refresh correctly fell back to the local 647-card trainer catalog because external network access was unavailable. The container does not contain the project's installed `node_modules`, so the Vite invocation then stops with `vite: not found`.

This remains an environment dependency limitation rather than a failing rules/database test. Engine tests, architecture enforcement, database validation, multiplayer regressions, and stress regression all pass.

## Next gate

Step 9 begins **Release B — Core Rules Correctness**. Step 10 — **Replacement and Prevention Effects** — has **not** been started in this checkpoint.
