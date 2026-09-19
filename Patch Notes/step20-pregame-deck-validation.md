# Step 20 — Pregame, Deck Validation and Mulligans

## Goal

Step 20 makes the state before turn one rules-owned and reproducible. Deck legality is checked before opening hands are drawn, Commander/companion designations are represented explicitly, seeded starting-order/shuffle behavior is available, multiplayer London mulligans retain the Commander free mulligan, and scripted pregame actions resolve through ordinary engine events before the first turn begins.

## Components

### `src/engine/pregame/FormatValidator.js`

The format validator performs Commander deck construction checks before gameplay:

- supported format name
- exact/minimum deck size
- one legal commander or a legal paired-command relationship
- designated commanders present exactly once in the starting deck
- Commander color identity
- singleton construction, with basic-land and explicit unlimited-copy exceptions
- injected banned/restricted card sources plus card legality metadata when available
- companion designation, color identity and registered companion deck-building restriction

The validator returns structured diagnostics and can fail closed before opening hands are drawn. The current 13 project decks all pass this gate.

### `CompanionRules.js`

Step 20 includes data/rule-backed validators for the standard named companion restrictions (Gyruda, Jegantha, Kaheera, Keruga, Lurrus, Lutri, Obosh, Umori, Yorion and Zirda). Unknown Companion text is not silently assumed legal; it produces an explicit missing-validator diagnostic until its rule is registered.

Companions are designated/revealed in pregame metadata and remain separate from the command zone.

### `SeededRandom.js`

A deterministic Mulberry32-backed PRNG is available when `GameEngine` receives a `seed`. The same seed reproduces:

- initial library shuffles
- random starting-player selection when requested
- opening hands
- reset/restart pregame state

An injected RNG remains supported for legacy tests and simulations. Step 30 can later promote this service into the project-wide replay RNG without changing the Step 20 API shape.

### `PregameService.js`

The service owns the pre-turn state machine:

1. validate every starting deck
2. designate companions
3. select/rotate the starting player and multiplayer turn order
4. open the mulligan window
5. calculate London-mulligan bottom counts using the multiplayer free mulligan
6. collect pregame actions after all players keep
7. finish pregame and start the first turn only after all required/optional pregame choices are complete

Starting-player configuration supports the first seat (backward-compatible default), a specific player ID, or deterministic random selection.

### `PregameActionService.js`

Pregame card behavior is declarative and event-driven. Step 20 supports:

- Leyline-style “begin the game with this on the battlefield” actions
- Gemstone-Caverns-style non-starting-player action, including exiling another opening-hand card and entering with a luck counter
- explicit `pregameActions` metadata on card definitions
- conservative Oracle-text inference for the simple Leyline pattern
- optional accept/decline choices surfaced through the normal authoritative action/choice path

Cards enter/leave zones through `MOVE_ZONE`; counters use the normal counter event. Pregame actions therefore do not bypass replacement/event/logging infrastructure.

## Public engine additions

- `validateDeck(deck, options)`
- `getPregameSnapshot()`
- `CHOOSE_PREGAME_ACTION` in the canonical action vocabulary
- constructor options: `seed`, `startingPlayer`, `validateDecks`, and `formatRules`

## Mulligan behavior

The existing London-mulligan interaction remains UI-compatible: a mulligan returns the hand to the library, shuffles, and draws seven. On keep, the engine bottoms `mulligansTaken - freeMulligans` cards. Multiplayer Commander initializes `freeMulligans = 1`, so the first mulligan keeps seven with no bottom card and each additional mulligan increases the required bottom count by one.

## Rules/architecture guarantees

1. Illegal Commander construction can fail before an opening hand is drawn.
2. Companion cards are not accidentally placed in the command zone.
3. Seeded pregame creation and reset are reproducible.
4. Starting-player rotation updates active player, pregame decision order and multiplayer turn order together.
5. Pregame card actions complete before turn one.
6. Optional pregame actions require an explicit player choice.
7. Pregame zone/counter changes use authoritative engine events.
8. UI/AI can only respond through legal-action/choice objects; card text does not mutate state directly.
9. Existing no-seed/injected-RNG workflows remain supported.

## Verification coverage

`tests/step20-pregame-deck-mulligans.test.js` covers current-deck legality, size/singleton/color/banned failures, fail-before-draw behavior, companion restrictions/designation, seeded reproducibility, reset reproducibility, the multiplayer free mulligan, Leyline-style accept/decline, Gemstone-Caverns-style cost/counter handling and explicit multiplayer starting-player selection.
