# Deck Import Support-Policy Fix — 2026-09-17

## Problem

The full-catalog deck builder correctly knew about cards such as **Akroma, Vision of Ixidor**, **Akroma's Memorial**, **Akroma's Will**, **Anguished Unmaking**, **Annie Joins Up**, and the Archetype cycle, but `buildCustomDeck()` rejected any card whose runtime definition had `supported: false`. This caused a deck to fail saving before the engine's Step 41 unsupported-interaction fail-safe could do its job.

## Fix

Unsupported or uncertified cards no longer block deck creation. The deck stores them normally and records a machine-readable `unsupportedCards` list plus `strictReady: false`. The Deck Collection displays the unsupported count and marks affected rows. Standard gameplay remains fail-closed: attempting to use a card whose required runtime behavior is unsupported still raises the existing unsupported-interaction warning rather than silently approximating its Oracle text.

Unknown card names, illegal Commander color identity, duplicate nonbasic cards, and incorrect 99-card main-deck counts are still rejected.

## Verification

- `tests/deck-import.test.js`: 7/7 passing after adding unsupported-card import coverage.
- Gameplay release gate: 168/168 passing.
- Legacy engine compatibility check: 109/109 root-level modules importing.
- Architecture boundary check: passing.
