# Step 37 Completion Report - Simulation Fuzzing and Property-Based Testing

## Objective
Use automated seeded legal-action exploration to discover crashes, stuck states, illegal-action acceptance/rejection mismatches and invariant corruption that hand-authored scenarios may miss.

## Implemented
- Added `src/engine/fuzz/FuzzBot.js` with engine-authoritative legal-action exploration.
- Added novelty weighting for choices, targets, modes, activated abilities and spell casting.
- Added a bot-only seeded RNG so fuzz decisions remain reproducible without contaminating gameplay randomness.
- Added property assertions for crashes/rejections, runtime invariants and priority/state deadlock detection.
- Added replay/seed failure persistence via `FailureCorpus`.
- Added safe shortest-failing-prefix minimization helper.
- Added multi-deck seeded smoke/property tests.
- Added CLI fuzz campaign runner and nightly GitHub Actions job.
- Added failure-corpus promotion policy documentation.

## Acceptance criteria mapping
- Thousands/millions of legal actions: the runner is action-budget driven and intended for repeated nightly campaigns; CI smoke tests use smaller deterministic budgets while nightly defaults to many thousands of actions.
- Every fuzz failure reproducible: game seed, bot seed, replay and state hash are persisted automatically.
- Confirmed fuzz bugs become deterministic regressions: failure-corpus documentation explicitly requires promotion into permanent unit/interaction/golden/judge coverage.

## Verification
Run:
```bash
npm run check:step37
npm run test:step37
npm run fuzz:step37 -- --seeds=2 --actions=250
```
