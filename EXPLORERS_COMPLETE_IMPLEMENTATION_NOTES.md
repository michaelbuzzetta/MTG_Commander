# Explorers of the Deep — Complete Implementation Checkpoint

Date: 2026-09-01

This checkpoint makes the playable `explorers` deck the exact 100-card **Explorers of the Deep** Commander precon (Hakbal of the Surging Soul + 99 library cards) and removes the old placeholder/trainer substitutions from the playable deck path.

## Final rules work completed in this pass

- Mosswort Bridge hideaway card is played directly from exile during resolution, including lands, free casting, X=0 for unpaid X costs, and separately payable additional costs such as kicker.
- Quandrix Command allows the same object to be chosen for independent target clauses while repeated slots from a single target clause still require distinct objects.
- Foretell enforces the later-turn casting restriction and reveals the foretold spell when cast.
- Ripples of Potential separates proliferate selection from the optional phase-out selection.
- Emperor Mihail II and Surgespanner make their optional mana-payment decision on trigger resolution.
- Merrow Reejerey presents Tap / Untap / Do Nothing on resolution.
- Nicanzil, Current Conductor no longer incorrectly asks whether its explored-land trigger should go on the stack.
- Llanowar Reborn graft makes the move-counter decision on resolution.
- Realmwalker/Changeling is recognized consistently by tribal subtype, cost-reduction, trigger, static, and restricted-mana checks.
- Lands put onto the battlefield by Hakbal run their full as-enters/ETB pipeline, including enters-tapped rules, creature-type choices, reveal choices, entry counters, and land ETB effects without consuming a land play.
- Zegana, Utopian Speaker and Simic Ascendancy now use proper intervening-if trigger checks at trigger time while their effects still recheck the condition on resolution.
- Counter-trigger filtering now carries the actual counter type. Benthic Biomancer only triggers for +1/+1 counters, and Simic Ascendancy only reacts to +1/+1 counters placed on creatures you control.
- Fixed a stress-discovered Simic Ascendancy recursive trigger loop in which its own growth counters could repeatedly retrigger the enchantment.

## Human UI choices covered

The React UI now exposes the new engine choices rather than silently auto-resolving them for the human player, including:

- optional mana payments
- tap / untap / no-change selection
- optional effects on resolution
- hideaway play / decline
- duplicate-aware copy retargeting
- Ripples of Potential phase-out selection
- creature-type, targeting, mode, X, kicker, retrace, foretell, and other existing rules choices

## Verification

Final automated regression run:

- 155 tests
- 155 passed
- 0 failed

Database validation:

- 114 card definitions validated
- 6 deck definitions validated
- Explorers of the Deep contains exactly 100 cards
- commander: Hakbal of the Surging Soul
- library: 99 cards
- playable: yes
- unsupported cards in Explorers: 0
- placeholder cards in Explorers: 0
- cards with Oracle text but no engine representation: 0

Five seeded full Explorers-vs-Explorers AI games were run after the final rules corrections. All five reached a winner without a deadlock or illegal action:

- seed 1: 550 actions, turn 17, player won
- seed 2: 677 actions, turn 20, AI won
- seed 3: 617 actions, turn 20, AI won
- seed 4: 408 actions, turn 15, player won
- seed 5: 463 actions, turn 14, AI won

JavaScript syntax checks passed for the engine, AI, scripts, and tests.

## Production-build note

The sandbox did not have this project's npm dependencies installed. Restoring dependencies with `npm ci` could not complete because package retrieval stalled in the sandbox, so `vite build` could not be executed here (`vite: not found`). This is an environment/dependency-availability limitation, not a failing game-engine test. `package.json` and `package-lock.json` are included. On a normal connected development machine, run:

```bash
npm ci
npm run verify
```

`npm run verify` performs the authoritative database check, full automated test suite, and Vite production build.
