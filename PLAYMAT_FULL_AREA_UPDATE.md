# Full-Area Playmat UI Update

This UI-only revision makes the battlefield/playmat occupy the available middle viewport instead of using a fixed compact height.

Changes:
- Game screen now uses a vertical flex layout sized to the viewport.
- The play table expands between the phase banner and the fixed hand/action controls.
- Opponent and player battlefield halves grow equally around the combat line.
- Battlefield permanent rows distribute vertically across each half so lands stay behind creatures without bunching at the top.
- The table is widened to use nearly the full window, retaining side space for commander cards.
- Existing compact-card sizing, hover zoom, interaction handlers, engine state, AI logic, and rules code are unchanged.
