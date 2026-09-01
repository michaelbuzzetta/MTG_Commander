# MTG AI Trainer v3 — Category 4 Implementation Notes

## Category 4: Combat Engine

Implemented against the Category 3 updated baseline. This cycle addresses the repair-plan findings assigned to Category 4 only:

- BUG-014 — noncreature permanents could block
- BUG-015 — one blocker could be reused across multiple attackers
- BUG-016 — duplicate attacker/blocker identities could be accepted
- BUG-017 — first-strike blockers failed to deal first-strike damage when the attacker lacked first/double strike
- BUG-018 — a double-strike attacker could become effectively unblocked after its blocker died in first strike
- BUG-019 — attacking player had no blocker damage-assignment-order choice
- BUG-020 — indestructible creatures died to lethal/deathtouch state-based destruction
- BUG-052 — combat UI could create invalid attacker/blocker selections

## Engine changes

### Combat legality

`CombatEngine.canBlock()` now requires both the blocker and attacker to be creatures, in addition to existing tapped/flying/reach checks. Block declarations validate blocker identity globally across the declaration so the same creature cannot block more than one attacker. Duplicate attacker IDs and duplicate blocker IDs are rejected before combat mutation.

### Persistent combat relationships

Combat state now records a dedicated `blocked` flag per attacker. Once an attacker has been blocked, it remains blocked for the rest of combat even if all declared blockers later leave the battlefield. This fixes the double-strike breakthrough regression. Trample still functions correctly: if all blockers leave, a blocked trampler may assign its remaining combat damage to the defending player.

### First strike and double strike

Combat damage participation is evaluated independently for each attacker and each blocker. A first-strike or double-strike blocker therefore deals damage during the first-strike damage step even when the attacker does not have first strike.

### Damage-assignment order

When an attacker is blocked by multiple creatures, the engine now creates a `COMBAT_DAMAGE_ORDER` decision for the attacking player before priority opens. The decision is completed through the authoritative `ORDER_BLOCKERS` action. The selected order is stored in `combat.damageAssignments` and persists through both damage steps.

The damage routine applies lethal-before-next ordering, respects deathtouch when determining lethal assignment, supports trample spillover, and preserves the selected order if some blockers later leave combat.

### Indestructible state-based actions

State-based actions now distinguish:

- toughness 0 or less — the creature is put into its owner's graveyard even if indestructible;
- lethal marked damage/deathtouch — destroys only if the creature is not indestructible.

This fixes the audited lethal/deathtouch indestructible regression without changing the separate `destroy()` behavior.

## UI changes

The combat UI now uses engine legality instead of allowing arbitrary selections:

- attacker clicks are limited to `CombatEngine.legalAttackers()` candidates;
- blocker clicks are validated with `CombatEngine.canBlock()`;
- a blocker is removed from any old assignment before reassignment, preventing duplicate use;
- clicking an already assigned blocker toggles it off;
- Confirm Blockers is disabled while the current blocker map fails engine validation (for example, one blocker against menace);
- illegal combat selections show a decision message instead of waiting for the engine to throw on confirmation;
- when multiple creatures block one attacker, the attacking player is prompted to click blockers in desired damage-assignment order before combat can continue.

A minimal AI handler was added for the new damage-order decision so AI-active combat cannot deadlock when the defending player multi-blocks.

## Regression coverage added

New Category 4 tests cover:

1. lands/noncreatures cannot block;
2. blocker reuse across attackers is rejected;
3. duplicate attacker/blocker IDs are rejected;
4. first-strike blockers deal first-strike damage correctly;
5. blocked double-strike attackers remain blocked after the blocker dies;
6. blocker damage-assignment order is chosen by the attacking player and persists;
7. indestructible survives lethal/deathtouch destruction but dies at 0 toughness;
8. attacker UI selection is driven by engine legal attackers;
9. blocker UI selection/confirmation is legality-driven and supports reassignment/removal/order choices.

## Verification

- `node --check` passed for modified non-JSX engine/AI files.
- `npm run check-db` passed: 44 cards and 6 decks validated.
- `npm test` passed: **68/68 tests**.
- The Vite production build was not run successfully in this sandbox because npm dependencies were not installed in the supplied archive and dependency installation could not complete in the sandbox. No `node_modules` directory is included in the packaged result.

## Category 4 exit status

The eight Category 4 audit findings listed above have been implemented with regression coverage. Categories 1–3 behavior remains covered by the full passing test suite.
