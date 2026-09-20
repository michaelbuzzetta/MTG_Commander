# Phase 51–55 — Vehicles, Sagas, event triggers, and modal abilities

This batch extends the Phase 50 rules engine without bypassing authoritative costs, counters, continuous effects, targeting, stack, or state-based actions.

## 51 — Crew
- Oracle `Crew N` compiles to a reusable activated ability.
- Crew selections are variable-length, must be unique untapped creatures, and are validated by combined derived power.
- Selected creatures are tapped through the normal non-mana payment pipeline.
- Resolution creates a layer-4, until-end-of-turn continuous effect adding Creature to the Vehicle rather than mutating printed types.

## 52 — Sagas
- Ordinary Sagas receive their entry lore counter through CounterService and therefore replacement effects can observe/modify it.
- Every crossed chapter is queued from lore-counter changes, including multi-counter additions.
- Final chapter completion is marked and sacrificed through state-based actions after resolution rather than by an unconditional direct move.

## 53 — Advanced Sagas
- Read Ahead is represented as explicit Saga metadata and a chosen-chapter entry API.
- Skipped chapters below the Read Ahead choice do not trigger; replacement-modified counter placement can still trigger chapters at/above the chosen floor.
- Proliferate/counter manipulation continues to use the generic lore-counter semantic hook, so crossed chapters share the same path.

## 54 — Event-trigger expansion
- Added exact Oracle templates for land-entry (Landfall-family), generic spell-cast, and controlled-permanent-leaves triggers with reusable simple payloads.
- Corrected event-card type matching so zone-event payloads can classify the affected object when `payload.card` is not populated.

## 55 — Modal abilities
- Generalized modal parsing from `Choose one` to `Choose two`, `Choose three`, `one or both`, and `one or more` for exact supported clauses.
- Modal combinations are locked as explicit modes on the stack.
- Per-clause targets are preserved as ordered target specifications for combined modes.

## Verification
`tests/phase51-55-mechanics.test.js` covers each numbered step. Existing trigger/compiler/counter/stack and Phase 49–50 regression suites were also run after the changes.

### Environment note
The focused Phase 51–55 suite and 77 selected regression tests pass. A complete `npm test` run exceeded the execution window in this workspace. The Vite production build could not be executed here because the supplied checkpoint does not include `node_modules` and dependency installation did not complete within the workspace time limit; source/package metadata remain npm-compatible for a normal local `npm ci` followed by `npm run build:offline`.
