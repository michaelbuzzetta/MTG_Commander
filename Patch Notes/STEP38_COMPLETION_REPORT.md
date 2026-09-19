# Step 38 Completion Report - Performance and Scalability Optimization

## Objective
Optimize four-player Commander and batch simulation workloads without changing authoritative rules results.

## Implemented
- Added non-authoritative performance profiling and cache services under `src/engine/performance/`.
- Added mutation/topology revisions and conservative dependency fingerprints so cached values cannot become authoritative state.
- Added dependency-aware derived-characteristic memoization.
- Added event-type/source indexes for triggered abilities and replacement effects.
- Added reusable zone-candidate indexing for target generation.
- Added legal-action memoization guarded by a conservative player/game-state fingerprint.
- Added `headless` `GameEngine` mode that disables UI-facing rules-log accumulation while preserving authoritative actions, events, replay, seeded RNG, and invariants.
- Added `HeadlessSimulationRunner` for deterministic 2-4 player simulation workloads.
- Added a Step 38 benchmark suite covering a large battlefield, continuous effects, repeated target generation, repeated legal-action generation, and a four-player headless action workload.
- Added machine-readable benchmark thresholds and persisted JSON performance reports.
- Added a scheduled GitHub Actions performance regression workflow.

## Acceptance criteria mapping
- **Optimization does not alter replay hashes/results:** the Step 38 parity test executes the same seeded legal-action fuzz sequence with performance optimizations enabled and disabled and asserts identical action traces, final authoritative state hashes, and replay action hashes.
- **Representative 4-player turns remain responsive:** the benchmark includes a four-player headless workload and fails if its configured threshold is exceeded.
- **Batch simulations scale predictably:** headless mode avoids UI/log-rendering overhead, preserves seeded determinism, and exposes profiling/cache metrics for batch workloads.
- **Performance regressions are visible:** `benchmark:step38` writes `performance-artifacts/step38-benchmarks.json` and exits non-zero if any configured threshold is exceeded; CI publishes the artifact.

## Verification performed
Dedicated Step 38 gates:
- `npm run check:step38` — PASS.
- `npm run test:step38` — 5/5 PASS.
- `npm run benchmark:step38` — PASS.

Targeted regression suites after the optimization changes:
- Step 9 Triggered Ability Engine — 13/13 PASS.
- Step 10 Replacement and Prevention Effects — 11/11 PASS.
- Step 11 Continuous Effects / Layers — 6/6 PASS.
- Step 29 AI authoritative legal actions — 8/8 PASS.
- Step 30 Deterministic replay — 8/8 PASS.
- Step 31 Rules/event logging — 8/8 PASS.
- Step 32 Runtime invariants — 11/11 PASS.
- Step 34 Cross-system interactions — 13/13 PASS.
- Step 35 Golden card behavior — 30/30 PASS.
- Step 36 Judge scenarios — 10/10 PASS.
- Step 37 Simulation fuzzing — 5/5 PASS.

Latest Step 38 benchmark measurements in this environment:
- Derived-characteristic workload: ~7.1 ms (threshold 8000 ms).
- Target-generation workload: ~36.1 ms (threshold 8000 ms).
- Repeated legal-action workload: ~1.1 ms (threshold 5000 ms).
- Four-player headless 8-action workload: ~2119.4 ms (threshold 30000 ms).

## Environment limitations noted during verification
A repository-wide `npm test` run exceeded the sandbox execution window, so this report does not claim that the entire historical test matrix completed in one monolithic invocation. The relevant subsystem/regression suites listed above were run directly and passed. A production Vite build could not complete because this supplied checkpoint contains an incomplete `node_modules` tree and the Vite executable is absent; the prebuild card sync correctly fell back to the local card catalog when network retrieval was unavailable.

## Commands
```bash
npm run check:step38
npm run test:step38
npm run benchmark:step38
```

## Next workflow step
Step 39 - Rules-Driven UI Completion.
