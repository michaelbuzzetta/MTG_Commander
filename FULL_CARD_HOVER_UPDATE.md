# Full-card hover preview update

- Card previews now render into `document.body` via a React portal instead of inside the hovered card.
- The preview is fixed to the browser viewport and automatically appears on the side opposite the hovered card.
- Preview dimensions are capped by viewport height, keeping the complete card image visible on battlefield, hand, commander, and mulligan screens.
- Removed the browser-native `title` tooltip from cards to prevent it from covering the card preview; equivalent information remains available through the custom preview and `aria-label`.
- No engine, AI, game-state, legality, combat, or card-ability logic was changed.
