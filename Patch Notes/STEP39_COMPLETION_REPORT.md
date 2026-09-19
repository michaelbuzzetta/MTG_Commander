# Step 39 Completion Report — Rules-Driven UI Completion

## Scope

Step 39 implements the workflow's rules-driven UI layer while preserving the authoritative-engine boundary established by earlier steps. React renders engine snapshots, legal actions, payment plans, priority/stack state, and standardized choices; it does not decide Magic legality or mutate authoritative game state.

## Implemented deliverables

### Generic rules dialogs
- Replaced prompt-driven mode/X/retrace/ability/mana-color interaction paths with `RulesActionPicker`.
- Expanded `ChoiceDialog` into a standardized renderer for engine-native `ChoiceRequest` shapes including options/modes, numeric entry, names, targets/cards/permanents, ordering, division, actions, private/public visibility, and cancellation where permitted.
- Reworked `PaymentDialog` to render the engine-calculated payment plan before submitting the original action.
- Preserved specialized legacy choice surfaces where the compatibility adapter still carries extra presentation semantics; new engine-native scripted choices use the generic dialog path.

### Stack and priority visualization
- Added `StackPriorityPanel` backed by `GameEngine.getStackPriorityView()`.
- Displays top-of-stack ordering, stack object labels, controller, targets, priority owner, and consecutive pass count.
- The panel is presentation-only and does not maintain a duplicate stack.

### Engine-authoritative legal-action highlighting
- Added `RulesUiModel.buildLegalActionIndex()` and `cardActionPresentation()`.
- Hand, command-zone, and player battlefield cards are highlighted only when an action exists in `GameEngine.getLegalActions('player')`.
- Blocked/neutral cards provide presentation tooltips without creating local legality rules.

### Declarative board state
- `Card` now renders state supplied by snapshots for counters, attachment state, token/copy state, phased-out state, and face state.
- `Battlefield` receives action presentation metadata but remains non-authoritative.

### Unsupported interaction fail-safe UI
- Added `UnsupportedInteractionDialog` and normalization helper.
- Explicit unsupported/not-implemented engine/card diagnostics are displayed instead of approximating the interaction.
- Ordinary legality errors remain ordinary action errors.

### UI integration tests and delivery gate
- Added `tests/step39-rules-driven-ui.test.js`.
- Added `scripts/check-step39-ui.mjs`.
- Added `test:step39` and `check:step39` package scripts and included both in the repository verification pipeline.

## Verification performed

### Step 39 deliverable gate
- `npm run check:step39` — PASS

### Step 39 tests
- `npm run test:step39` — 5/5 PASS
  1. Engine-only legal-action presentation
  2. Authoritative stack/priority view model
  3. Engine payment-plan presentation without state mutation
  4. Explicit unsupported-interaction normalization
  5. React integration surface coverage

### Reliability regression suites
- Step 36 judge scenarios — 10/10 PASS
- Step 37 fuzz/property tests — 5/5 PASS
- Step 38 performance/scalability tests — 5/5 PASS

### Known pre-existing baseline test failure
A targeted Step 5 historical test, `priority skips an active player eliminated during stack resolution`, reports:

`Runtime invariant violation: Eliminated player player is still the active player.`

The identical failure reproduces in the untouched Step 38 input checkpoint, so it was not introduced by Step 39. Step 39 intentionally does not alter the engine/player-elimination subsystem while completing the UI layer.

### Production build environment limitation
`npm run build` reached the Vite build command but could not execute it because this supplied checkpoint does not contain installed npm dependencies (`vite: not found`). The prebuild Scryfall refresh also had no network access and correctly fell back to the local 647-card seed. No production-build success is claimed for this sandbox run.

## Step 39 acceptance mapping

- **New scripted cards using existing standardized choice types need no custom React component:** engine-native `ChoiceRequest` objects render through the generic `ChoiceDialog`.
- **UI cannot create an illegal move if the engine rejects it:** visible legal-action affordances come from `getLegalActions()`, and all actions/choices still go through `submitAction`, `submitChoice`, or `passPriority`.
- **Stack/priority and required choices are understandable in 2–4 player games:** the new stack/priority panel and generic rules dialogs expose controller/target/priority/choice information from engine state.

## Files added or substantially updated

- `src/ui/RulesUiModel.js`
- `src/ui/index.js`
- `src/components/RulesActionPicker.jsx`
- `src/components/StackPriorityPanel.jsx`
- `src/components/UnsupportedInteractionDialog.jsx`
- `src/components/ChoiceDialog.jsx`
- `src/components/PaymentDialog.jsx`
- `src/components/Card.jsx`
- `src/components/Battlefield.jsx`
- `src/App.jsx`
- `src/styles.css`
- `tests/step39-rules-driven-ui.test.js`
- `scripts/check-step39-ui.mjs`
- `step39-rules-driven-ui.md`
- `package.json`
