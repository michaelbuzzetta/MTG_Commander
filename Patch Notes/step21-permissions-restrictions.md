# Step 21 — Permissions, Restrictions and Requirements

## Goal

Step 21 centralizes rules-changing effects that alter what players may do, may not do, or must do. UI, AI, combat, targeting, costs, and card/effect code now consult one authoritative legality layer instead of duplicating stax/lock heuristics.

## Core rule model

`src/engine/legality/RuleTypes.js` defines three first-class rule categories:

- **Permission** — grants an action that is normally unavailable, such as casting from another zone, casting as though a spell had flash, or receiving an additional land play.
- **Restriction** — forbids or limits an operation, such as one spell per turn, no searching, no life gain, or no more than one attacker/blocker.
- **Requirement** — requires part of a declaration when legally satisfiable or adds a rules-required action cost, such as an attack tax.

The shared operation vocabulary currently covers:

- cast
- play land
- search
- draw
- gain life
- attack
- block
- target
- activate ability
- untap

## `LegalityService`

`src/engine/legality/LegalityService.js` owns normalization, applicability, conflict resolution, usage tracking, diagnostics, action costs, and permission discovery.

Every normal submitted player action reaches `LegalityService.validateAction()` before core action validation/payment. Event-driven operations that are not ordinary submitted actions—draw, search, gain life, target validation and untap—query the same service from their authoritative engine path.

Restrictions win over ordinary permissions. A permission may override a restriction only when the rule object explicitly declares `overridesRestrictions: true`, keeping the default Magic "can't beats can" behavior fail-closed.

## Frequency and count restrictions

The engine records rules-relevant operation history by turn in `state.legalityUsage`. This supports restrictions such as:

- no more than one spell each turn
- once-per-turn activation limits
- attack/block declaration count limits
- other operation-specific `maxPerTurn` limits

Opening-hand draws are excluded from gameplay draw counters. Turn-boundary maintenance prunes old usage while preserving the immediately relevant history.

Declaration filters operate on the matching subset of selected attackers/blockers rather than blindly counting every selected object.

## Combat requirements and taxes

Attack/block rule objects integrate before combat mutation.

- `maxObjects` can enforce limits such as "no more than one creature can attack/block each combat."
- `minObjects` requirements apply only when the required number of matching attackers/blockers is actually legal, preserving "if able" behavior.
- Generic attack costs are checked before combat declaration and paid through the existing locked-cost/payment planner.
- Declared attackers are reserved from mana-source planning for their own attack tax, preventing the engine from illegally tapping an attacking creature to pay the tax for that same declaration.

## Zone and timing permissions

Permission rules can grant:

- casting from graveyard, exile, or the top of the library
- flash/instant-like casting timing
- additional land plays

`LegalActions` surfaces permitted cards through the same `getLegalActions()` list used by UI and AI. The cast path still performs ordinary zone, target, timing, and payment validation after the permission has been recognized.

## Targeting and non-action operations

`TargetingEngine` applies target restrictions both when candidate lists are generated and when a target is revalidated directly. Search, draw and life-gain restrictions are evaluated from their canonical event paths so card effects cannot bypass the legality layer.

Search effects that are prevented by a rule stop before library selection and do not abort unrelated parts of a resolving effect.

## Stax/lock migration compatibility

`src/engine/legality/StaxRuleAdapter.js` provides a conservative compatibility bridge for recurring Oracle patterns while Step 16/17 card scripts migrate to explicit `ruleObjects`.

The adapter currently recognizes reusable forms for:

- Arcane Laboratory / Rule of Law style one-spell limits
- opponents-only one-spell limits
- players/opponents cannot search
- one draw each turn
- opponents cannot gain life
- one attacker / one blocker each combat
- Ghostly Prison style attack taxes
- Back to Basics style nonbasic-land untap restrictions
- players-cast-only-during-their-own-turn restrictions

This is not a general natural-language interpreter. Explicit scripted rule objects remain the preferred path.

## Diagnostics and public API

The engine exposes:

- `getLegalitySnapshot()`
- `getLegalityDiagnostics()`
- `registerLegalityRule()`
- `unregisterLegalityRule()`

Diagnostics identify denied operations, source rules, affected player, phase/turn, and a safe action context. The legality source-rule extraction is cached per battlefield object/controller so repeated legal-action generation does not repeatedly parse the same stax text.

## Rules/architecture guarantees

1. Normal player actions are legality-checked before action costs are paid or authoritative state is mutated.
2. Draw/search/life-gain/target/untap restrictions use the same centralized rule model.
3. Ordinary permissions do not bypass restrictions.
4. Usage limits reset by turn and count prior same-turn actions correctly, including spells cast before a Rule-of-Law effect enters.
5. Combat requirements apply only when legally satisfiable.
6. Attack taxes use the normal payment planner and cannot illegally consume the declared attacker as a mana source.
7. Human UI and AI consume the same engine legal-action surface.
8. Common stax effects are engine rules rather than AI heuristics.
9. Explicit `ruleObjects` can be provided by card scripts without adding card-name branches to core engine code.

## Verification

- `npm run test:step21` — dedicated Step 21 suite
- targeted Step 6 + Steps 10–21 integration suite
- complete non-stress repository suite
- deterministic stress corpus
- database/support/Oracle-template consistency checks
- architecture boundary check
- mutation audit

See `STEP21_COMPLETION_REPORT.md` for the exact checkpoint results.
