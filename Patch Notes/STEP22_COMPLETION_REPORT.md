# Step 22 Completion Report — Copy and Copiable Values

## Status

**COMPLETE for the Step 22 workflow checkpoint.**

This checkpoint builds directly on the Step 21 legality checkpoint and introduces one reusable copy subsystem for permanents, tokens, spells, and abilities.

## Delivered

### 1. CopiableValues model

Added `src/engine/copy/CopiableValues.js`. Copiable values are explicitly separate from immutable physical-card identity and from later derived characteristics. The snapshot contains the rules characteristics required by copy effects while excluding tapped state, counters, marked damage, attachments, controller history, and ordinary temporary buffs.

### 2. Permanent copy engine and layer 1

Added `CopyService` permanent-copy state with source identity, timestamp, duration, source tracking, copy modifications, and captured copiable values. `ContinuousEffectEngine` now applies permanent copies in `LAYER.COPY` before later layers. Copy-of-copy uses the active copy snapshot, preserving copy modifications that are themselves copiable.

### 3. Clone-style as-enters choices

Permanent spells may declare `copyAsEnters`. Resolution pauses with a standard `COPY_PERMANENT` choice, validates the selected battlefield object, applies copy/except modifications, and then resumes the original permanent-resolution transaction.

### 4. Token copies

Token copies are created from a stable copiable snapshot and route through canonical `CREATE_TOKEN`, so token-doubling replacement effects still apply. Source counters/tapped state/damage/temporary buffs are not copied, and the token remains correct after the original source leaves.

### 5. Spell and ability copies

The COPY event now supports spell, activated-ability, and triggered-ability stack objects. Copies preserve modes, X, divisions, original targets, and other stack choices. Retargeting is offered only when the copy effect explicitly grants it. Copied permanent spells resolve as noncommander tokens.

### 6. Cross-system copied characteristics

Copied definitions now feed continuous/static rules, targeting, triggers, replacement effects, the mechanic library, and Step 21 legality/stax extraction. Last Known Information records copy state/metadata before the copied permanent changes zones.

## Acceptance criteria

| Workflow criterion | Result |
| --- | --- |
| Clone and token-copy tests produce expected base characteristics | **PASS** — Clone entry and independent token-copy regression tests cover copied base values and source departure. |
| Temporary buffs/counters are not incorrectly copied | **PASS** — dedicated regression proves counters, tapped state, marked state, and temporary P/T modifications remain source-only. |
| Copied spells retain correct choices and targeting rules | **PASS** — modes, X, divided values and original targets are retained; target changes require explicit retarget permission. |
| Copy effects participate correctly in layer recalculation | **PASS** — copy layer is traced before later P/T continuous effects and copy-of-copy retains copy modifications. |

## Verification

Final verification on the Step 22 working tree:

- **469 / 469 non-stress repository tests passing**, executed in four bounded complete batches across all 50 non-stress test files
- **15 / 15 Step 22-specific tests passing**
- **163 / 163 targeted Step 6 + Steps 10–22 tests passing**
- `npm run check-db`: **PASS — 647 cards / 13 decks**
- `npm run check-support`: **PASS — 26 fully supported / 621 partial / 0 explicitly unsupported**
- `npm run check-oracle-templates`: **PASS — 647 analyzed / 4 exact high-confidence / 643 review-required**
- `npm run check:architecture`: **PASS**
- `npm run audit:mutations`: completed; inventory refreshed (**329 internal direct mutation paths**)

## Production-build environment note

`npm run build` was attempted. Scryfall refresh was unavailable and correctly fell back to the checked-in 647-card seed. This archive intentionally does not contain installed `node_modules`, so the final Vite command stops with `vite: not found`. Engine/database/support/compiler/architecture/test gates above do not require that missing local install.

## Scope note

Step 22 implements reusable copy/copiable-value primitives and high-value interactions. Card-by-card migration remains governed by Steps 16–18 support metadata; this checkpoint does not claim that every historical Oracle copy card has already been declaratively migrated.

## Next workflow step

Step 23 — **Attachments**.
