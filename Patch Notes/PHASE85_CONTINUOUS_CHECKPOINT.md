# Phase 85 Continuous Checkpoint
Intermediate resumable checkpoint; release gate remains FAIL.

## Implemented
- Expanded executable creature-ETB modal parsing to strip named mode labels before semantic compilation.
- Added modal support for tap/untap target nonland permanent.
- Added modal support for returning target artifact or enchantment cards from your graveyard to hand.
- Added focused compiler regressions for these modal families.

## Verification
- Phase 85 focused tests: 3/3 passed.
- Full Phase 66 catalog audit rerun after implementation.
- See generated Phase 66 audit for current counts; release gate remains FAIL.

## Next action
Reload this checkpoint and immediately continue from the highest-impact unresolved semantic cluster. Do not treat this checkpoint as completion.
