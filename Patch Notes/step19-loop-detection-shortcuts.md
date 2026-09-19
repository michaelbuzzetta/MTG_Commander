# Step 19 — Loop Detection and Gameplay Shortcuts

## Goal

Step 19 makes repeated deterministic game sequences observable and bounded so legal Commander combos do not require hundreds of manual clicks and malformed/mandatory recursion cannot hang simulations.

The implementation is engine-owned. UI and AI still submit ordinary legal actions; loop detection observes the authoritative state/action/event stream and never bypasses validation, priority, triggers, replacements, state-based actions, or the stack.

## Components

### `src/engine/loops/LoopStateHasher.js`

Builds a compact rules-state fingerprint from dynamic game data rather than re-hashing static Oracle definitions on every action. The fingerprint includes turn/phase/active/priority context, player resources and ordered zones, battlefield dynamic state, stack, combat, pending triggers/effects/choices, turn modifiers and other current rule state. Diagnostic-only history/knowledge logs are excluded so logging does not hide a true cycle.

A structural fingerprint can ignore transient object IDs when classifying repeated progressing patterns. Resource vectors track life, mana, zone counts and counters for progress classification.

### `LoopService.js`

Observes successful action boundaries and classifies repeated sequences as:

- `mandatory_infinite`
- `optional_loop`
- `deterministic_resource`
- `loop_with_choices`
- `progress_toward_termination`

Exact repeated authoritative states are treated as no-progress cycles. Repeated action patterns with changed resource vectors are distinguished from true no-progress cycles so resource-producing combos and naturally terminating repeated actions are not conflated.

Detected loops store a stable signature, period, semantic action sequence, classification, progress delta and shortcut eligibility. Choice-dependent and terminating loops are deliberately not auto-shortcut eligible.

### `LOOP_SHORTCUT` action

`LOOP_SHORTCUT` is a first-class player action. A shortcut can specify either:

- a positive finite `iterations` count, or
- a validated `until` condition plus a maximum iteration budget.

Supported repeat-until conditions currently cover mana thresholds, life thresholds, hand-size thresholds and player-counter thresholds. Exact no-progress optional loops require an explicit finite count because a repeat-until condition cannot change in such a loop.

Every expanded step is revalidated against the live engine and runs through the normal action, priority, trigger and SBA boundaries. The expansion is **not** written as hundreds of replay clicks. Replay stores one semantic shortcut action containing the stable loop signature and the certified sequence used for expansion.

`LoopShortcutController.js` provides common finite/repeat-until action builders for human UI and AI callers. `getLoopShortcutActions()` exposes executable one-iteration shortcut candidates, while `getLoopSnapshot()` exposes immutable diagnostics for richer UI controls.

### Mandatory recursive loop handling

`EventDispatcher` marks active event frames with their pre-commit authoritative state and event fingerprint. If the same mandatory event request recursively re-enters at the same state, Step 19 treats that as a mandatory no-progress loop and resolves the game as a draw rather than recursing indefinitely.

This is intentionally stricter than an arbitrary recursion cutoff: exact mandatory no-progress recursion receives the rules outcome, while nonrepeating runaway recursion is handled by the safety budget below.

### `SimulationSafetyBudget.js`

The safety budget caps:

- nested action depth
- nested event depth
- shortcut iteration count
- expanded shortcut action count
- retained loop observations

Budget failures produce structured `SIMULATION_SAFETY_BUDGET_EXCEEDED` diagnostics containing turn, phase, active/priority player, current depth/counters and configured limits. The budget is a fail-safe, not a substitute for loop classification.

## Public engine additions

- `getLoopSnapshot()`
- `getLoopShortcutActions(playerId)`
- `getSafetyBudgetSnapshot()`
- `LOOP_SHORTCUT` in the canonical action vocabulary

Replay serialization now includes loop diagnostics and the active safety-budget snapshot.

## Rules/architecture guarantees

1. A shortcut cannot start while a player choice is pending.
2. A shortcut sequence containing choices or another shortcut is rejected.
3. Optional no-progress loops require an explicit finite count.
4. Repeat-until conditions must be from the validated condition vocabulary.
5. Every expanded action is legal at the moment it executes.
6. Mandatory exact recursive no-progress event loops resolve as a draw.
7. Nonrepeating runaway recursion terminates with a diagnostic instead of hanging.
8. Replay keeps a semantic shortcut representation sufficient for later deterministic replay expansion.
9. UI/AI receive immutable loop information and still act only through public `GameEngine` actions.

## Verification coverage

`tests/step19-loop-detection-shortcuts.test.js` covers state hashing, all five loop classes, exact optional loops, resource loops, finite shortcuts, repeat-until shortcuts, invalid no-progress repeat-until, terminating-resource classification, mandatory recursive draws, recursion safety budgets, compact replay representation, iteration limits and reset behavior.
