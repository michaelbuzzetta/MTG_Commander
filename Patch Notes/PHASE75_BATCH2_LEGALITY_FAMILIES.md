# Phase 75 — Batch 2 legality-family compilation

Implemented:
- Direct Oracle compilation of each-player and opponent Rule-of-Law cast limits into executable legality ruleObjects.
- Direct Oracle compilation of player/opponent library-search prohibitions into executable legality ruleObjects.
- Direct Oracle compilation of one-card-per-turn draw restrictions into executable legality ruleObjects.
- Extended Ability IR, AST lowering, script validation, and CardScriptCompiler so static legality ruleObjects survive the full Oracle -> IR -> compiled-card pipeline instead of relying on legacy Oracle-text runtime recognition.

Validation actually run:
- JavaScript syntax validation: PASS.
- Phase 75 compiler tests + Phase 73/74 regressions + Step 21 permissions/restrictions: 25/25 PASS.

Catalog accounting:
- Last completed full-catalog audit remains 38,681 entries; 3,629 fully executable (9.38%).
- No higher catalog-wide total is claimed without a fresh completed full audit.
- Batch 2 remains open until >=1,000 newly fully executable cards are verified relative to its baseline.
