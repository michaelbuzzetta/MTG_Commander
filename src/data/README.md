# MTG AI Trainer data pipeline

There is one runtime card schema and one runtime deck schema.

- `source/cards.json` and `source/decks.json` are the authoritative, human-maintained inputs.
- `generated/cards.json` and `generated/decks.json` are the exact artifacts imported by the React app and test suite.
- `database-schema.json` documents the shared schema and the validation boundary.

Do not hand-edit files in `generated/`. Run `npm run build-db` after changing source data. The build is deterministic and does not require the network. It validates that every commander and every deck card resolves, that quantities are valid, that each deck contains 100 cards including exactly one commander entry, that nonbasic cards obey singleton construction, and that every card is inside the commander color identity. Playable decks also fail validation if they contain a reference-only unsupported card.

`npm run build-db:refresh` performs the same build and also asks Scryfall for descriptive metadata such as Oracle text and artwork URLs. Local machine-readable engine rules (`abilities` and `spellEffects`) remain authoritative and are never inferred from or overwritten by Scryfall metadata.

Category 10 completed the Commander singleton/color-identity gate. `playable: false` is reserved for exact reference deck records that intentionally contain cards not yet modeled by the rules engine; those cards remain visible in data but are excluded from the game selector until implemented.
