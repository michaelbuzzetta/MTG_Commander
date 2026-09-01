# Category 8 Implementation Notes

## Scope

This update implements **Category 8: Generic MTG Mechanics and Tokens** only. It resolves **BUG-035, BUG-036, BUG-037, BUG-041, and BUG-042** from the repair plan. Individual-card corrections assigned to Category 9 (Hakbal's missing attack trigger/order behavior, Cultivate, Evolution Sage, Prosperous Pirates naming/count, Esika, Sisay, Gods, etc.) are intentionally left for the next implementation cycle.

## Explore framework — BUG-035, BUG-036, BUG-037

- Generic `explore` no longer falls back to the first creature a player controls.
- A triggered self-explore resolves against the **actual source permanent instance** carried by the trigger. River Herald Scout therefore explores itself, and an unrelated creature can no longer receive the counter.
- Explicit target IDs remain supported for future targeted explore effects.
- A revealed land is moved to the exploring creature controller's hand.
- A revealed nonland gives the exploring creature a +1/+1 counter and creates a first-class `EXPLORE_NONLAND` decision.
- The controller can choose `CHOOSE_EXPLORE` with either:
  - `putInGraveyard: false` — leave the revealed card on top; or
  - `putInGraveyard: true` — move that exact revealed card to the graveyard.
- The revealed nonland remains physically on top of the library while the choice is pending, so the engine does not invent a temporary pseudo-zone.
- Explore decisions are deferred safely if a counter-replacement or other rules choice must be completed first, then resume through the existing deferred-effect pipeline.
- If the library is empty, explore still puts a +1/+1 counter on the exploring creature and does not create a card-choice state.
- AI handles the new explore choice through the same validated action gateway, and the React UI exposes explicit **Keep on Top** / **Put in Graveyard** buttons.

## Token quantities and Academy Manufactor — BUG-041

- `ReplacementEngine.modifyTokenAmount()` no longer returns immediately when it encounters Academy Manufactor. Token doublers that appear before **or after** Manufactor in battlefield iteration still modify the final quantity.
- `createTokenRaw()` now honors its explicit `amount` argument and creates that many independent token instances instead of silently collapsing the count to one.
- `createToken()` carries the replacement-modified quantity into each Manufactor result type.
- Regression coverage verifies **Doubling Season + Academy Manufactor = 2 Treasure, 2 Food, and 2 Clue** regardless of the order those permanents appear on the battlefield.

## Canonical utility tokens — BUG-042

Added `src/engine/TokenDefinitions.js` as the reusable runtime token-template source for Treasure, Food, and Clue.

- **Treasure** — `{T}, Sacrifice this artifact: Add one mana of any color.`
  - Implemented as a normal mana ability.
  - Presents W/U/B/R/G as explicit validated mana-color choices.
  - Taps and sacrifices the Treasure as costs, then adds the chosen mana.
- **Food** — `{2}, {T}, Sacrifice this artifact: You gain 3 life.`
  - Implemented as a normal nonmana activated ability on the stack.
  - Life is gained only when the ability resolves.
- **Clue** — `{2}, Sacrifice this artifact: Draw a card.`
  - Implemented as a normal nonmana activated ability on the stack.
  - The card is drawn only when the ability resolves.

Utility-token templates override empty placeholder ability arrays supplied by individual card effects, so any existing `createToken` effect that names Treasure/Food/Clue receives the canonical rules automatically.

## Sacrifice-self activation costs

- The generic ability-cost path now supports `cost.sacrificeSelf`.
- Sacrifice costs use `GameEngine.sacrifice()` so leave-battlefield, dies/sacrifice events, token disappearance, and state-based actions remain on the established engine path.
- Activated abilities whose source is sacrificed retain a last-known source snapshot on the stack.
- Trigger collection is deferred until the activated ability has been placed on the stack, so sacrifice-triggered abilities are not incorrectly stacked before the ability whose cost caused the sacrifice.
- Mana auto-payment deliberately does **not** silently consume sacrifice-cost mana sources. Treasure remains an explicit legal `ACTIVATE_MANA` action; once cracked, its mana pool contribution is available to the normal deterministic payment solver. This avoids bypassing sacrifice events/state transitions inside the lower-level solver.

## New validated choice action

- `CHOOSE_EXPLORE`

The choice passes through `GameEngine.validateAction()` / `perform()` and is exposed through `LegalActions`, AI, and UI like the earlier mulligan, targeting, trigger, proliferate, replacement, combat, legend, commander, and ward decisions.

## Regression coverage

Added `tests/category8.test.js` and `tests/category8-ui.test.js`, including regressions for:

- River Herald Scout exploring itself instead of the first controlled creature;
- nonland explore keep-on-top versus graveyard choice;
- empty-library explore still adding the counter;
- Academy Manufactor quantity preservation with Doubling Season in both battlefield orders;
- `createTokenRaw()` honoring quantities;
- Treasure color choice, tap, sacrifice, mana production, and token disappearance;
- Food sacrifice/payment and delayed life gain on resolution;
- Clue sacrifice/payment and delayed card draw on resolution;
- UI exposure of the explore decision.

## Verification

- `npm run build-db`: **PASS** — 44 cards and 6 decks rebuilt from the authoritative source schema.
- `npm run check-db`: **PASS** — 44 cards and 6 decks validated.
- Category 8 focused suite: **PASS** — 9 tests passed, 0 failed.
- Full `npm test`: **PASS** — 108 tests passed, 0 failed after Category 8 integration.
- `node --check` on modified non-JSX engine/AI modules: **PASS**.
- `npm run build`: not completed in this sandbox because the uploaded archive did not contain `node_modules`; an `npm ci` attempt exceeded the container transport timeout before Vite was fully installed. The partial `node_modules` directory is removed from the packaged deliverable. Production bundling should be rerun with `npm ci && npm run build` in a normal development environment.
