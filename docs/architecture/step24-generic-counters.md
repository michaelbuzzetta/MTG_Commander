# Step 24 — Generic Counter System

The engine now owns counters through `src/engine/counters/`.

## Design

`CounterStore` is a schema-agnostic keyed collection. `CounterService` resolves players/permanents, validates changes, dispatches canonical `ADD_COUNTER` / `REMOVE_COUNTER` events, preserves source metadata, and exposes move/double/proliferate operations. `CounterSemantics` describes reusable rule meaning without expanding the authoritative state schema for each new counter name.

P/T counters are consumed by continuous-effect evaluation. +1/+1 and -1/-1 cancellation occurs through the SBA transaction. Loyalty and defense use generic entry/removal events. Lore, stun, shield, time, poison, energy, and experience are layered on the same store through semantic hooks.

## Invariants

- Production code should not directly mutate counter maps when an event-routed operation exists.
- Replacement effects see counter additions before commit.
- Counter changes include source/cause metadata for trigger and diagnostic consumers.
- Proliferate enumerates existing counter types at resolution rather than knowing a fixed list.
