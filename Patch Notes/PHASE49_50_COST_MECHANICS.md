# Phase 49–50 — Cost Mechanics Expansion

## Step 49 — Kicker and additional mana costs
- Added exact Oracle compilation for fixed-mana `Kicker {cost}` paragraphs.
- Kicker is represented as a declarative `kicked` casting option with an additional mana cost.
- CostEngine now appends declarative additional mana costs to the normal/alternative cost instead of replacing the spell cost.
- Kicker state remains represented by the stack object cast option (`castOption: kicked`) so downstream `if ... was kicked` semantics can key from authoritative cast history.

## Step 50 — Cycling
- Added exact Oracle compilation for fixed-mana `Cycling {cost}` paragraphs.
- Cycling lowers to an activated ability usable from hand, with mana plus discard-self as costs and draw-one as the effect.
- Added authoritative `discardSelf` lowering to the existing PaymentService discard primitive.
- CardScriptCompiler now preserves source-zone declarations for activated abilities.

## Deliberate limits
Non-mana Kicker variants and typecycling are still fail-closed. Crew is intentionally deferred to Step 51 because its selected-creature total-power payment and temporary Vehicle animation require separate authoritative selection/payment semantics.
