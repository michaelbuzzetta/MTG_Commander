# MTG AI Trainer v3

A React/Vite Commander practice simulator built around a standalone game engine. The current repair program is being implemented category-by-category from the full code audit so that each engine layer can be stabilized before the next one changes.

## Current architecture

The application, tests, and database builder now share one data model:

- `src/data/source/cards.json` — authoritative card records.
- `src/data/source/decks.json` — authoritative deck records.
- `src/data/generated/cards.json` — runtime card artifact imported by the app/tests.
- `src/data/generated/decks.json` — runtime deck artifact imported by the app/tests.
- `src/data/database-schema.json` — schema and build validation contract.

`npm run build-db` validates the source data and atomically regenerates the exact files consumed by the running program. It fails instead of substituting filler cards or arbitrary commanders when a required card id cannot be resolved. Category 10 also makes this a Commander-legality build gate: nonbasic singleton violations, off-color cards, commander identity mismatches, and unsupported cards in playable decks all fail validation.

`npm run build-db:refresh` additionally refreshes descriptive Scryfall metadata. Every Node-side Scryfall request uses the same identifying User-Agent and Accept headers. Transport/API failures are treated separately from a genuine 404 card-not-found result. Local machine-readable rules fields remain authoritative.

## Run

Use Node.js with the checked-in lockfile:

```bash
npm ci
npm run check-db
npm test
npm run dev
```

On Windows, `start.bat` performs the locked install when needed, validates the data, and starts MTG AI Trainer v3.

## Database commands

```bash
npm run build-db          # deterministic local build
npm run check-db          # validate without writing
npm run build-db:refresh  # build + Scryfall descriptive metadata refresh
npm run import-archidekt  # rebuild the five bundled Archidekt decks from captured public data
npm run import-user-decks # rebuild Temporal Paradox and Never Ending Story from captured card data
```

## Bundled Archidekt decks

Five public 100-card Commander main decks are bundled as playable choices. Sideboard, maybeboard, and token/extra sections are deliberately excluded according to Archidekt's primary-category configuration.

- **I'll Just Counter My Own Shit Then** — Ertai Resurrected self-countering triggers and Myriad value.
- **Most Fun Commanders #7: Challenge Accepted** — Myojin of Blooming Dawn indestructible counters, proliferate, and Spirit tokens.
- **Stangg, Echo Warrior [100€ budget]** — Aura/Equipment Voltron with an attacking Stangg Twin.
- **“Battlecruiser” Magic (Inspirit, Flagship Vessel)** — charge counters, Station, artifacts, and a spacecraft commander that becomes a creature.
- **2/2s For Flinching** — a contest-winning Beamtown Bullies face-down/donation strategy.

Their exact public card records and section configuration are retained in `archidekt-selected-decks.json` and `archidekt-category-config.json`. The deterministic importer merges shared cards by name, retains card text and art metadata, compiles common draw/removal/ramp/token/Aura/Equipment/Myriad/manifest behavior, and installs explicit rules for each deck's defining commander mechanic.

## Added user decks

- **Temporal Paradox** — Jhoira of the Ghitu suspends nonland cards with four time counters; upkeep and time-counter effects count them down and cast them for free. Its Time Stretch family also schedules real extra turns.
- **Never Ending Story** — Tom Bombadil advances 24 Sagas through lore-counter chapter triggers, gains hexproof and indestructible at four total lore, and finds the next Saga when a final chapter resolves (once each turn).

The exact supplied lists are retained in `user-decks.json`; the matching Scryfall oracle/art capture is retained in `user-deck-card-data.json`. Together they expand the deterministic local database to 647 cards and 13 selectable Commander decks.

## Verification

```bash
npm run verify
```

`verify` validates the database, runs the engine/test suite, and produces the Vite production build.

## Scope

This is a training simulator implementing the mechanics represented by its structured card database, not a complete implementation of every rule/card ever printed in Magic. The exact stock Explorers of the Deep deck, all five Archidekt decks, Temporal Paradox, and Never Ending Story are selectable. The importers model reusable common effects and each deck's central commander engine; unusually specialized individual-card clauses outside those primitives remain simplified to the closest supported behavior. All selectable decks pass Commander singleton, color-identity, resolvability, and 100-card validation.

## Custom Commander deck import

From the home screen, choose **Add Your Own Deck** to save a custom Commander deck in the browser. Enter a deck name and commander, then paste the other 99 cards in TCGPlayer Mass Entry style, for example:

```text
1 Sol Ring
1 Arcane Signet
1 Command Tower
13 Island
```

`1x Card Name` and common set/collector decorations such as `1 Sol Ring [CMM] 396` are also accepted. The importer validates the 99-card count, local card availability/support, Commander color identity, and duplicate-card rules. Imported decks are stored in `localStorage`, appear in the normal deck selector, and can be removed from the home screen.

Because the trainer executes card mechanics locally, a custom deck can only be imported when every card already exists in the trainer's local card database and is marked supported.

## Multiplayer Commander

The home screen supports **2-player, 3-player, and 4-player** matches. The human player keeps the selected deck and the remaining seats are filled with distinct playable AI decks. Multiplayer games use a shared turn order and priority ring, skip eliminated players, and end only when one player remains (or all remaining players lose simultaneously).

Combat is defender-aware. When you attack in a 3- or 4-player game, choose an opponent seat and then select the creatures attacking that opponent; you can switch seats and split attackers across multiple opponents in the same combat. Only the player being attacked by a given creature may block that creature. Commander damage and normal combat damage are tracked against the correct defending player.
## Human-like AI decision policy

AI opponents now evaluate opening hands, mana development, normal spells, commanders, activated abilities, targets, attacks, and blocks instead of following a simple "land, then highest-mana-value card" rule. The heuristics prioritize early ramp and curve development, value card draw more when the hand is small, prefer removal against meaningful opposing threats, reduce the priority of repeatedly taxed commanders, hold flexible interaction when there is no useful target, and avoid obviously bad attacks or blocks. This remains a deterministic rules-based game AI rather than a machine-learning model, so its decisions stay testable and reproducible.

Opponent seats also show the AI's latest meaningful action. A normal land play is explicitly labeled **land play costs 0 mana**; the engine records `manaSpent: 0` on `LAND_PLAYED` events and never taps mana sources or deducts from a mana pool simply to play a land. Lands that enter tapped because of their own card text may still appear tapped.
