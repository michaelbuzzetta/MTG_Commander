# Step 21 Completion Report — Permissions, Restrictions and Requirements

## Status

**COMPLETE for the Step 21 workflow checkpoint.**

This checkpoint builds directly on `MTG_Commander_Step20_Complete.zip` and introduces one authoritative legality layer for permissions, restrictions, requirements, usage limits, action taxes, zone/timing permissions and common stax/lock rules.

## Delivered

### 1. Permission / Restriction / Requirement rule objects

Added `src/engine/legality/RuleTypes.js` and `LegalityService.js`. Rule objects normalize into a common registry and cover CAST, PLAY_LAND, SEARCH, DRAW, GAIN_LIFE, ATTACK, BLOCK, TARGET, ACTIVATE_ABILITY and UNTAP operations.

Permissions grant otherwise unavailable actions. Restrictions forbid or limit them. Requirements enforce declaration minimums when satisfiable and support rules-required generic action costs.

### 2. Central legality service before mutation/payment

`GameEngine.validateAction()` now routes normal submitted actions through `LegalityService` before ordinary action validation or payment. Casts, land plays, activations, attacks and blocks therefore cannot pay costs and then discover that a Step 21 rule prohibited the action.

Draw, library search, life gain, targeting and turn-based untap actions query the same service from their authoritative event/rules path.

### 3. Usage counters and conflict precedence

`state.legalityUsage` records same-turn operation history so dynamic limits remain correct even if a limiting permanent enters after earlier actions occurred that turn. Opening-hand draws do not consume gameplay draw allowances.

Restrictions dominate ordinary permissions by default. Only a permission explicitly marked `overridesRestrictions` can override a restriction.

### 4. Zone/casting permissions and additional land plays

Rule permissions can expose cards from graveyard, exile or library to the authoritative legal-action list and can grant flash-like timing. Additional-land permissions augment the engine-owned land-play allowance without bypassing ordinary land validation.

UI and AI both consume `getLegalActions()`, so these permissions and restrictions have one client-facing source of truth.

### 5. Combat restrictions, requirements and attack taxes

Attack/block declarations are checked before combat state mutates. Count restrictions support one-attacker/one-blocker effects. `minObjects` requirements apply only when the required declaration can legally be satisfied, preserving "if able" behavior.

Ghostly-Prison-style generic attack taxes are verified before declaration and paid through the existing Step 7 payment planner. Declared attackers are reserved during payment planning so they cannot illegally tap themselves to finance their own attack requirement.

### 6. Stax/lock migration bridge

Added `StaxRuleAdapter.js` for conservative recurring Oracle patterns while card scripts migrate to explicit rule objects. Covered compatibility families include Arcane Laboratory/Rule of Law, search locks, one-draw limits, life-gain locks, one-attacker/one-blocker limits, Ghostly Prison, Back to Basics and own-turn casting restrictions.

The adapter is intentionally not a general Oracle-language interpreter; Step 16 scripted `ruleObjects` remain the preferred implementation path.

### 7. Legality diagnostics and public API

Added public snapshots/diagnostics and runtime rule registration helpers. Denials record operation, player, turn/phase, source rule and safe context. Source-rule extraction is cached per battlefield object/controller to keep repeated legal-action enumeration responsive.

## Acceptance criteria

| Workflow criterion | Result |
| --- | --- |
| Total-lockdown-style rules constrain every applicable player, including the controller for universal text | **PASS** — Arcane-Laboratory-style universal restriction test proves controller and opponents share the rule. |
| AI and human clients receive identical legal action lists | **PASS** — both consume authoritative `getLegalActions()`; AI test verifies it selects only an advertised legal action under a restriction. |
| Illegal searches/casts/attacks are blocked before costs are paid | **PASS** — search stops before selection; second Rule-of-Law cast preserves mana; illegal attack declaration leaves combat state unchanged; Ghostly Prison verifies/payments occur before declaration. |
| Usage limits reset at correct turn boundaries | **PASS** — once-per-turn activation limit blocks the second use and resets on the next turn. |

## Verification

Final verification on the Step 21 working tree:

- **454 / 454 non-stress repository tests passing**, executed in bounded complete batches across all 49 non-stress test files
- **16 / 16 Step 21-specific tests passing**
- **148 / 148 targeted Step 6 + Steps 10–21 tests passing**
- `npm run check-db`: **PASS — 647 cards / 13 decks**
- `npm run check-support`: **PASS — 26 fully supported / 621 partial / 0 explicitly unsupported**
- `npm run check-oracle-templates`: **PASS — 647 analyzed / 4 exact high-confidence / 643 review-required**
- `npm run check:architecture`: **PASS**
- `npm run audit:mutations`: completed; inventory refreshed (**321 internal direct mutation paths**)
- deterministic AI stress corpus: **50 / 50 seeded scenarios PASS** when run as ten bounded five-game batches

The monolithic 50-game stress invocation exceeded the tool execution window in this environment; the identical deterministic game-index range 0–49 was therefore executed in ten bounded batches, and every batch passed.

## Production-build environment note

`npm run build` was attempted. Scryfall refresh was unavailable and correctly fell back to the checked-in 647-card seed. This archive intentionally does not contain installed `node_modules`, so the final Vite command stops with `vite: not found`. All engine/database/support/compiler/architecture/test gates above run without that missing local package installation.

## Scope note

Step 21 centralizes permission/restriction/requirement legality and migrates representative stax families. It does not yet implement Step 22 copy/copiable-value rules, nor does it attempt unrestricted natural-language interpretation of every historic stax card. New/migrated cards should express legality through declarative `ruleObjects` wherever possible.

## Next workflow step

Step 22 — **Copy and Copiable Values** — has not been started in this checkpoint.
