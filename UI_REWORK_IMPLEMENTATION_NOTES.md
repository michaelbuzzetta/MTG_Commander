# Professional Combat UI Rework

This pass changes presentation only. Rules, card abilities, game-state transitions, legality checks, AI behavior, targeting, combat resolution, triggers, replacement effects, mana, and deck data were not modified.

## Visual changes

- Reworked the play surface into a cleaner digital-table presentation inspired by the supplied MTG Arena combat screenshot.
- Mirrored battlefield organization so both players' creatures face the center combat line and lands sit behind them.
- Added distinct but restrained opponent/player battlefield lighting to make ownership immediately readable.
- Replaced bulky player information rows with compact rounded HUD strips.
- Reduced the top phase banner and bottom action bar so the battlefield remains the visual focus.
- Added a luminous combat divider and compact stack indicator at the middle of the table.
- Restyled commander slots as floating side zones.
- Tightened battlefield card sizing/spacing while preserving hover enlargement and rules-text inspection.
- Restyled selected/legal cards with a cleaner blue interaction glow.
- Refined the player's hand tray and controls to occupy less of the battlefield.
- Preserved compact responsive behavior for shorter desktop displays.

## Behavior preservation

- `src/engine/*` unchanged.
- `src/ai/*` unchanged.
- Card state and click handlers unchanged.
- Battlefield mirroring changes DOM presentation order only; the underlying `player.battlefield` array is not reordered or mutated.

## Verification

- `npm test`: 134 / 134 tests passed.
- Production build could not be re-run in the sandbox because the uploaded ZIP does not contain `node_modules`, and restoring npm dependencies timed out / was not fully available from cache. No package dependency versions were changed.
