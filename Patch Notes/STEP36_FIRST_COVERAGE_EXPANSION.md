# Step 36 — First Coverage Expansion

Step 36 uses the Step 35 census rather than hand-picked cards to choose compiler work. The first expansion implements four high-frequency, engine-safe Oracle families:

1. Keyword paragraphs can now compose when a card declares additional supported keywords. The old equality requirement incorrectly rejected lines such as `Flying` on a card whose keyword list also contained `Haste`.
2. Typed self-entry tapped wording (`This land/creature/artifact/enchantment enters tapped.`) now maps to the existing MOVE_ZONE replacement primitive.
3. Standalone Aura `Enchant ...` restrictions and enchanted-creature fixed P/T clauses now compose through the existing attachment/continuous-effect system.
4. Standalone Equipment `Equip {N}` and equipped-creature fixed P/T clauses now compose through the existing attachment/continuous-effect system.
5. Split-card separator lines (`//`) are structural delimiters rather than executable Oracle paragraphs during composition.

Post-expansion full-catalog results:
- Fully compiled: 1,973 (5.10%), +93 versus Step 35
- Partially compiled: 10,463 (27.05%), +4,752 versus Step 35
- Manual review: 26,245 (67.85%), -4,845 versus Step 35
- Compiler crashes/failures: 0
- At least partially understood: 12,436 (32.15%), +4,845 cards

This is intentionally conservative. High-frequency families such as mana abilities, cycling, Sagas, modal headers, Ward, Crew, Partner, Convoke, and Devoid remain queued because they require dedicated authoritative runtime semantics or richer IR; Step 36 does not mark them supported merely because their text is recognizable.

Regression verification: the dedicated Step 36 expansion tests, Step 18 Oracle compiler tests, and Step 34 Commander edge-case tests pass together (46/46). A full `npm test` campaign was started but exceeded the execution window; no claim is made that the entire repository suite completed in this environment. The offline Vite build could not be re-run because dependencies were not present and `npm ci` exceeded the execution window. Existing built artifacts are therefore preserved rather than regenerated.
