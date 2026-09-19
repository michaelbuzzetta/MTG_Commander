# Step 5 — Full Stack and Priority System

This checkpoint replaces the legacy free-form stack/pass-cycle compatibility logic with a dedicated stack schema, stack mutation service, multiplayer priority manager, and transactional resolution pipeline. It builds directly on the Step 4 turn engine: Step 4 decides **when** priority exists; Step 5 decides **who has it, how it passes, when the stack resolves, and how resolution is validated**.

## Module layout

- `src/engine/stack/StackObject.js` — canonical `StackObject` constructor, validation, and public snapshot representation.
- `src/engine/stack/StackService.js` — the single stack push/pop/find/remove/query gateway.
- `src/engine/stack/PriorityManager.js` — multiplayer consecutive-pass tracking, priority retention, all-pass outcomes, and cleanup integration.
- `src/engine/stack/ResolutionPipeline.js` — transactional top-of-stack resolution with target revalidation and correct post-resolution movement.
- `src/engine/stack/StackPriorityHarness.js` — deterministic stack/priority view model for tests and UI rendering.
- `src/engine/stack/index.js` — public Step 5 module exports.

`GameEngine` remains the authoritative public rules boundary established in Step 1. UI/AI do not mutate the stack or priority state directly.

## Canonical StackObject

Every newly-created stack item now has a normalized rules-facing representation. The schema preserves current compatibility fields while guaranteeing the choices needed for later legality checks and deterministic resolution:

- stable stack `id`;
- `gameObjectId` for the stack incarnation;
- controller and source;
- spell/activated ability/triggered ability/ward type;
- card or ability/effect payload;
- selected mode(s);
- targets;
- X value;
- divided quantities;
- chosen additional costs;
- chosen alternative cost/cast option;
- copy status and copy provenance/retarget metadata.

Spell objects are represented as `objectKind: "spell"`; nonspell stack items are `objectKind: "ability-on-stack"`. State hydration normalizes older serialized stack entries into this schema so the Step 2 state format remains backward compatible.

## StackService

`StackService` centralizes stack mutations through:

- `push()`
- `pop()`
- `peek()`
- `find()`
- `remove()`
- `getSnapshot()`

New spell, activated-ability, triggered-ability, ward, saga, encore, and spell-copy paths now use the service. Public snapshots are detached and immutable at the `GameEngine` API boundary.

## Multiplayer priority manager

`PriorityManager` owns the consecutive-pass cycle for every living player.

### Granting priority

The Step 4 turn engine opens rules-defined priority windows. Step 5 then tracks the current priority player and pass count. Eliminated players are skipped.

### Passing

Each pass increments a consecutive-pass counter and sends priority to the next living player in turn order.

If every living player passes consecutively:

- **nonempty stack:** resolve exactly the top object, reset the pass count, then begin a new priority round;
- **empty stack:** advance to the next Step 4 turn step/phase;
- **cleanup priority window:** create the required repeated cleanup step instead of ending the turn.

Any legal non-pass action resets consecutive-pass tracking.

### Retaining priority

After taking a legal action while holding priority, that player may take another legal action before passing. This supports deliberate priority retention and arbitrary nested response chains. The AI and human clients use the same authoritative legal-action surface; no special UI mutation is required.

## Stack bypasses

Objects/actions that do not use the stack remain outside it:

- mana abilities resolve immediately;
- turn-based actions remain Step 4 operations;
- special existing nonstack rules paths continue to bypass stack insertion where appropriate.

Activated abilities and triggered abilities that do use the stack are canonical `StackObject`s.

## Transactional resolution pipeline

`ResolutionPipeline` snapshots authoritative state plus Step 3 event-dispatcher state before resolving the top stack object. If effect execution throws, the transaction is restored rather than leaving a partially-mutated game.

Resolution performs the following high-level sequence:

1. Pop the top object through `StackService`.
2. Resolve ward-payment objects when applicable.
3. Recompute the appropriate target source/filter.
4. Re-check target legality using current game state.
5. If all targets are illegal, counter the spell/ability on resolution according to the rules path.
6. If only some targets are illegal, preserve legal targets and continue partial resolution.
7. Execute effects in their stored written/script order.
8. Suspend correctly for an engine choice when an effect creates one.
9. Finish the spell/permanent and emit the existing resolution event.
10. Run state-based-action compatibility processing before priority resumes.

### All targets illegal

For a targeted object whose targets are all illegal at resolution:

- its effects do not resolve;
- a noncopy spell moves to the graveyard;
- a spell copy does not become a physical graveyard card;
- the engine logs `COUNTERED_ON_RESOLUTION` for diagnostics.

This is handled by the rules engine, not by UI special cases.

### Partial resolution

If at least one target remains legal, illegal targets are removed from the resolution target set and the object continues resolving against the legal targets. A `PARTIAL_TARGET_RESOLUTION` diagnostic record captures both sets.

### Spell movement and copies

- Instant/sorcery spells move to their configured after-resolution zone, normally the graveyard.
- Instant/sorcery copies resolve without moving a nonexistent physical card to a zone.
- Permanent copies enter using existing permanent-resolution compatibility behavior and are represented as tokens where appropriate.
- Countered noncopy spells move to the graveyard through the centralized counter path.

## Priority/stack visual harness

`buildStackPriorityView()` exposes a deterministic, rule-free rendering model with:

- phase;
- active player;
- priority player;
- consecutive passes;
- living player order;
- stack depth;
- top object id;
- full bottom-to-top public stack snapshot.

The harness contains no rules decisions. It exists so React can render authoritative state and so stack/priority behavior can be snapshot-tested without moving rules logic into the UI.

`GameEngine` exposes:

- `getStackSnapshot()`
- `getPrioritySnapshot()`
- `getStackPriorityView()`

These are immutable public query APIs.

## AI-turn automation

Existing automatic opponent-turn progression still preserves actual priority internally. Human automation may auto-pass when there is no meaningful response, but it pauses when the human has a legal meaningful stack response or required choice. Automation therefore changes clicking behavior, not the underlying priority rules.

## Replay / diagnostics integration

Stack and priority actions continue through the Step 1 action/replay API, and stack resolution uses the Step 3 event engine. Step 5 deliberately avoids appending a verbose history entry for every routine priority pass because that history is part of the current canonical state snapshot and doing so created avoidable cloning overhead in long Commander simulations. Rules-significant exceptional resolution outcomes remain logged.

## Acceptance coverage

`tests/step5-stack-priority.test.js` verifies:

1. canonical StackObject choices/cost/copy metadata;
2. immutable stack/priority snapshots and visual harness;
3. four-player all-pass resolution ordering;
4. pass-count reset after another legal action;
5. mana abilities bypassing the stack while ordinary activated abilities use it;
6. retaining priority to add multiple spells before passing;
7. arbitrary nested responses resolving LIFO;
8. all-targets-illegal counter-on-resolution handling;
9. partial target resolution;
10. transactional rollback on resolution failure;
11. human/AI automation preserving real priority and pausing for meaningful responses;
12. countering a spell copy removes only the copy and never creates a physical graveyard card;
13. priority skips an active player eliminated during resolution and goes to the next living player.

Existing Step 1–4, combat, multiplayer, AI, card, deck, synergy, and stress regressions remain green.

## Deliberate Step 5 boundary

This checkpoint does **not** implement Step 6's universal `ChoiceRequest` / `ChoiceResponse` and composable target-filter framework. Existing choice/target compatibility systems are consumed by the Step 5 resolution pipeline and will be generalized deliberately in Step 6 rather than being mixed into this checkpoint.
