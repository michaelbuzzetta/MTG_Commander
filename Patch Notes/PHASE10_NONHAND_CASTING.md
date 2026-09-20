# Phase 10 — Non-hand casting and alternative costs

Oracle parser version: **2.2.0**.

This phase adds declarative card-level `castingOptions` emitted by the Oracle compiler and enforced by the authoritative GameEngine/CostEngine path. The initial exact families are Flashback, "You may cast this card from your graveyard", and "You may cast this card from exile". Flashback locks its alternative mana cost at casting time and marks the spell to be exiled whenever it leaves the stack, including normal resolution and countering.

The Oracle AST can now carry a `cardPatch`; CardScriptCompiler merges only its declarative card metadata into the compiled definition. Paragraph composition preserves casting options, so a normal spell paragraph plus a Flashback paragraph compiles as one executable card rather than requiring a card-specific handler.

LegalActions now enumerates matching graveyard/exile casting options, GameEngine validates the exact source zone and option, CostEngine chooses the option's alternative mana cost, and spell cleanup honors `exileOnLeaveStack`. Unknown non-hand casting language continues to fail closed as review-required.

Focused regression result: 42/42 passing across MongoDB ability compiler, Step 21 permissions/restrictions, and Step 28 timing suites.
