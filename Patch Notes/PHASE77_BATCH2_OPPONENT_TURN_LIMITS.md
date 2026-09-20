# Phase 77 — Batch 2 opponent-scoped turn limits

Continued incremental implementation without closing Batch 2.

Implemented two additional recurring Oracle restriction families through the compiled legality-rule pipeline:
- `Each opponent can't draw more than one card each turn.` -> opponent-scoped DRAW maxPerTurn rule.
- `Each opponent can't cast more than one spell each turn.` -> opponent-scoped CAST maxPerTurn rule.

These compile through OracleTemplateCompiler into static ruleObjects consumed by the existing authoritative LegalityService. No no-op or recognition-only promotion was added.

Validation actually run:
- Phase 73–77 targeted compiler regressions plus Step 21 permissions/restrictions suite: 32/32 PASS.
- OracleTemplateLibrary JavaScript syntax check: PASS.

Catalog accounting:
- Last completed full-catalog verified baseline remains 38,681 entries; 3,629 fully executable (9.38%).
- This phase does not claim a higher catalog total without a fresh completed catalog-wide audit.
- Batch 2 remains open.
