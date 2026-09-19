# Gameplay Completeness Scope

This checkpoint follows the revised project goal: prioritize correct gameplay interactions rather than exhaustive MTG Arena-style certification of every printed card.

The release target is a rules-driven Commander trainer where cards used by the application interact through the authoritative engine for stack/priority, triggered and activated abilities, targeting and choices, costs and mana, zones and hidden information, replacement/prevention effects, continuous effects/layers, combat, counters, tokens, attachments, copying, Commander multiplayer rules, and deterministic state changes.

The complete Scryfall catalog remains available for card identity/search/import. Exact compiler-backed cards may be promoted to runtime partial implementations when their full Oracle text matches a proven reusable template. Unsupported or ambiguous Oracle behavior must fail closed rather than being silently approximated. Exhaustive strict certification of every Commander-legal Oracle identity is no longer the primary product-completion requirement.

Current production catalog: 38,891 Oracle identities. Compiler 1.3.0 recognizes 1,536 exact full-text templates; 1,237 compiler-promoted runtime partial implementations are currently generated. The remaining development priority is representative interaction coverage and real-deck gameplay validation, not individually certifying all 31,913 in-scope Oracle identities.
