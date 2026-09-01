# Category 10 Implementation Notes — Decks, AI, UI, and Test Stabilization

Category 10 resolves the final audit group: BUG-050, BUG-051, BUG-053, BUG-054, BUG-055, BUG-056, BUG-057, BUG-058, BUG-066, BUG-067, and BUG-068.

## AI

- **BUG-050:** blocker construction now reserves blockers globally, satisfies menace with two distinct legal blockers, and validates the completed blocker map through the engine before returning it. If the candidate map is illegal, the AI falls back to a legal no-block declaration rather than throwing and deadlocking priority.
- **BUG-051:** mandatory attacker/blocker declarations run before optional resource actions. The AI no longer taps a creature/permanent for speculative mana when it has no concrete payable spell/ability. Casting already uses the engine's deterministic auto-payment plan.

## UI

- **BUG-053:** the action footer reports priority from `state.priorityPlayer`.
- **BUG-054:** phase metadata uses the real `END_STEP` engine key.
- **BUG-055:** every supported local card now carries readable rules text. The card hover zoom renders local rules text even when artwork is available, and fallback cards render name, type, and rules text instead of only name/type.
- The setup screen filters out `playable: false` reference decks and explains why an exact published reference may be disabled.

## Deck legality and Explorers of the Deep

- **BUG-056 / BUG-057:** the database builder is now an authoritative Commander legality gate. It rejects repeated nonbasic cards, duplicate deck entries, invalid commander identity, off-color cards, unresolved cards, unsupported cards in playable decks, invalid commanders, wrong deck size, and incorrect commander quantity.
- All selectable custom/training decks were rebuilt as legal singleton Commander decks with basic lands filling the remaining slots.
- **BUG-058:** `explorers` now preserves the exact published Wizards 100-card Explorers of the Deep list, including 7 Forest and 13 Island. It is deliberately `playable: false` because the current engine does not yet model every card in that product. Missing mechanics are represented as `supported: false` reference records instead of being silently treated as vanilla cards.
- `explorers-trainer` is a separate legal, fully supported Hakbal deck so the application still has a playable Explorers/Hakbal training option while remaining fail-closed about unsupported mechanics.

## Tests

- **BUG-066:** added automated Commander singleton, color identity, commander legality, support status, and exact Explorers reference-list validation. Added negative builder tests proving singleton and off-color violations fail the build gate.
- **BUG-067:** the corrected combat timing tests from Categories 2/4 remain in the full suite and continue to assert priority after attackers, after blockers, and between first-strike and normal damage.
- **BUG-068:** replaced the old guard-only stress assertion with deterministic seeded simulations that require measurable phase/turn progress, fail on repeated full-state hashes, validate each AI action, and fail if an action cap is reached before an explicit acceptable progress target.

## Verification

- `npm run build-db` — **PASS**: built 114 cards and 7 deck records.
- `npm run check-db` — **PASS**: validated 114 cards and 7 deck records with Commander legality enabled.
- `npm test` — **PASS**: 134 tests, 0 failures.
- JSX syntax was parsed successfully for `App.jsx`, `Card.jsx`, `Battlefield.jsx`, and `main.jsx` using the sandbox's TypeScript parser.
- `npm run build` could not execute in this sandbox because installed npm dependencies are not present (`vite: not found`). This is an environment limitation, not a source failure; the project remains configured for `npm ci` followed by `npm run verify` on a normal machine.
