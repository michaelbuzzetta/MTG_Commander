# Phase 70 — Batch 2 Progress

Batch 2 requires at least 1,000 previously unimplemented cards to become fully executable. This checkpoint is intentionally **not** marked complete.

The implementation expands exact Oracle lowering only where behavior maps to existing authoritative engine primitives/casting paths. It adds executable handling for additional mana abilities, team pumps/shrinks, combat triggers, graveyard targeting, Foretell, Retrace, Buyback, Storm, Persist, Undying, Evolve, Renown, Bushido, Toxic, typed landcycling, threshold pumps, and related families.

The exact newly executable cards are recorded in `coverage/phase70-batch2-progress.json`. Unknown semantics remain fail-closed.
