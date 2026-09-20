# Phase 76 — Batch 2 stax migration

Implemented direct Oracle compilation into executable legality ruleObjects for five families previously handled only by the legacy runtime compatibility adapter:
- one-attacker-per-combat restrictions
- one-blocker-per-combat restrictions
- Ghostly-Prison-style fixed attack taxes
- nonbasic-land untap restrictions
- players-cast-only-on-their-own-turn restrictions

These now survive Oracle -> AST -> Ability IR -> compiled card and are enforced by the existing authoritative LegalityService paths. The legacy adapter remains for backward compatibility.

Validation actually run:
- Phase 76 + Phase 75 + Phase 74 + Phase 73 + Step 21 legality regression suite: 30/30 PASS.
- OracleTemplateLibrary JavaScript syntax check: PASS.

Catalog accounting:
- Last completed full-catalog audit remains 38,681 entries; 3,629 fully executable (9.38%).
- No higher total is claimed without a fresh completed full-catalog audit.
- Batch 2 remains open until >=1,000 newly fully executable cards are verified relative to its baseline.
