# Step 6 Completion Report

## Scope

Completed **Step 6 — Universal Choice and Targeting Framework** from the MTG Commander Rules Engine 40% → 100% workflow, using the completed Step 5 checkpoint as the baseline. Step 7 has not been started.

## Implemented deliverables

### Canonical ChoiceRequest / ChoiceResponse protocol
- Added `src/engine/choices/ChoiceRequest.js`.
- Standardized fields include requesting player, choice type, legal options/filter, minimum/maximum count, ordering requirement, visibility, default/cancel legality, context id, source context, and metadata.
- Added generic choice classes for boolean, option, mode, number/X, color, name, player, targets, cards, permanents, order, divided quantities, and action choices.
- Choice responses record request id, selections, ordered selections, division data, cancellation, and metadata.

### ChoiceService and legacy migration adapter
- Added `src/engine/choices/ChoiceService.js`.
- Existing engine `pendingChoice` shapes are normalized to immutable `ChoiceRequest` snapshots instead of requiring UI/AI to understand every producer-specific schema.
- New rules code can open native `ENGINE_CHOICE` requests.
- Canonical responses are accepted through the existing public `submitChoice()` gateway and translated through compatibility adapters where legacy resolution code still exists.
- Legacy request ids are derived without mutating state during public reads.
- Added `GameEngine.getPendingChoiceRequest()` as a public immutable query.
- Choice creation stays engine-internal so consumers cannot fabricate an authoritative rules choice.

### Composable TargetFilter library
- Added `src/engine/choices/TargetFilter.js`.
- Supports AND / OR / NOT composition.
- Supports type, subtype, zone, kind, controller/owner/player relation, mana value, color, legendary status, attacking, blocking, tapped state, counters, name/card id, nonland, not-self, and custom engine predicates.
- Integrated composed filters into `TargetingEngine` without removing the existing target-clause behavior.

### Target versus choose semantics
- Target requests are explicitly marked `targeted` and validated through `TargetingEngine`.
- Shroud, hexproof, protection, ward-related targeting legality, and target multiplicity remain target-only concepts.
- Non-targeting card/permanent choices use the choice/filter path and therefore can legally choose an object with shroud when the card text says "choose" rather than "target."

### Revalidation
- `ChoiceResponse` validation reruns against live game state rather than trusting stale UI options.
- Permanent choices must still be on the battlefield.
- Filtered choices must still satisfy the filter.
- Target choices rerun authoritative target validation.
- Trigger-target requests now retain target-source/source-object context so their targets can be revalidated using the same targeting subsystem.
- Step 5 resolution continues to recheck targets again when the stack object resolves, preserving partial/all-illegal target behavior.

### Standard UI component
- Added `src/components/ChoiceDialog.jsx`.
- Renders engine-supplied options/counts/order/cancel/numeric input without embedding card rules.
- `App.jsx` reads `getPendingChoiceRequest()` and renders `ChoiceDialog` for engine-native Step 6 requests.
- Existing complex/specialized choice panels remain as migration compatibility UI and are backed by the same normalized request surface.

### AI choice adapter
- `AIController` now understands native `ENGINE_CHOICE` requests.
- AI answers the same `ChoiceRequest` contract used by the human UI and submits a structured response through `submitChoice()`.
- Engine validation remains authoritative, so strategy code cannot force an illegal option through the protocol.

### Replay serialization
- Successful choice replay entries now include the canonical `ChoiceRequest` snapshot that was active when the answer was submitted.
- The submitted response/action is preserved in the existing action replay.
- This makes the exact request and answer reproducible.

### Tests
Added `tests/step6-choice-targeting.test.js` with 10 dedicated Step 6 tests covering:
1. the standardized request/response choice vocabulary;
2. 20 representative composed target/filter patterns;
3. player/opponent relation targeting;
4. target versus non-targeting shroud semantics;
5. native choice submission and replay serialization;
6. stale-permanent revalidation;
7. target revalidation after live legality changes;
8. exact/up-to/any-number/order/division constraints;
9. AI use of the same native ChoiceRequest;
10. generic UI integration without embedded rules logic.

## Acceptance criteria verification

- **At least 20 representative target/choice patterns work without card-specific UI:** PASS. The Step 6 suite exercises 20 target/filter patterns plus 13 generic choice classes through engine-owned schemas.
- **Hexproof/shroud/protection only affect appropriate target paths:** PASS. Target validation rejects shroud/hexproof/protection where applicable; a non-targeting permanent choice can still select the same shrouded permanent.
- **AI cannot select an illegal option:** PASS. AI produces a structured ChoiceResponse/`SUBMIT_CHOICE`; the response is still revalidated by `ChoiceService` and the authoritative action validator.
- **Replay reproduces the exact choices:** PASS. Replay entries retain both the canonical request snapshot and submitted response/action.

## Regression verification

The repository now contains **282 tests total**.

Final verification after the Step 6 changes:
- general engine/UI/card/AI/category shard: **205/205 passing**;
- Step 1–6 + synergy + user-deck shard: **66/66 passing**;
- deterministic multiplayer suite: **10/10 passing**;
- stress suite: **1/1 passing**.

Total: **282/282 passing**.

Additional verification:
- Step 6-specific suite: **10/10 passing**.
- Step 1 architecture boundary: **PASS**.
- Database validation: **PASS — 647 cards / 13 decks**.
- Deterministic four-player simulation: **PASS**.
- Stress regression: **PASS**.
- Mutation-path inventory regenerated after Step 6: **306 internal direct mutation locations**; production UI/AI remain at **0** direct authoritative-state mutation paths.

A single monolithic `npm test` invocation can exceed the execution environment's command-duration limit because long multiplayer/stress simulations contend for CPU when launched together. The complete 282-test suite was therefore verified in deterministic shards; this is not a test failure.

## Build environment note

A fresh Vite production build cannot be completed in this container because `node_modules` is not installed and `vite` is therefore unavailable. The engine/tests do not require that package installation, so rules, architecture, database, multiplayer, and stress verification were still completed. This is the same environment dependency limitation as prior checkpoints.

## Step boundary

Step 7 — **Mana, Costs and Payment** — has **not** been started. The new choice protocol supplies the standardized selection/payment-decision surface that Step 7 can consume without adding cost-specific UI rules.
