# Step 22 — Copy and Copiable Values

## Goal

Step 22 gives the rules engine one reusable copy model for permanents, tokens, spells, and abilities. Copy effects read **copiable values**, not the current rendered/derived state, and permanent copies participate in layer 1 before later continuous effects.

## CopiableValues model

`src/engine/copy/CopiableValues.js` captures rules-copy characteristics independently from physical object identity and mutable battlefield state. The snapshot includes name, mana cost/value, color indicator/colors, supertypes/types/subtypes, Oracle text, power/toughness/loyalty/defense, keywords, abilities, spell effects, layout, and copy modifications.

The snapshot deliberately excludes tapped state, counters, marked damage, controller history, attachments, and ordinary temporary continuous effects. A copy-of-a-copy reads the active copy snapshot, so copy modifications that became part of copiable values are preserved.

## Permanent copy engine

`CopyService.applyPermanentCopy()` stores an explicit copy state on the target object rather than overwriting its immutable printed/base characteristics. The copy state records source identity, timestamp, duration, effect source, and the captured copiable values.

Clone-style "as this enters" choices use the normal Step 6 choice protocol (`COPY_PERMANENT`). The choice is made while the permanent spell is in its pending-resolution transaction; after selection, battlefield resolution continues using the chosen copiable values.

Supported copy modifications include common "except" changes such as name, colors, type/subtype/supertype changes, removing Legendary, power/toughness, loyalty/defense, keywords, abilities, and text changes.

Zone changes away from the battlefield end battlefield copy effects by creating a new object incarnation. Last Known Information captures the copied derived state and copy snapshot before that transition.

## Copy-layer integration

Permanent copy state contributes a layer-1 continuous effect through `ContinuousEffectEngine`. The target starts from its physical base definition, receives its copiable-value replacement in layer 1, then receives later type/color/ability/P/T effects in normal layer order.

Copied definitions are also used by targeting, static abilities, triggers, replacement effects, mechanics, and Step 21 legality/stax extraction, so a copied rules text/ability changes engine behavior rather than only appearance.

## Token copies

`CopyService.createTokenCopy()` captures copiable values, creates a token definition from that snapshot, and routes quantity through the canonical `CREATE_TOKEN` replacement pipeline. Token-doubling effects therefore modify token-copy creation normally.

The created token owns an independent copiable snapshot. Once created, it does not depend on the source permanent remaining on the battlefield and does not inherit the source's counters, tapped state, marked damage, or temporary buffs.

## Spell and ability copies

The canonical COPY event now supports spells, activated abilities, and triggered abilities. Stack copies retain rules-relevant choices such as selected modes, X, divided quantities, targets, and copy metadata.

New targets are requested only when the copying effect explicitly grants retargeting. Otherwise the copy keeps the original targets without opening a choice. Copied permanent spells become noncommander tokens on resolution; copied instants/sorceries disappear after resolution rather than becoming physical cards.

## Public architecture

`getCopiableValues()` is an immutable query surface. Rules mutations remain inside the engine/copy/event/choice systems; direct copy-mutator helpers are not advertised as UI/AI public GameEngine APIs.

## Verification

Run `npm run test:step22` for the dedicated suite. Step 22 regression coverage includes base-vs-derived copying, copy-of-copy behavior, copy-layer ordering, temporary duration, independent token copies, token-doubling replacement interaction, spell decisions/retarget permissions, ability copying, Clone-style entry, copied permanent spells, LKI/zone changes, copied replacement abilities, and copied stax/legality behavior.
