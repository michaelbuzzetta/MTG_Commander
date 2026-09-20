# Phase 70 — Batch 2 next step

Continued the same incomplete Batch 2.

Changes in this checkpoint:
- Added executable handling for theme-color Oracle markers as card metadata rather than leaving them unresolved.
- Preserved the Phase 71 generalized combat/mechanic templates already staged in the prior checkpoint.
- Refactored the Phase 66 audit path to avoid expensive full-card compilation for cards whose paragraphs already prove unresolved, while keeping full compilation/validation mandatory before a card can be classified fully executable.
- Added an incremental validated promotion report at `coverage/phase70-next-promotions.json`.

Validation actually run:
- `node --check src/cards/compiler/OracleTemplateLibrary.js` — PASS.
- `node --check scripts/build-phase66-universal-coverage-audit.mjs` — PASS.
- Phase 51–55 + Phase 61–65 targeted regression tests — 11/11 PASS.
- Incremental full-card compiler validation against the previous Phase 66 unresolved population — 599 cards currently compile fully under the current compiler relative to that older audit snapshot.

Important: 599 is not represented as the completed Batch-2 promotion count because the precise Batch-2 baseline differs from the older Phase-66 snapshot. The >=1,000 Batch-2 completion gate is therefore still not claimed as satisfied.

The existing compiler-promotions test remains dependent on a generated runtime promotion artifact/card DB state that is absent/stale in this ZIP; it failed its DB-presence assertion when run and was not silently ignored.
