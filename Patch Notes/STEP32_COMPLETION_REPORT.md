# Step 32 Completion Report — Runtime Invariant Checker

## Objective
Detect impossible authoritative game states immediately during development and simulation and produce reproducible diagnostics instead of silently continuing after corruption.

## Completed work

- Added `InvariantChecker` and `InvariantViolationError` under `src/engine/diagnostics/`.
- Integrated invariant checking with `GameEngine` at stable action/choice boundaries and loop-shortcut boundaries.
- Added physical-card inventory tracking so non-token cards cannot silently disappear or exist in more than one authoritative zone.
- Added active `gameObjectId` uniqueness checks.
- Added stack-reference and stable-ID validation.
- Added active-player, turn-order, and priority validation, including eliminated-player priority protection.
- Added attachment existence and stable-boundary legality validation.
- Added finite numeric authoritative/derived state checks.
- Added unsupported runtime node detection.
- Added automatic invariant-failure logging and reproducible diagnostic bundle capture.
- Exposed `checkInvariants`, `setInvariantChecks`, `getInvariantReport`, and `getInvariantFailureBundle` through `GameEngine`.
- Added the `test:step32` package script and dedicated Step 32 regression suite.

## Acceptance criteria status

- Injected corruption is detected within one transaction boundary: PASS.
- Invariant failure reports carry deterministic reproduction metadata: PASS.
- Simulation/game actions stop through a structured invariant error instead of silently continuing: PASS.
- Invariant tests are available to CI through the normal test glob and `npm run test:step32`: PASS.

## Step 32 dedicated verification

`npm run test:step32` — 11/11 tests passed.
