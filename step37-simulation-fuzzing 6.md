# Step 37 - Simulation Fuzzing and Property-Based Testing

Step 37 adds seeded legal-action fuzzing above the authoritative rules engine. The fuzzer asks `getLegalActions()` for the current actor, biases selection toward unusual choices/targets/modes rather than strong play, and submits those actions through the normal `submitAction`/`submitChoice`/priority APIs.

## Properties checked after every action
- No engine crash.
- Every selected action originated from the legal-action generator and is accepted by the engine.
- Runtime invariants remain green, including physical-card uniqueness and valid turn/priority state.
- Repeated unchanged authoritative state is bounded so permanent priority deadlocks surface as failures.
- Failures keep the exact game seed, bot seed, replay, state hash, turn/phase and last action.

## Reproducibility and failure handling
The bot uses a separate seeded PRNG for action selection so it does not perturb the engine's seeded gameplay RNG. Runtime failures are persisted under `fuzz-artifacts/failures/`. A prefix replay minimizer is provided for practical sequence reduction without reordering state-dependent actions. Confirmed defects must be promoted into deterministic regression tests, following the Step 36 bug-to-regression policy.

## Commands
- `npm run test:step37` - deterministic Step 37 smoke/property suite.
- `npm run fuzz:step37 -- --seeds=8 --actions=2000` - local seeded fuzz campaign.
- `npm run check:step37` - validates the Step 37 deliverables.

A scheduled GitHub Actions workflow runs the campaign nightly and uploads the summary/failure corpus when a run breaks.
