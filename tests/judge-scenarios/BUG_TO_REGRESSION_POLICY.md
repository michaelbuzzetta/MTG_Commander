# Bug-to-Regression Policy

Step 36 treats every confirmed rules defect as a permanent judge scenario or a permanent lower-level regression test. For defects that cross subsystem boundaries, affect ordering/timing, involve multiplayer state, or would be difficult to understand from a primitive test alone, add a judge scenario before the production fix is merged.

## Required workflow

1. Reproduce the defect with the smallest deterministic starting state possible.
2. Add a new scenario metadata entry with a stable `J36-*` identifier, subsystem tags, starting state, semantic actions, expected choices, expected outcome, rules references, and reproduction notes.
3. Add its executable implementation to `Step36ScenarioLibrary.js`.
4. Run `npm run test:step36` and confirm the new scenario fails for the original defect.
5. Fix the engine at the most reusable rules layer available; do not encode the fix only in the scenario.
6. Re-run the new scenario, the tagged subsystem tests, and the complete Step 36 library.
7. Keep the scenario permanently. Do not remove it when the implementation changes.
8. If the scenario exposed a particularly subtle order dependency, add a normalized critical trace snapshot.
9. A Step 36 failure automatically writes a reproduction bundle under `coverage/judge-scenario-failures/` with the deterministic seed, state, replay, event log, verbose rules log, replacement trace, and invariant information.

The `J36-BUG-SEARCH-RESOLUTION-009` scenario is the first migrated example of this policy: it preserves the Step 33 search-choice/pending-resolution defect as a permanent cross-system regression.
