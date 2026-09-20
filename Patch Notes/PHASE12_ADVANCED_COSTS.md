# Phase 12 — Advanced Cost Architecture

Oracle compiler version: 2.4.0.

This phase expands activated-ability cost composition while preserving the engine rule that costs are validated before mutation and committed atomically before stack insertion.

Implemented in this phase:
- fixed life-payment costs, optionally combined with mana;
- named counter removal from the source, optionally combined with mana;
- sacrifice-another-creature costs using authoritative battlefield selection;
- generic selection-backed sacrifice/return and extensible non-mana cost descriptors in CostEngine;
- AST preservation of cost selections so compiler-generated abilities can use the existing LegalActions selection pipeline;
- regression coverage proving invalid compound costs do not partially mutate game state.

Not auto-compiled yet: hand-card discard choices, graveyard-card exile choices, spell additional costs requiring pre-cast choice UI, conditional costs, and arbitrary X/non-mana cost choice combinations. These remain review-required rather than approximated.
