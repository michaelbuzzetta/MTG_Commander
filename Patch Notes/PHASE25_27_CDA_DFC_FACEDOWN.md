# Phase 25–27 — CDAs, Double-Faced Cards, and Face-Down Mechanics

Oracle compiler version: 3.9.0.

## Step 25 — Characteristic-defining abilities
- Oracle AST now has a characteristic/CDA path that lowers through Ability IR.
- Common dynamic */* families can derive P/T from controller hand size, creatures controlled, or cards in the controller's graveyard.
- CDA P/T is applied in the existing PT_CDA (layer 7a) path rather than ordinary set/modify P/T layers.

## Step 26 — Transform and modal DFC behavior
- Transform effects route through ENGINE_EVENT.TRANSFORM and the canonical CardFace model.
- Triggered self-transform Oracle text can compile to the shared transform primitive.
- Existing MDFC cast-face selection remains authoritative: the chosen spell face is used on the stack and retained as the entering permanent face.
- Multi-face cards reset to front-face characteristics outside the battlefield/stack as required by the current digital model.

## Step 27 — Morph and disguise
- Morph and disguise Oracle paragraphs compile to a shared faceDownCasting contract.
- Face-down casts use the {3} alternative casting cost and resolve as 2/2 colorless, nameless, ability-less creatures through ContinuousEffectEngine.
- TURN_FACE_UP is an explicit special action: it validates and pays the printed face-up cost, does not use the stack, and restores face-up characteristics.
- Disguise face-down permanents expose Ward {2} through the shared ward mechanic.
- Unsupported face-down families or non-mana turn-face-up costs remain fail-closed rather than approximated.

## Validation
Focused regression suite: 79/79 passing.
Oracle artifact check: 647 curated cards validated; 17 exact high-confidence auto-compilations and 630 review-required.
