# Step 18 — Oracle Text Template Compiler

## Goal

Step 18 adds a deterministic, review-gated Oracle-text compiler that converts a deliberately narrow set of exact Oracle constructions into the Step 16 declarative ability IR. The compiler is **not** a natural-language rules interpreter. It only auto-accepts a card when the complete normalized Oracle text has one unique high-confidence template match. Partial matches, unknown text, and ambiguous matches are queued for review and never become executable automatically.

## Architecture

### Tokenizer and parser version

`src/cards/compiler/OracleTokenizer.js` owns Oracle normalization, deterministic tokenization, numeric-word parsing, a stable Oracle-text fingerprint, and `ORACLE_PARSER_VERSION`.

The tokenizer preserves rules-significant structures such as mana symbols, signed values, slash-separated P/T values, bullets, punctuation, and line breaks. Parser output always carries the parser version and Oracle fingerprint so a future parser change can be audited against an earlier snapshot.

### Exact template library

`src/cards/compiler/OracleTemplateLibrary.js` contains the high-confidence template registry. This checkpoint includes exact full-text templates for:

- fixed card draw;
- fixed damage to any target;
- destroy target using supported target selectors;
- exile target using supported target selectors;
- fixed target P/T modification until end of turn;
- basic-land search to the battlefield, including enters-tapped handling;
- fixed Treasure / Clue / Food creation;
- ETB life gain;
- ETB Treasure / Clue / Food creation;
- ETB +1/+1 counters on the source;
- simple cast-triggered +1/+1 counters on the source.

The library is intentionally conservative. A first sentence matching `Destroy target creature.` does **not** permit auto-compilation if additional Oracle text follows. The entire normalized rules text must be consumed by one exact template.

### Oracle AST to Step 16 IR

`src/cards/compiler/OracleAstCompiler.js` converts matched template AST nodes into the Step 16 script schema. `OracleTemplateCompiler.js` then runs the normal Step 16 validator/compiler. Generated behavior therefore reuses the same authoritative systems as hand-written scripts instead of creating a second rules path.

Targeted spell templates also preserve the card-level target contract used by the existing stack/cast pipeline. Basic-land search lowers through the existing choice-aware `searchLand` engine path, rather than silently selecting the first matching library card.

### Fail-closed compilation policy

`OracleTemplateCompiler.compileCard()` returns:

- `autoAccepted: true` only for one exact high-confidence full-text match that successfully validates;
- `review_required` for no match, partial/compound text, ambiguity, or validation failure;
- the parser version, Oracle fingerprint, matched template id(s), normalized text, diagnostics, generated script, and behavior fingerprint where applicable.

The compiler evaluates Oracle text in isolation from any old/manual card behavior. This prevents duplicate effects during migration and makes generated behavior fingerprints meaningful for comparison against legacy implementations.

### Oracle and parser change diffing

`src/cards/compiler/OracleChangeDiff.js` provides two review tools:

1. `diffOracleCardSets()` — detects new/removed Oracle identities and Oracle-text changes, recompiles both sides when possible, and flags semantic behavior changes.
2. `diffCompilerSnapshots()` — compares parser-version / Oracle-fingerprint / generated-behavior snapshots and identifies exactly which card implementations changed when the parser or source text changes.

Semantic changes are review-required; they are never silently adopted.

## Generated artifacts

`scripts/build-oracle-templates.mjs` generates and checks:

- `src/data/generated/oracle-template-compilation.json`
- `src/data/generated/oracle-template-review-queue.json`
- `src/data/generated/oracle-template-coverage.json`
- `src/data/generated/oracle-template-snapshot.json`
- `src/data/generated/oracle-change-diff.json`

The current 647-card project database produces:

- 4 exact high-confidence auto-compilations;
- 643 review-required rows;
- 187 high-priority review rows corresponding to Step 17 `auto-template-candidate` cards.

The four current exact matches are `Divination`, `Murder`, `Disenchant`, and `Rampant Growth`. The low auto-compile count is expected: Step 18 is fail-closed and does not claim that manually implemented complex cards are unsupported merely because their full Oracle text is outside the current template grammar.

## Runtime/API integration

`CardScriptService` exposes Oracle analysis/compilation beside normal Step 16 scripting. `GameEngine` exposes immutable `analyzeOracleTemplate()` and `compileOracleTemplate()` helpers, and `getCardScriptCapabilities()` reports the parser version, template registry, and fail-closed compiler policy.

## Commands

```bash
npm run build-oracle-templates
npm run check-oracle-templates
npm run test:step18
```

`npm run verify` now checks the Oracle compiler artifacts before architecture/tests/build.

## Acceptance status

- **Common templates compile deterministically:** PASS. Deterministic token, Oracle, script, and behavior fingerprints are regression-tested.
- **Unknown/ambiguous text never becomes executable without review:** PASS. Exact full-text matching is required and compound partial matches fail closed.
- **Parser-version changes identify changed card implementations:** PASS. Snapshot diff tests distinguish parser-only changes from behavior-changing compiler changes.
- **Compiled scripts use the same behavior primitives as manual scripts:** PASS. Representative draw/removal cards match existing manual primitive behavior; basic-land search uses the existing authoritative choice-aware search path.
