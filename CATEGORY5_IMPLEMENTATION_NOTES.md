# Category 5 Implementation Notes

Category 5 implements BUG-021 through BUG-027 from the repair plan. No Category 6 targeting, ward, hexproof, or stack-target legality work is included.

## Implemented repairs

- **BUG-021 — Legend rule:** State-based actions now detect same-name legendary permanents controlled by one player and create a mandatory `LEGEND_RULE` decision. The controller chooses the permanent to keep through the authoritative action gateway; all other copies go to their owners' graveyards.
- **BUG-022 — Zone changes:** `ZoneManager` now resets counters, marked damage, deathtouch marks, temporary modifiers, combat flags, tap state, summoning sickness, and battlefield timestamps whenever an object changes zones.
- **BUG-023 — Tokens:** Tokens may reach a nonbattlefield zone long enough for leave/dies events to be captured, then cease to exist during the repeated SBA loop.
- **BUG-024 — Commander zones:** Commanders now enter graveyard or exile normally and their owner chooses whether to move them to the command zone at the next SBA check. Hand/library moves use a pre-move replacement choice. Both choices pass through validated engine actions and are supported by the UI and AI.
- **BUG-025 — Commander damage:** Commander-damage totals increase only for damage explicitly identified as combat damage. Totals are keyed to the individual commander instance rather than only its owner.
- **BUG-026 — SBA timing:** The engine runs a repeated SBA loop after spell, trigger, and activated-ability resolution and after combat damage before granting priority. Trigger placement is deferred until the SBA sequence and any required rules choices finish.
- **BUG-027 — Event contract:** `GAME_START`, `TURN_START`, `LEAVE_BATTLEFIELD`, and `COMBAT_DAMAGE` are emitted at their real transitions. Leave events include controller, owner, old object state, and old/new zones; combat events include the individual damage assignments.

## Decision and UI integration

- New validated actions: `CHOOSE_LEGEND` and `CHOOSE_COMMANDER_ZONE`.
- `LegalActions` exposes only the applicable choice while it is pending.
- `AIController` resolves both choices deterministically.
- The React UI displays explicit legend-rule and commander-zone decision controls and blocks normal priority actions until the choice is complete.

## Regression coverage

`tests/category5.test.js` covers all seven Category 5 bugs, including both commander-zone choice types and event payloads. Two older commander tests were deliberately updated because they asserted the previously incorrect forced command-zone move and noncombat commander-damage behavior.

Run the complete gate with:

```bash
npm run verify
```
