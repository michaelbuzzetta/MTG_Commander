# Phase 10 — Non-hand casting and alternative-cost permissions

Phase 10 extends the MongoDB/Oracle behavior compiler and authoritative casting pipeline for reusable non-hand casting permissions.

## Implemented
- Declarative cast options can originate from graveyard or exile.
- Cast options may provide an alternative mana cost.
- Cast options may waive the mana cost without waiving additional rules costs.
- Cast options may independently grant instant timing ("as though it had flash").
- Oracle templates cover normal graveyard/exile self-casting, flash-timing variants, alternative-cost variants, free-cast variants, and the existing flashback path.
- CostEngine and TimingService consume the same compiled casting-option metadata used by LegalActions/GameEngine.
- Unknown/conditional/linked casting permissions still fail closed to review_required rather than being guessed.

## Validation
Focused Phase 10 + Oracle compiler + permission/restriction suite: 48/48 passing.
Oracle compiler artifacts rebuilt and accepted at parser v2.2.0: 647 cards scanned, 17 exact high-confidence, 630 review-required.
