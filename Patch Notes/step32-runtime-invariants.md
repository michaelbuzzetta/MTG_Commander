# Step 32 — Runtime Invariant Checker

Step 32 implements runtime assertions for impossible authoritative game states. The checker runs only at stable GameEngine transaction boundaries, not in the middle of event commits where a temporarily inconsistent state may still be repaired by state-based actions.

## Implemented invariants

- Every physical non-token card remains present in exactly one authoritative zone unless its owner has been eliminated.
- A physical `instanceId` cannot appear in multiple zones.
- Active card objects cannot share a `gameObjectId`.
- Zone contents and each object's declared `zone` must agree.
- Stack objects require stable IDs, game-object IDs, valid controllers, and card backing for non-copy spells.
- Player order, active player, and priority references must remain valid; eliminated players cannot receive priority.
- Attachment relationships must reference existing objects and must be legal at stable boundaries after SBA cleanup.
- Core numeric state and numeric derived characteristics cannot become `NaN`/infinite.
- Unsupported runtime script/effect nodes are rejected by the invariant scan.

## Transaction-boundary behavior

`GameEngine` invokes the checker before and after normal action/choice transactions and after loop-shortcut expansion. A failure is converted into the normal structured action-error path instead of allowing simulation/gameplay to continue with corrupt state.

The checker can be disabled explicitly with `setInvariantChecks(false)` for controlled developer fixture setup, but it is enabled by default in this Step 32 build.

## Failure diagnostics

On failure the engine records:

- invariant code/message/detail
- turn and phase
- action/event sequence positions
- state hash
- rules/database versions
- structured developer logs
- event log and replacement/legality traces
- current authoritative state
- deterministic replay data when available

The latest failure is exposed through `getInvariantFailureBundle()` for CI, simulation, and bug-report tooling.

## Verification

The Step 32 regression suite injects duplicate-zone corruption, zone mismatches, missing stack controllers, eliminated-player priority, broken attachments, invalid numeric state, disappearing physical cards, duplicate game-object IDs, and corruption discovered at the next action boundary.
