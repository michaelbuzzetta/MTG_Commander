# Step 36 — Judge Scenario Regression Library

## Objective

Create a permanent curated library of judge-style rules interactions that exercises difficult combinations of otherwise-correct subsystems. The library complements primitive, pairwise, and per-card golden tests by preserving complete starting states, action sequences, player choices, expected ordering, final-state assertions, and rules notes.

## Architecture

- `tests/judge-scenarios/step36-scenarios.json` is the auditable scenario manifest.
- `tests/judge-scenarios/scenario.schema.json` defines the scenario data contract.
- `tests/judge-scenarios/Step36ScenarioLibrary.js` contains executable deterministic scenario implementations.
- `tests/judge-scenarios/ScenarioHarness.js` provides seeded engines, reusable fixture creation, semantic trace capture, and automatic failure diagnostics.
- `tests/judge-scenarios/snapshots/step36-critical-traces.json` stores normalized expected ordering milestones for the hardest scenarios.
- `tests/step36-judge-scenarios.test.js` validates the format and executes the full library.
- `scripts/check-step36-judge-scenarios.mjs` validates coverage, required categories, implementations, and trace snapshots.
- `.github/workflows/judge-scenarios.yml` runs the gate on changes and nightly.

## Initial curated scenarios

1. Layer/dependency ordering with type, ability, and power/toughness interactions in the same class of problems as Blood Moon/Humility/Opalescence interactions.
2. Multiple noncommutative replacement effects with affected-player ordering.
3. Simultaneous lethal damage, state-based actions, deaths, and death triggers.
4. Four-player APNAP simultaneous trigger ordering.
5. Atomic multiplayer player elimination and cleanup.
6. Control-change interaction with control-sensitive Aura legality.
7. Commander movement timing differences between hand/library and graveyard/exile.
8. Copy plus later type/ability continuous effects.
9. Permanent regression for the Step 33 pending-resolution library-search bug.

## Failure behavior

A failing scenario emits a deterministic reproduction bundle under `coverage/judge-scenario-failures/<scenario-id>.json`. The bundle includes scenario metadata plus Step 31/32 diagnostic information: seed, replay, state hash/state, event logs, verbose rules logs, replacement traces, legality diagnostics, and invariant information.

## Development commands

- `npm run check:step36` — validate schema coverage, category coverage, executable mappings, and trace snapshots.
- `npm run test:step36` — execute the full judge scenario library.
- `node --test --test-name-pattern='J36-APNAP-004' tests/step36-judge-scenarios.test.js` — target one scenario during development.

## Gate

Step 36 is green only when every registered scenario passes. New cross-system rules bugs must be added to the library before the fix is considered complete.
