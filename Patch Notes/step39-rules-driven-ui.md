# Step 39 — Rules-Driven UI Completion

## Objective
Make the React client a presentation and input layer over authoritative engine state. The UI may render engine snapshots, legal actions, stack/priority state, standardized choices, and payment plans, but it does not decide Magic legality or mutate authoritative state.

## Implemented
- Added `src/ui/RulesUiModel.js` as a presentation-only adapter for legal-action highlighting, stack/priority rendering, payment-plan rendering, and unsupported-interaction diagnostics.
- Expanded the generic `ChoiceDialog` to render standardized number, text/name, boolean, ordered, targeted, multi-select, and divide ChoiceRequest shapes without card-specific React components.
- Added a reusable `RulesActionPicker` for engine-provided action variants, modes, activated abilities, mana choices, retrace choices, and legal X values.
- Added payment confirmation UI backed by `GameEngine.getPaymentPlanSnapshot()`; the UI previews the plan and the engine still performs the actual payment transaction when the action is submitted.
- Added an expandable stack/priority panel backed by `GameEngine.getStackPriorityView()`, showing top-of-stack ordering, controllers, targets, current priority, and pass count.
- Changed hand/battlefield/commander action highlighting to use only `getLegalActions()` results. Cards with no legal engine action receive non-authoritative explanatory tooltips rather than UI-side legality decisions.
- Added snapshot-driven badges for attachment, token, copy, phased, and face state.
- Added an explicit unsupported-interaction modal so the UI can surface unsupported behavior instead of approximating it. Step 41 can later feed its formal `UnsupportedInteraction` errors into the same surface.
- Existing pass/hold-priority controls, library-search modal, combat selectors, replacement ordering, trigger ordering, and commander-zone decisions remain wired to engine actions/choices.
- Added engine/UI-boundary integration tests and a static deliverable gate.

## Architectural rule
The UI does not create its own list of legal spells, abilities, targets, attacks, or blockers. It displays authoritative snapshots and submits player intent back to `GameEngine`. If the engine rejects an action, the UI displays the rejection and does not apply a local state change.
