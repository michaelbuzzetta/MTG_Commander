# Compact Dual-Board Layout

This update changes presentation only; game/rules logic is unchanged.

## Goal
Keep the opponent battlefield and the player's battlefield visible together in a normal desktop viewport.

## Changes
- Reduced phase banner height.
- Reduced player information strip height and spacing.
- Reduced each battlefield from the previous 240px+ minimum to 168px.
- Reduced battlefield card thumbnails while preserving the existing hover zoom for readability.
- Reduced permanent row heights and spacing.
- Reduced the stack divider from 44px to 28px.
- Reduced commander-zone card sizing and repositioned commander slots for the compact board.
- Tightened decision banners so temporary choices consume less vertical space.
- Added an extra compact breakpoint for displays at 760px tall or less.
- Kept the hand tray comparatively large so cards in hand remain readable and easy to click.

## Logic impact
None. No engine, legality, combat, AI, card, or state-transition code was changed.
