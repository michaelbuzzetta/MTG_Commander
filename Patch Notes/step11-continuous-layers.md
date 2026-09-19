# Step 11 — Continuous Effects, Derived Characteristics and Layers

This checkpoint adds a reusable continuous-effect subsystem under `src/engine/continuous/`.

## Engine behavior

- Characteristics are derived from copiable/base values instead of permanently overwriting card objects.
- Layer ordering is represented explicitly for copy, control, text, type, color, ability, and power/toughness sublayers.
- Runtime effects carry timestamps and optional dependency edges; dependencies are resolved before timestamp fallback within a layer.
- Card-backed static effects are translated into the same derived-characteristic pass for type/subtype/color, keyword/ability, and P/T modifications.
- Characteristic-defining values such as hand-size P/T are recalculated from current game state.
- Existing special continuous rules (devotion creature state, station thresholds, flood counters, chosen subtype additions, P/T counters and temporary modifiers) are folded into the derived pass.
- `StaticEngine.isType`, `hasSubtype`, `derivedStats`, and `effectiveAbilities` now query the derived characteristics.
- Changeling remains recognized as every creature type.

## Public/debug queries

- `GameEngine.getDerivedCharacteristics(ref, { trace })`
- `GameEngine.getDerivedStats(ref)`
- `GameEngine.getEffectiveAbilities(ref)`
- `ContinuousEffectEngine.register()` / `unregister()` for card scripts and engine mechanics

## Tests

`tests/step11-continuous-layers.test.js` covers temporary effects, non-destructive derivation, layer order, timestamps, dependencies, ability removal, type changes affecting combat eligibility, and dynamic characteristic-defining P/T.
