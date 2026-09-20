# Phases 40–42 — Automated Interaction, Fuzzing, Performance Hardening

## Step 40 — Automated real-card pair testing
A deterministic catalog-pair runner samples thousands of pairs from the bundled real-card database, compiles both cards in interleaved order, checks for compiler exceptions and state leakage/non-determinism, and writes `coverage/phase40-card-pair-audit.json`. This complements the hand-authored cross-system interaction matrix by continuously exposing combinations that are individually legal but stress shared compiler state.

## Step 41 — Fuzz/property testing
The existing authoritative legal-action FuzzBot is promoted into this workflow. The Phase 41 runner executes seeded games across multiple deck pairings with invariant checks after authoritative actions. Failures retain deterministic replay/corpus support through the existing fuzz infrastructure. The batch smoke test verifies state invariants under generated legal sequences.

## Step 42 — Performance & stability
The existing production performance profiler and benchmark workload are promoted into the current workflow. It exercises derived characteristics/layers, target generation, repeated legal-action queries, and four-player headless simulation against checked thresholds. This guards against progressive degradation as card coverage grows.

These phases intentionally do not mark unsupported Oracle text as supported merely because pair/fuzz tests do not crash. Semantic support remains governed by the catalog census/compiler classifications.
