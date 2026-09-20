# Step 38 - Performance and Scalability Optimization

Step 38 adds correctness-preserving performance infrastructure after the rules, replay, invariant, and fuzzing layers are already in place. The optimizations are deliberately non-authoritative: cache/profiler state lives outside `GameState`, and an optimized run must reproduce the same replay hashes as a run with performance optimizations disabled.

## Implemented optimization layers

- **Derived-characteristic memoization** caches continuous/layer results only at stable query boundaries. A conservative dependency fingerprint covers hand sizes, battlefield objects, counters, modifiers, copy/face state, attachments, life/player counters, and continuous-effect topology so legacy/direct setup mutations cannot leave stale derived values.
- **Dirty-state invalidation** increments a non-authoritative state revision after committed events and completed actions. Source-topology changes maintain a separate topology revision for rule indexes.
- **Trigger source indexing** groups card/mechanic `TriggerDefinition`s by observed event type and rebuilds only when the source topology changes. Dynamic predicates and intervening conditions are still evaluated for every event.
- **Replacement indexing** groups both registered replacement effects and battlefield replacement abilities by canonical event type, avoiding a full ability scan for unrelated events.
- **Zone candidate indexing** reuses stable zone candidate sets for targeting while retaining the same player/zone order as the authoritative state.
- **Legal-action memoization** reuses an exact legal-action result only when a conservative action-state fingerprint is unchanged.
- **Headless simulation mode** disables UI-facing rules logging while preserving the same engine, legal-action, replay, RNG, invariant, and rules paths used interactively.
- **Profiling and benchmark reports** record cache counters, named timing samples, representative four-player workload timings, and explicit CI regression thresholds.

## Correctness guarantees

Performance metadata is excluded from serialized game state and replay hashing. Step 38 tests run the same seeded fuzz sequence with optimizations both enabled and disabled and require identical action traces, per-action replay hashes, and final state hashes. Trace-mode layer inspection also bypasses derived memoization so diagnostics always show a fresh effect application trace.

## Commands

```bash
npm run check:step38
npm run test:step38
npm run benchmark:step38
```

The benchmark writes `performance-artifacts/step38-benchmarks.json`. The threshold file is `tests/performance/step38-thresholds.json`; it intentionally uses broad CI guardrails to catch large regressions rather than noisy microbenchmark differences.

## Representative workloads

The benchmark suite exercises a four-player board with many permanents and multiple continuous effects, repeated derived-characteristic evaluation, repeated target generation over a large battlefield, repeated legal-action queries, and an eight-action four-player headless seeded fuzz segment. A scheduled GitHub Actions job runs the same benchmark and uploads the report.
