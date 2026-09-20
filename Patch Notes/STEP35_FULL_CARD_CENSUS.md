# Step 35 — Full Card Census

Step 35 expands validation from the curated 647-card set to the complete rich Oracle catalog snapshot bundled with the release (`dist/data/scryfall-card-catalog.json`). The snapshot declares itself complete and contains 38,681 Oracle/card records.

Baseline compiler results before Step 36 changes:
- Fully compiled: 1,880 (4.86%)
- Partially compiled: 5,711 (14.76%)
- Manual review / no exact supported paragraph: 31,090 (80.37%)
- Compiler crashes/failures: 0
- At least partially understood: 7,591 (19.62%)

The machine-readable per-card inventory is `coverage/phase35-full-card-census.json`. Every catalog row is classified and includes matched paragraph counts, unmatched paragraphs, compiler diagnostics, and matched templates where applicable. The census deliberately fails closed: partial matches are not executable as fully supported cards.

The largest recurring gaps were standalone keyword paragraphs on multi-ability cards, Aura enchant clauses, Equipment equip/modifier clauses, common mana abilities, modal headers, cycling, Saga infrastructure, and several evergreen/Commander mechanics. Step 36 addresses the highest-leverage groups that can be represented safely by the existing engine without inventing semantics.
