# Category 9 Implementation Notes — Individual Card Accuracy

Category 9 implements the nine audited card-accuracy findings from the repair plan: BUG-038, BUG-039, BUG-040, BUG-044, BUG-045, BUG-046, BUG-047, BUG-048, and BUG-049.

## Implemented repairs

- **BUG-038 — Hakbal of the Surging Soul**
  - Beginning-of-combat trigger now makes the controller's Merfolk explore in a controller-selected order.
  - Hakbal's attack trigger now lets its controller put a land from hand onto the battlefield; if they do not, the controller draws a card.
  - Explore continues to use the generic Category 8 explore decision flow.

- **BUG-039 — Cultivate**
  - Replaced the two approximate basic-land search effects with a dedicated Cultivate search decision.
  - The controller selects up to two basic lands, puts one onto the battlefield tapped and the other into hand, then shuffles.

- **BUG-040 — Evolution Sage**
  - Landfall now listens for a Land entering the battlefield under the controller instead of only the LAND_PLAYED action.

- **BUG-044 — Prosperous Pirates**
  - Corrected the card's name to `Prosperous Pirates`.
  - ETB now creates two Treasure tokens.

- **BUG-045 — Healing Salve**
  - Added explicit modal casting support.
  - Mode 1 targets a player to gain 3 life.
  - Mode 2 targets a supported player/permanent and creates a 3-damage prevention shield for the turn.

- **BUG-046 — Blech custom definition**
  - Life-gain counters now apply only to Pests, Bats, Insects, Snakes, and Spiders controlled by Blech's controller.

- **BUG-047 — Esika, God of the Tree**
  - Esika now taps for one mana of any color.
  - Other legendary creatures controlled by Esika's controller gain vigilance and the same any-color mana ability.
  - The Prismatic Bridge face is recorded in the data with its rules text but is explicitly marked unsupported because modal double-faced-card casting is not yet a supported engine feature. The trainer therefore does not silently approximate the missing face.

- **BUG-048 — Sisay, Weatherlight Captain**
  - Sisay now gets +1/+1 for each color among other legendary permanents controlled by her controller.
  - Her WUBRG activated ability now searches for a legendary permanent card with mana value less than Sisay's power, puts it onto the battlefield, then shuffles.

- **BUG-049 — Theros-style Gods**
  - Added reusable devotion/type-changing support so Thassa, Keranos, and Erebos are creatures only while devotion is high enough.
  - **Thassa, God of the Sea:** upkeep scry and targeted unblockable ability implemented.
  - **Keranos, God of Storms:** first-draw-of-turn land/nonland branches implemented, including target selection for the 3-damage branch.
  - **Erebos, God of the Dead:** opponents-cannot-gain-life static effect and pay-2-life draw ability implemented.

## Supporting engine work

Category 9 required reusable support rather than card-name-specific shortcuts. The engine now includes:

- dynamic type checks for devotion-based Gods;
- static-granted activated abilities and keywords;
- modal spell action generation/resolution;
- temporary damage-prevention shields;
- controller choices for ordered multi-explore, Cultivate, Sisay tutor, scry, and targeted triggers;
- first-draw-of-turn trigger metadata;
- static life-gain restrictions;
- dynamic legendary-color counting for Sisay;
- target-aware triggered abilities.

## Regression coverage

- `npm run check-db`: **PASS** — 44 cards and 6 decks validated.
- `npm test`: **PASS — 127/127 tests**.
- New Category 9 regression coverage includes all audited cards above plus UI decision-surface checks and rules-text presence checks.
- Existing synergy/UI tests that encoded the pre-Category-9 approximations were updated to the corrected behavior.

## Build verification note

`npm run verify` reaches the database validation and full test suite successfully. The final Vite production-build step could not run in this sandbox because the uploaded archive did not contain installed npm dependencies and the `vite` executable is unavailable here. No `node_modules` directory is bundled in the updated archive. On a normal development machine, install from the existing lockfile with `npm ci` and run `npm run verify` to perform the production bundle check as well.
