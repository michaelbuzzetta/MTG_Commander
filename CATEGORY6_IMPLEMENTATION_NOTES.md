# Category 6 Implementation Notes

## Scope

This update implements **Category 6: Targeting, Stack, and Protection Mechanics** only. It resolves **BUG-028 (Targeting)** and **BUG-029 (Hexproof / Ward)** from the repair plan. Category 7 work is intentionally not included.

## Targeting system

- Added `src/engine/TargetingEngine.js` as the shared target-legality layer.
- Targeted casts and activated abilities now carry explicit target instance/player IDs in their actions.
- Target counts and restrictions are validated before mana/life/tap costs are paid.
- Chosen targets are preserved on stack objects rather than rediscovered at resolution.
- Legal target generation used by `LegalActions`, the UI, and the AI goes through the same targeting predicates as authoritative action validation.
- Reusable target predicates cover players, permanents, cards in zones, controller/owner relationships, type/subtype restrictions, distinct targets, shroud, hexproof, basic protection-from handling, and optional card-specific predicates.

## Stack resolution

- Targeted spells and abilities recheck their original targets as they resolve.
- If every target has become illegal, the stack object is countered by the rules and does not resolve.
- If only some targets are illegal, effects apply only to the targets that remain legal.
- Targeted effects no longer fall back to arbitrary battlefield searches when their chosen target is missing or illegal.

## BUG-028 card fixes

- `Murder` now requires an explicit legal creature target. It cannot be cast without one and no longer destroys the first creature found by the effect engine.
- `Lightning Bolt` now targets a legal player, creature, or planeswalker supported by the engine instead of being hard-coded to the opposing player.
- The authoritative source card data and generated runtime card data were rebuilt together.

## BUG-029 protection mechanics

- Hexproof now prevents an opposing player from selecting a protected permanent as a target while still allowing its controller to target it.
- Shroud is handled by the same centralized legality layer.
- Ward is modeled as a triggered stack interaction, not blanket target immunity.
- When an opponent targets a permanent with ward, a ward stack object is created above the targeting spell/ability.
- When the ward trigger resolves, the targeting player may pay the ward cost or decline; declining (or being unable to pay) allows the original targeting spell/ability to be countered according to the chosen action.
- Mana and life ward costs use the existing payment/state systems.

## UI and AI

- The React UI now enters an explicit target-selection state before submitting targeted casts/abilities, so costs are not paid before target selection is complete.
- Legal target permanents are highlighted; legal player targets are exposed as target buttons.
- Target selection can be cancelled or undone before submission.
- Ward exposes explicit **Pay Ward** and **Do Not Pay** choices.
- The AI consumes legal targeted actions from the same `LegalActions`/`TargetingEngine` path and handles ward decisions.

## Regression coverage

Added `tests/category6.test.js` and `tests/category6-ui.test.js` covering:

- Murder target requirement and exact target preservation.
- Lightning Bolt player/creature/planeswalker targeting.
- Targeted activated abilities.
- Hexproof and shroud.
- Cards targeted in non-battlefield zones.
- Ward payment and decline/counter behavior.
- All-targets-illegal resolution behavior.
- Partial target legality for multi-target stack objects.
- AI target selection.
- UI target-selection and ward decision paths.

## Verification

- `npm run check-db`: **PASS** — 44 cards and 6 decks validated from the authoritative source schema.
- `npm test`: **PASS** — 89 tests passed, 0 failed.
- `node --check` on modified non-JSX engine/AI modules: **PASS**.
- `npm run build`: not executable in this sandbox because the uploaded archive does not include `node_modules` and the sandbox could not install dependencies; the command stops at `vite: not found`. This is an environment/dependency-install limitation, not a failing application build result. Run `npm ci && npm run build` in a normal network-enabled development environment for the Vite production-build check.
