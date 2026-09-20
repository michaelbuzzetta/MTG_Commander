# MTG AI Trainer v3

> **Gameplay-focused release:** the current release is governed by `GAMEPLAY_RELEASE.md`. It prioritizes correct reusable card interactions, stack/priority, triggers, costs, targeting, replacement/prevention, layers, combat, zones, copy/counters/tokens/control/attachments, real-card regression cases, and repeated real-deck gameplay. It does **not** claim that every printed card is individually certified. Unknown runtime behavior fails closed with an explicit diagnostic rather than being guessed.

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
npm run check-db          # validate card/deck source without writing
npm run build-db:refresh  # build + Scryfall descriptive metadata refresh
npm run build-support     # regenerate Step 17 Oracle/support/coverage artifacts
npm run check-support     # validate Step 17 support artifacts without writing
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

This is a training simulator built around reusable Magic rules primitives rather than a claim that every printed card has been individually hand-certified. The exact stock Explorers of the Deep deck, all five Archidekt decks, Temporal Paradox, and Never Ending Story are selectable. The importers and Compiler 1.3 route recognized behavior through the authoritative rules engine. Unusual clauses outside the supported primitives are never silently approximated in standard gameplay: the engine emits an explicit unsupported-interaction diagnostic and stops the affected operation. All selectable decks pass Commander singleton, color-identity, resolvability, and 100-card validation.

## Custom Commander deck import

From the home screen, choose **Add Your Own Deck** to save a custom Commander deck in the browser. Enter a deck name and commander, then paste the other 99 cards in TCGPlayer Mass Entry style, for example:

```text
1 Sol Ring
1 Arcane Signet
1 Command Tower
13 Island
```

`1x Card Name`, TCGPlayer decorations such as `1 Sol Ring [CMM] 396`, and Archidekt lines such as `1x Sol Ring (cmm) 396 [Ramp]` are accepted. The importer removes set, collector-number, category, and `Commander{top}` decorations before matching names. It validates the 99-card count, Commander color identity, and duplicate-card rules.

Cards not already bundled with the trainer are retrieved from Scryfall during import. Their card image, Oracle text, color identity, type line, printed keywords, mana production, and common reusable effects are compiled into local rules records and saved alongside the custom deck in `localStorage`, so later games can use the deck without downloading those records again. Imported decks appear in the normal deck selector and in the Deck Collection manager.

## Multiplayer Commander

The home screen supports **2-player, 3-player, and 4-player** matches. The human player keeps the selected deck and the remaining seats are filled with distinct playable AI decks. Multiplayer games use a shared turn order and priority ring, skip eliminated players, and end only when one player remains (or all remaining players lose simultaneously).

Combat is defender-aware. When you attack in a 3- or 4-player game, choose an opponent seat and then select the creatures attacking that opponent; you can switch seats and split attackers across multiple opponents in the same combat. Only the player being attacked by a given creature may block that creature. Commander damage and normal combat damage are tracked against the correct defending player.
## Human-like AI decision policy

AI opponents now evaluate opening hands, mana development, normal spells, commanders, activated abilities, targets, attacks, and blocks instead of following a simple "land, then highest-mana-value card" rule. The heuristics prioritize early ramp and curve development, value card draw more when the hand is small, prefer removal against meaningful opposing threats, reduce the priority of repeatedly taxed commanders, hold flexible interaction when there is no useful target, and avoid obviously bad attacks or blocks. This remains a deterministic rules-based game AI rather than a machine-learning model, so its decisions stay testable and reproducible.

Opponent seats also show the AI's latest meaningful action. A normal land play is explicitly labeled **land play costs 0 mana**; the engine records `manaSpent: 0` on `LAND_PLAYED` events and never taps mana sources or deducts from a mana pool simply to play a land. Lands that enter tapped because of their own card text may still appear tapped.

## Deck Collection manager

The home screen includes **View / Edit Decks**, which opens a dedicated deck-management page for every currently available playable deck. The collection supports search by deck or commander, full 100-card deck inspection, preloaded editing in the existing Commander Deck Builder, selecting a deck for play, and deletion with confirmation. Custom decks are removed from browser storage when deleted. Included decks are hidden locally instead of modifying the shipped source catalog, and **Restore deleted default decks** makes those included decks available again. Editing an included deck creates a locally saved custom version and hides the original included copy, preserving the packaged baseline.

## Commander Deck Builder

The home screen now includes **Build a Commander Deck**, an Arena-inspired visual deck-building workspace. The builder works from the trainer's current playable card database so every recommendation is a card the local simulator can resolve.

- Choose a supported commander from a visual card grid.
- The builder detects themes from the commander's Oracle text, including creature-type payoffs, counters, tokens, Sagas, artifacts, legends, combat, graveyard, lands, and spellslinger strategies.
- Commander color identity is enforced before cards enter the recommendation pool.
- Recommendations receive a deterministic synergy score and a short reason such as tribal synergy, card advantage, interaction, protection, or a matching commander mechanic.
- Filter the collection by role or search names, type lines, and rules text.
- Build manually or use **Auto Build 99**. Automatic builds target a balanced Commander shell with 37 lands plus ramp, card draw, removal, board wipes, protection, tutors, and the highest-scoring synergy cards. Basic-land quantities are distributed using the color pips in the selected deck.
- The right-side deck panel shows the 99-card count, role totals, and mana curve in real time.
- **Save Deck & Return** validates the final Commander list, stores it through the existing custom-deck `localStorage` system, selects it on the home screen, and makes it immediately available for play.

The visual design intentionally follows the interaction pattern of MTG Arena's deck editor—dark collection browser, large card-art tiles, commander panel, compact deck column, orange/gold completion controls—without depending on Arena assets.

## Full MTG card catalog (Scryfall bulk sync)

The trainer now maintains two intentionally separate card layers:

1. `src/data/generated/cards.json` remains the authoritative, hand-tested gameplay database. Existing decks, rules tests, AI behavior, and tuned card implementations continue to use it.
2. A complete Scryfall `oracle_cards` catalog is checked whenever the app starts. It is cached at `.cache/scryfall/card-catalog.json` and exposed to the Arena-style Commander builder through the Vite server.

Run `npm run dev` (or `start.bat`) normally. The `predev` hook runs `npm run sync-cards`, which checks Scryfall's bulk-data metadata on every launch. If Scryfall has a newer bulk snapshot, the application downloads and atomically replaces the local catalog. If the snapshot has not changed, it reuses the current cache instead of needlessly redownloading the entire dataset.

If the network or Scryfall is unavailable, startup does **not** break. The most recent complete cache is retained. On a first-ever offline launch, the app creates a small fallback catalog from the existing trainer database and automatically retries the full sync on the next launch.

Useful commands:

- `npm run sync-cards` — check for and download a newer full card catalog.
- `npm run sync-cards:force` — force a fresh bulk download even if the cached snapshot appears current.
- `npm run dev` — synchronize the catalog, then start the app.
- `npm run build` — synchronize first and embed the current catalog snapshot into the production build as `data/scryfall-card-catalog.json`.

The deck builder searches the complete catalog, but hand-authored gameplay definitions always override same-name generic catalog records. When a catalog-only card is saved into a deck, it is converted through the same generic Scryfall rules parser already used by custom-deck imports. This preserves existing functionality while expanding card discovery and deck construction to the complete synchronized catalog.

## Rules Engine Workflow — Step 1 Complete

The codebase now has an explicit production boundary around `GameEngine`. React and AI consume immutable state/card snapshots, submit actions through `submitAction` / `submitChoice` / `passPriority`, and no longer call mutable engine state or rules subsystems directly. Run `npm run check:architecture` to enforce the boundary and `npm run audit:mutations` to regenerate the internal mutation-path inventory. See `docs/architecture/step1-engine-boundary.md` for the API contract and acceptance status.

## Rules Engine Workflow — Step 3 Complete

The rules engine now has a universal action/event boundary. Core state-transition helpers for zones, draw/discard/mill, life, damage, tap/untap, counters, tokens, shuffle, control change, destroy/sacrifice/exile, casting, copying, and combat declarations route through `EventDispatcher`. Event records include causal parent ids and action provenance; generic transformer/subscriber hooks are ready for later replacement/prevention and trigger engines. Run `npm run test:step3` for the dedicated Step 3 suite. See `docs/architecture/step3-actions-events.md` for architecture details.


## Rules Engine Workflow — Step 4 Complete

Turn order and phase/step progression now run through `src/engine/turn/TurnEngine.js` instead of a fixed phase-index routine. The engine has an explicit turn sequence, rules-defined turn-based actions, conditional first-strike combat steps, no-priority untap/normal-cleanup behavior, repeated cleanup when triggers require priority, and generic extra/skipped turn/phase/step scheduling. Replay output now records concrete turn history. Run `npm run test:step4` for the dedicated suite. See `docs/architecture/step4-turn-engine.md` and `STEP4_COMPLETION_REPORT.md` for details.

## Rules-engine migration checkpoints

- **Step 1 — Engine Isolation and Architectural Boundaries:** complete.
- **Step 2 — Canonical Game State and Object Model:** complete. See `STEP2_COMPLETION_REPORT.md` and `docs/architecture/step2-canonical-object-model.md`.
- **Step 3 — Universal Actions and Events:** complete. See `STEP3_COMPLETION_REPORT.md` and `docs/architecture/step3-actions-events.md`.
- **Step 4 — Turn, Phase, Step and Turn-Based Action Engine:** complete. See `STEP4_COMPLETION_REPORT.md` and `docs/architecture/step4-turn-engine.md`.
- **Step 5 — Full Stack and Priority System:** complete. See `STEP5_COMPLETION_REPORT.md` and `docs/architecture/step5-stack-priority.md`.
- **Step 6 — Universal Choice and Targeting Framework:** complete. See `STEP6_COMPLETION_REPORT.md` and `docs/architecture/step6-choice-targeting.md`.
- **Step 7 — Mana, Costs and Payment:** complete. See `STEP7_COMPLETION_REPORT.md` and `docs/architecture/step7-mana-costs-payment.md`.
- **Step 8 — Zones, Zone Changes, Hidden Information and LKI:** complete. See `STEP8_COMPLETION_REPORT.md` and `docs/architecture/step8-zones-hidden-lki.md`.
- **Step 9 — Triggered Ability Engine:** complete. See `STEP9_COMPLETION_REPORT.md` and `docs/architecture/step9-triggered-abilities.md`.
- **Step 10 — Replacement and Prevention Effects:** complete. See `STEP10_COMPLETION_REPORT.md` and `docs/architecture/step10-replacement-prevention.md`.
- **Step 11 — Continuous Effects, Derived Characteristics and Layers:** complete. See `STEP11_COMPLETION_REPORT.md` and `step11-continuous-layers.md`.
- **Step 12 — State-Based Actions:** complete. See `STEP12_COMPLETION_REPORT.md` and `step12-state-based-actions.md`.
- **Step 13 — Complete Combat Engine:** complete. See `STEP13_COMPLETION_REPORT.md` and `step13-combat-engine.md`.
- **Step 14 — Commander and Multiplayer Rules:** complete. See `STEP14_COMPLETION_REPORT.md` and `docs/architecture/step14-commander-multiplayer.md`.
- **Step 15 — Reusable Mechanic Library:** complete. See `STEP15_COMPLETION_REPORT.md` and `docs/architecture/step15-reusable-mechanics.md`.
- **Step 16 — Card Scripting Language / Declarative Ability Model:** complete. See `STEP16_COMPLETION_REPORT.md` and `docs/architecture/step16-card-scripting.md`.
- **Step 17 — Card Library Migration and Support Classification:** complete. See `STEP17_COMPLETION_REPORT.md` and `docs/architecture/step17-card-library-support.md`.
- **Step 18+**: not implemented in this checkpoint.

## Rules Engine Workflow — Step 5 Complete

Stack and priority are now explicit rules subsystems under `src/engine/stack/`. Every spell/ability stack item uses a canonical `StackObject`; multiplayer consecutive passes are owned by `PriorityManager`; stack resolution is transactional and rechecks target legality; all-illegal targets are countered on resolution; partially illegal target sets continue with legal targets; mana abilities and Step 4 turn-based actions correctly bypass the stack; and players may retain priority to create arbitrarily nested LIFO response chains. `GameEngine` also exposes immutable stack/priority view APIs for UI/tests. Run `npm run test:step5` for the dedicated suite. See `docs/architecture/step5-stack-priority.md` and `STEP5_COMPLETION_REPORT.md` for details.


## Rules Engine Workflow — Step 6 Complete

Choices and targeting now share one engine-owned protocol under `src/engine/choices/`. `ChoiceRequest` / `ChoiceResponse` standardize player decisions, `TargetFilter` provides composable AND/OR/NOT legality filters, and `ChoiceService` normalizes the existing legacy choice producers while supporting native engine choices. Targeting remains distinct from non-targeting selection, so shroud/hexproof/protection apply only where the rules say "target." The human UI has a generic `ChoiceDialog`, AI can answer the same native request object, live state is revalidated on submission, and replay entries retain the request context and answer. Run `npm run test:step6` for the dedicated suite. See `docs/architecture/step6-choice-targeting.md` and `STEP6_COMPLETION_REPORT.md` for details.


## Rules Engine Workflow — Step 7 Complete

Mana costs and non-mana costs now run through `src/engine/costs/`. The engine parses colored/colorless/generic/hybrid/Phyrexian/snow/variable mana, locks staged spell costs, treats commander tax as an additional cost, enforces restricted mana, supports deterministic/manual payment plans, and commits mana/non-mana payment transactionally before stack insertion. Run `npm run test:step7` for the dedicated suite. See `docs/architecture/step7-mana-costs-payment.md` and `STEP7_COMPLETION_REPORT.md`.

## Rules Engine Workflow — Step 8 Complete

Player-zone mutation is now centralized under `src/engine/zones/` and canonical `MOVE_ZONE` events. Viewer-specific snapshots conceal hidden hands/libraries, legal look/reveal knowledge is tracked per player, library knowledge is invalidated by shuffling, LKI captures pre-zone-change characteristics, commander movement uses the zone transaction, and tokens cease to exist through state-based handling after observable zone changes. `npm run check:architecture` also rejects direct production zone-array mutation outside the zone subsystem. Run `npm run test:step8` for the dedicated suite. See `docs/architecture/step8-zones-hidden-lki.md` and `STEP8_COMPLETION_REPORT.md`.

## Rules Engine Workflow — Step 9 Complete

Triggered abilities now use `src/engine/triggers/` and the universal event stream. Card abilities normalize into `TriggerDefinition` objects; simultaneous triggers wait in `pendingTriggers`; four-player APNAP ordering and per-player trigger ordering are engine-owned; intervening-if conditions are checked at trigger time and resolution; delayed/reflexive triggers are persisted registrations; and leave/dies triggers consume Step 8 LKI. The former Bygone Marvels cast-copy special case is now a normal stack-zone triggered ability in card data. Run `npm run test:step9` for the dedicated suite. See `docs/architecture/step9-triggered-abilities.md` and `STEP9_COMPLETION_REPORT.md`.


## Rules Engine Workflow — Step 10 Complete

Replacement and prevention now run through `src/engine/replacement/` before authoritative event commit. `ReplacementEffect` definitions are selected and re-evaluated generically, noncommutative replacement sets use the Step 6 `REPLACEMENT_ORDER` choice protocol, transformed event types are revalidated against their final handler, battlefield-entry state is applied inside the zone transaction, and `PreventionService` owns consumable damage shields/expiration after damage replacement. Existing counter/token replacements and damage-prevention effects have been migrated from the old replacement helper. Run `npm run test:step10` for the dedicated suite. See `docs/architecture/step10-replacement-prevention.md` and `STEP10_COMPLETION_REPORT.md`.

## Rules Engine Workflow — Step 14 Complete

Commander identity and multiplayer rules now live under `src/engine/multiplayer/`. Commander designation has a persistent identity independent of current characteristics or controller, commander tax is tracked separately per designated commander, combat damage is recorded in a per-commander/per-player matrix, command-zone movement uses the correct replacement-versus-state-based-action timing, and legal paired commanders are validated through reusable Partner/Partner with/Friends Forever/Choose a Background/Doctor's companion/tagged pairing rules. Player elimination is an engine transaction that removes owned objects, ends control effects, cleans stack/effect/turn/combat references, and keeps surviving multiplayer state coherent. Multiplayer relation predicates now provide authoritative `you`, opponent, each opponent, each player, another player, teammate, active player, and defending player resolution to targeting/filter systems. Run `npm run test:step14` for the dedicated suite. See `docs/architecture/step14-commander-multiplayer.md` and `STEP14_COMPLETION_REPORT.md`.

## Rules Engine Workflow — Step 15 Complete

The codebase now has a registry-driven reusable mechanic layer under `src/mechanics/`. Evergreen combat/targeting/damage keywords delegate to shared mechanic behavior, recurring Commander mechanics can contribute generic trigger/effect hooks, and casting/specialty mechanics have stable dependency and hook contracts instead of requiring card-name branches in the core engine. Run `npm run test:step15` for the dedicated suite. See `docs/architecture/step15-reusable-mechanics.md` and `STEP15_COMPLETION_REPORT.md`.

## Rules Engine Workflow — Step 16 Complete

The codebase now includes a validated declarative card scripting layer under `src/cards/scripts/`. Versioned ability IR covers static, activated, triggered, replacement, spell, and characteristic-defining abilities; a reusable effect primitive library and selector/filter DSL compile into the existing authoritative engine; sequence/condition/for-each/repeat/may control flow is data-driven; malformed scripts fail at database load; and custom hooks must be explicitly registered and versioned. Run `npm run test:step16` for the dedicated suite. See `docs/architecture/step16-card-scripting.md` and `STEP16_COMPLETION_REPORT.md`.

## Rules Engine Workflow — Step 17 Complete

Card support is now tracked by Oracle/rules identity instead of printing identity. `OracleImplementationRegistry` groups printings under one executable rules implementation, preserves printing-only metadata separately, and explicitly records the fallback identity used when the local Scryfall snapshot lacks an Oracle id. `CardSupportService` exposes support status, Oracle implementation lookup, deck readiness, and computed coverage to the engine. `scripts/build-card-support.mjs` generates the Oracle registry, support database, deck-readiness report, coverage report, and legacy-handler review list from source data and test evidence. Fully supported status is fail-closed: a card must be explicitly certified, executable, backed by a behavioral test, and free of untracked caveats/custom hooks. Run `npm run build-support`, `npm run check-support`, or `npm run test:step17`. See `docs/architecture/step17-card-library-support.md` and `STEP17_COMPLETION_REPORT.md`.

## Rules Engine Workflow — Step 18 Complete

A versioned, fail-closed Oracle-text template compiler now lives under `src/cards/compiler/`. The compiler tokenizes normalized Oracle text, matches only exact high-confidence full-text templates, builds an intermediate Oracle AST, lowers that AST into the Step 16 card-script IR, validates the generated script, and fingerprints the resulting behavior. Unknown, partial, compound, or ambiguous text is never silently executed; it is written to a review queue instead. Generated compiler coverage/snapshots also make Oracle-text and parser-version changes auditable. Run `npm run build-oracle-templates`, `npm run check-oracle-templates`, or `npm run test:step18`. See `docs/architecture/step18-oracle-template-compiler.md` and `STEP18_COMPLETION_REPORT.md`.

## Current rules-engine checkpoint — Step 18

This archive is the **Step 18 complete** checkpoint. All 647 current card definitions are analyzed by parser version `1.0.0`; 4 complete Oracle texts currently satisfy exact high-confidence templates and 643 are explicitly review-required, including 187 high-priority Step 17 auto-template candidates. The compiler never interprets unmatched natural language at runtime. **Step 19 — Loop Detection and Gameplay Shortcuts** is the next workflow step.

## Rules Engine Workflow — Step 19 Complete

The authoritative engine now detects repeated action/state cycles and classifies mandatory, optional, deterministic resource-producing, choice-dependent, and terminating loops. `LOOP_SHORTCUT` lets human or AI callers declare a finite iteration count or a validated repeat-until condition without bypassing legality, priority, triggers, replacement effects, state-based actions, or replay. Mandatory recursive no-progress event loops resolve as draws, while a separate simulation safety budget stops nonrepeating runaway recursion with structured diagnostics. Replay stores one semantic shortcut entry rather than hundreds of expanded clicks. Run `npm run test:step19`. See `docs/architecture/step19-loop-detection-shortcuts.md` and `STEP19_COMPLETION_REPORT.md`.

## Current rules-engine checkpoint — Step 19

This archive is the **Step 19 complete** checkpoint. Loop detection and gameplay shortcuts are integrated with the authoritative action/event/replay paths, and the Step 19 safety budget prevents recursive hangs. **Step 20 — Pregame, Deck Validation and Mulligans** is the next workflow step.

## Step 20 — Pregame, Deck Validation and Mulligans

The authoritative engine now includes a format-aware Commander pregame service. It validates deck construction before opening hands, records commander/companion designation, supports seeded reproducible opening libraries and starting-player selection, applies the multiplayer free London mulligan, and resolves declarative Leyline/Gemstone-Caverns-style pregame actions through ordinary engine events before turn one. See `step20-pregame-deck-validation.md` and `STEP20_COMPLETION_REPORT.md`.

## Rules Engine Workflow — Step 21 Complete

Permissions, restrictions and requirements now share one authoritative legality layer under `src/engine/legality/`. Casts, land plays, activations, attack/block declarations, searches, draws, life gain, targeting and untap restrictions use the same rule-object model; same-turn usage limits and "can't" precedence are centralized; zone/timing permissions surface through the same legal-action list consumed by UI and AI; and common stax families such as Rule of Law, search locks, Ghostly Prison and Back to Basics migrate through declarative rules rather than AI heuristics. Run `npm run test:step21`. See `docs/architecture/step21-permissions-restrictions.md` and `STEP21_COMPLETION_REPORT.md`.

## Current rules-engine checkpoint — Step 21

This archive is the **Step 21 complete** checkpoint. The legality service now centralizes permissions, restrictions, requirements, action usage limits and representative stax/lock interactions before action costs or state mutation. **Step 22 — Copy and Copiable Values** is the next workflow step.

## Rules Engine Workflow — Step 22 Complete

Copy and copiable-value rules now live under `src/engine/copy/`. Permanent, token, spell, and ability copies share a `CopiableValues` model rather than copying current derived/rendered state. Permanent copies apply in layer 1, Clone-style choices use the engine choice protocol, token copies route through `CREATE_TOKEN` replacement effects, stack copies retain modes/X/divisions/targets, and retargeting occurs only when the copy effect grants it. Copied characteristics are consumed by targeting, triggers, static/replacement abilities, mechanics, and the legality/stax layer. Run `npm run test:step22`. See `docs/architecture/step22-copy-copiable-values.md` and `STEP22_COMPLETION_REPORT.md`.

## Current rules-engine checkpoint — Step 22

This archive is the **Step 22 complete** checkpoint. Copy/copiable values are integrated with layers, stack resolution, token creation, choices, LKI, replacements, and legality. **Step 23 — Attachments** is the next workflow step.

## Rules Engine Workflow — Step 23 Complete

Attachments are now authoritative engine relationships under `src/engine/attachments/`. Auras, Equipment, Fortifications, and Reconfigure share canonical ATTACH/DETACH events, legal-host filters, continuous-effect integration, and state-based legality handling. Equip/Fortify/Reconfigure use normal activated-ability timing/cost/target/stack paths, Aura spells derive targeting from `Enchant ...` when necessary, and direct-entry Auras use a non-targeting choice. Run `npm run test:step23`. See `docs/architecture/step23-attachments.md` and `STEP23_COMPLETION_REPORT.md`.

## Current rules-engine checkpoint — Step 23

This archive is the **Step 23 complete** checkpoint. The attachment subsystem is integrated with zones, targeting, layers, SBAs, choices, AI, and UI metadata. **Step 24 — Generic Counter System** is the next workflow step.

## Rules Engine Workflow — Step 24 Complete

Counters now use the authoritative generic subsystem under `src/engine/counters/`. Arbitrary named counters work on permanents and players; additions/removals route through canonical events and replacement effects; P/T counters feed the layer engine; SBAs cancel opposing P/T counters; loyalty, defense, lore, stun, shield and time use reusable semantic hooks; and proliferate works across mixed counter types without card-specific collection mutation. Run `npm run test:step24`. See `docs/architecture/step24-generic-counters.md` and `STEP24_COMPLETION_REPORT.md`.

## Current rules-engine checkpoint — Step 24

This archive is the **Step 24 complete** checkpoint. Generic counter storage, events, replacement integration, semantic hooks and proliferate are now authoritative. **Step 25 — Token Registry and Generated Game Objects** is the next workflow step.

## Rules Engine Workflow — Step 27 Complete

Library search and top-of-library operations now share one engine-owned subsystem under `src/engine/library/`. Search requests are processed through replacement/restriction rules before selection; fail-to-find behavior is explicit; viewer knowledge remains private; and look/reveal/reorder/scry/surveil/cascade/discover reuse common primitives. Existing scripted searches and representative tutor/fetch paths now consume the same service. Run `npm run test:step27`. See `docs/architecture/step27-library-operations.md` and `STEP27_COMPLETION_REPORT.md`.

## Current rules-engine checkpoint — Step 27

This archive is the **Step 27 complete** checkpoint. Search restrictions, hidden information and recurring top-of-library mechanics now use one authoritative operation layer. The next workflow stage is **Step 28**.

## Rules Engine Workflow — Step 28 Complete

Timing legality is now a first-class authoritative subsystem under `src/engine/timing/`. Instant/sorcery defaults, priority, active-player main-phase checks, combat/step windows, once-per-turn and once-per-combat usage, step-relative usage, and declarative custom timing conditions are evaluated by the engine for every supported cast/activation/special action. Foretell now uses its correct special-action window (your turn while you have priority), land plays remain main-phase/empty-stack special actions, and scripted abilities/modes preserve validated timing metadata. UI and AI automatically receive only timing-legal actions through `getLegalActions()`. Run `npm run test:step28`. See `docs/architecture/step28-timing-restrictions.md` and `STEP28_COMPLETION_REPORT.md`.

## Current rules-engine checkpoint — Step 28

This archive is the **Step 28 complete** checkpoint. Timing restrictions, activation/casting windows, usage counters, special-action timing, and legal-action filtering are authoritative and regression-tested. The next workflow stage is **Step 29 — AI Migration to Authoritative Legal Actions**.

## Rules Engine Workflow — Step 29 Complete

AI strategy is now separated from rules enforcement. `AIEngineFacade` exposes only player-scoped/redacted knowledge and public immutable queries; `AILegalActionAdapter` requires every strategy result to originate from the authoritative `getLegalActions()` surface and revalidates completed template actions before submission; `AIActionScorer` and `AIChoiceEvaluator` contain strategy only. Production opponent automation submits through `AIController.submit()`, and accepted AI decisions are recorded in replay metadata. Run `npm run test:step29`. See `docs/architecture/step29-ai-authoritative-actions.md` and `STEP29_COMPLETION_REPORT.md`.

## Current rules-engine checkpoint — Step 29

This archive is the **Step 29 complete** checkpoint and completes the workflow's Release D / full-game-completeness gate. AI cannot bypass engine legality, hidden opponent information remains inaccessible to strategy code, and seeded games produce stable semantic AI decision sequences. The next workflow stage is **Step 30 — Deterministic Replay and Seeded Randomness**.

## Rules Engine Workflow — Step 30 Complete

Deterministic replay and game-wide seeded randomness now live under `src/engine/replay/` and `src/engine/pregame/SeededRandom.js`. Rules/AI code no longer calls `Math.random()` directly; shuffles and other rules-owned randomness consume the centralized RNG service. Every accepted action/choice receives a post-action authoritative state hash and RNG call position, `ReplayRunner` can reproduce the recorded game without consulting UI/AI, and checkpoints preserve canonical game state plus RNG/action identity state. Run `npm run test:step30`. See `docs/architecture/step30-deterministic-replay.md` and `STEP30_COMPLETION_REPORT.md`.

## Current rules-engine checkpoint — Step 30

This archive is the **Step 30 complete** checkpoint. Seed + action/choice replay now reproduces authoritative state with hash validation, checkpoints restore the stack/pending-choice/RNG position, and replay metadata identifies the rules/database/build context for bug reports and simulations. The next workflow stage is **Step 31 — Rules and Event Logging**.

## Step 33 complete — Rules primitive verification

Step 33 adds explicit unit-level behavioral contracts for every workflow-listed reusable rules primitive, reusable test fixtures, atomic-failure assertions, behavioral coverage reporting, targeted Node coverage thresholds, and a CI gate. It also includes regression coverage for resolving spells that pause for a rules choice so invariant tracking and resolution resumption remain correct.

Run `npm run test:step33`, `npm run check:step33`, and `npm run test:step33:coverage` for the dedicated Step 33 gates.

## Rules Engine Workflow — Step 34 Complete

Pairwise and cross-system interaction coverage now has its own permanent regression matrix. The suite covers hexproof/targeting, protection/damage/attachments, indestructible/destroy, commander movement/replacement timing, token and counter replacement doubling, deathtouch/trample, first/double strike, copy/layers, ability removal, control-change relationships, four-player APNAP trigger order, and player elimination. A CI gate prevents these high-risk interaction contracts from disappearing during future refactors.

Run `npm run check:step34` and `npm run test:step34`. See `docs/architecture/step34-cross-system-interactions.md` and `STEP34_COMPLETION_REPORT.md`.

## Rules Engine Workflow — Step 35 Complete

Every card currently marked `fully_supported` now has a version-locked executable golden behavior contract. `tests/golden/step35-golden-cards.json` binds each contract to Oracle identity, Oracle-text fingerprint, and support rules version; `CardGoldenHarness` supplies reusable authoritative cast/resolve/zone/event helpers; and the dedicated suite exercises 28 behavior cases across all 26 fully supported cards. Step 17 full-support generation is now fail-closed against missing or stale Step 35 golden contracts, so an Oracle-text change or missing golden case downgrades certification until reviewed. Run `npm run check:step35` and `npm run test:step35`. See `docs/architecture/step35-golden-card-behavior.md` and `STEP35_COMPLETION_REPORT.md`.

## Current rules-engine checkpoint — Step 35

This archive is the **Step 35 complete** checkpoint. Fully supported card implementations now have per-card golden behavior contracts, Oracle/rules version locks, executable regression tests, and CI/support-status release gates. The next workflow stage is **Step 36 — Judge Scenario Regression Library**.


## Step 36 — Judge Scenario Regression Library

The rules engine now includes a deterministic judge-scenario regression library for difficult cross-system interactions. Run `npm run check:step36` to validate scenario coverage/schema and `npm run test:step36` to execute the curated suite. Confirmed cross-system rules bugs are permanently promoted into this library under the bug-to-regression policy.

## Rules Engine Workflow — Step 38 Complete

Performance and scalability optimization now lives under `src/engine/performance/` and is deliberately non-authoritative: caches, indexes, profiling, and headless execution accelerate existing rules behavior without changing the state/replay result. Derived characteristics and legal actions use dependency-aware memoization; trigger and replacement discovery use event-type/source indexes; targeting reuses safe zone candidate sets; and `GameEngine` now supports a deterministic `headless` mode for batch simulations. Step 38 also adds a profiler, a four-player stress benchmark, machine-readable regression thresholds, persisted benchmark artifacts, and scheduled CI performance checks.

Run `npm run check:step38`, `npm run test:step38`, and `npm run benchmark:step38`. See `step38-performance-scalability.md` and `STEP38_COMPLETION_REPORT.md`.

## Current rules-engine checkpoint — Step 38

This archive is the **Step 38 complete** checkpoint. Performance optimizations preserve deterministic rules/replay behavior while reducing repeated rules work and supporting efficient headless four-player simulation. The next workflow stage is **Step 39 — Rules-Driven UI Completion**.

## Rules Engine Workflow — Step 41 Complete

Unsupported interactions now fail closed instead of being silently approximated. `UNSUPPORTED_INTERACTION` diagnostics preserve the exact card/ability/script node or event capability that is missing, strict mode performs support preflight before game creation, and unsupported failures during execution restore deterministic action/resolution checkpoints. Permissive behavior is isolated to explicitly labeled sandbox mode, which is excluded from official statistics; official headless simulations require strict support, while partial-card performance benchmarks must opt in with an explicit recorded override. Run `npm run check:step41` and `npm run test:step41`. See `step41-unsupported-interaction-failsafes.md` and `STEP41_COMPLETION_REPORT.md`.

## Current rules-engine checkpoint — Step 41

This archive is the **Step 41 complete** checkpoint. Unsupported behavior can no longer silently contaminate authoritative gameplay or official simulation output, and diagnostic/replay metadata makes every unsupported encounter reproducible. The next workflow stage is **Step 42 — Strict Rules Mode and Release Gate**.

### MongoDB Ability System Phase 8
The Oracle compiler is now v2.0.0 and includes generalized replacement/prevention templates. This phase also fixes pre-battlefield self replacement discovery for effects such as "This permanent enters tapped." See `tests/phase8-oracle-replacement-compiler.test.js`.
