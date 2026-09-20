# Phases 37–39 — Coverage expansion and interaction matrix

## Phase 37 — second coverage expansion
The full-catalog compiler now recognizes the highest-frequency ordinary mana abilities: fixed colored/colorless tap-for-mana abilities and tap-for-one-mana-of-any-color. They lower to the existing authoritative `type: mana` runtime representation rather than a parallel implementation.

## Phase 38 — rare/complex constructs
Added fail-closed compiler recognition for parameterized Ward and for engine-backed Convoke, Changeling, and Partner clauses. Ward is lowered to the existing ward-cost targeting/stack path. Convoke, Changeling, and Partner are accepted only because their authoritative runtime subsystems already derive semantics from card Oracle/keyword data.

## Phase 39 — interaction matrix
Added composition regression coverage proving independently compiled keyword, ETB-trigger, and mana-ability paragraphs survive together on one card. The full census is regenerated after the expansion so remaining gaps stay data-driven. Unsupported mechanics remain review-required rather than approximated.
