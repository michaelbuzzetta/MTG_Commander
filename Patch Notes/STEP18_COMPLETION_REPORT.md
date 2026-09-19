# Step 18 Completion Report — Oracle Text Template Compiler

## Status

**COMPLETE for the Step 18 workflow checkpoint.**

This checkpoint builds directly on `MTG_Commander_Step17_Complete.zip` and implements the workflow's reviewed Oracle-text template compiler. The compiler is intentionally fail-closed: it automates only exact, unique, high-confidence full-text templates and routes every other card to explicit review.

## Delivered

### 1. Oracle tokenizer / normalized parser input

Added `src/cards/compiler/OracleTokenizer.js` with deterministic Oracle normalization, tokenization, numeric-word parsing, Oracle-text fingerprints, and a versioned parser constant (`1.0.0`). Mana symbols, signed P/T values, punctuation, bullets, and newlines remain explicit parser tokens.

### 2. High-confidence Oracle template library

Added `OracleTemplateLibrary.js` with 11 exact template families covering the Step 18 starter patterns: fixed draw, fixed damage, destroy/exile target, fixed pump until EOT, basic-land search, utility-token creation, ETB life gain, ETB utility tokens, and simple +1/+1-counter triggers.

Templates require a complete rules-text match. Compound cards that only begin with a recognized sentence are rejected for review instead of being partially executed.

### 3. AST → Step 16 ability IR compiler

Added `OracleAstCompiler.js` and `OracleTemplateCompiler.js`. Exact templates compile to the existing Step 16 versioned script schema, are revalidated by `ScriptValidator`, and lower through the normal authoritative targeting, stack, trigger, search, zone, counter, token, damage, and EffectEngine paths.

Targeted scripted spells now propagate their target specification to the normal card-level cast contract. Scripted basic-land search lowers through the existing player-choice-aware land-search path. Simple counter templates can refer to the source permanent generically.

### 4. Confidence / review queue and measurable compiler coverage

Added `scripts/build-oracle-templates.mjs` plus generated compiler artifacts for all 647 authoritative cards. Current results:

- 647 cards analyzed
- 4 exact high-confidence auto-compilations
- 643 review-required
- 187 high-priority review rows from Step 17's `auto-template-candidate` group
- 11 available high-confidence template families

Current exact matches are Divination, Murder, Disenchant, and Rampant Growth. Cards already handled manually are not mislabeled as unsupported merely because their full Oracle text is not yet in the template grammar.

### 5. Oracle/parser semantic diff tooling

Added `OracleChangeDiff.js` plus a versioned compiler snapshot. Oracle text changes are fingerprinted and recompared through the compiler; parser snapshot changes identify exactly which cards changed generated behavior and which merely passed through a parser-version update unchanged.

### 6. CI/check integration

Added:

- `npm run build-oracle-templates`
- `npm run check-oracle-templates`
- `npm run test:step18`

`npm run verify` now includes Step 18 generated-artifact validation.

## Acceptance criteria

| Workflow criterion | Result |
| --- | --- |
| Common templates compile deterministically | **PASS** — deterministic parser/script/behavior output is tested. |
| Unknown/ambiguous Oracle text never executes without review | **PASS** — only unique exact high-confidence full-text matches auto-compile. |
| A parser-version change identifies exactly which card implementations changed | **PASS** — snapshot diff distinguishes parser-only and behavior-changing rows. |
| Compiled scripts pass the same behavioral contracts as manual scripts | **PASS** — representative draw/removal parity is tested and search lowers through the existing authoritative choice path. |

## Verification

Final verification on the Step 18 working tree:

- **413 / 413 non-stress repository tests passing**
- **15 / 15 Step 18-specific tests passing**
- **107 / 107 targeted Steps 6 + 10–18 interaction/compiler tests passing**
- `npm run check-db`: **PASS — 647 cards / 13 decks**
- `npm run check-support`: **PASS — 647 cards / 13 decks; 26 fully supported, 621 partial, 0 explicitly unsupported**
- `npm run check-oracle-templates`: **PASS — 647 analyzed; 4 exact auto-compilations; 643 review-required**
- `npm run check:architecture`: **PASS**
- `npm run audit:mutations`: completed; inventory refreshed (**313 internal direct mutation paths**)

## Production-build environment note

`npm run build` was attempted. Scryfall refresh was unavailable and correctly fell back to the checked-in 647-card seed. The checkpoint intentionally does not contain installed `node_modules`, so Vite then stops with `vite: not found`. The rules/compiler/database/architecture test gates above are independent of that environment-only dependency limitation.

## Scope note

Step 18 establishes the reusable template compiler and review pipeline; it does **not** claim that all 647 cards can now be generated from Oracle text. The current compiler deliberately accepts only four cards from the present data because those are the complete rules texts that exactly match the initial high-confidence grammar. Expanding the grammar is safe because every new template must remain deterministic, reviewed, and regression-tested.

## Next workflow step

Step 19 — **Loop Detection and Gameplay Shortcuts** — has not been started in this checkpoint.
