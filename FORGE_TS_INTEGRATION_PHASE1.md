# Forge-TS Integration — Phase 1

## Decision

Phase 360 now has a non-invasive integration seam for `mtg-forge-ts`. The existing React/Vite UI, Scryfall/MongoDB catalog, deck importers, and native engine remain unchanged while the external engine is evaluated.

## Why this route

The upstream project describes `@mtg-forge-ts/core`, `@mtg-forge-ts/cards`, and `@mtg-forge-ts/game` as a headless TypeScript port of Forge with a 32,303+ card corpus. Its own documentation also says the current runtime target is Node.js with a pluggable loader seam for future browser adapters. Therefore the safe architecture is not to wire it directly into `App.jsx` yet. The first integration target should be a Node-side engine adapter/worker boundary.

## Licensing gate

The upstream project is GPL-3.0-or-later. No upstream source or card corpus has been copied into this checkpoint. Before distributing a build that links or incorporates those packages, decide whether this project will be distributed under GPL-compatible terms and preserve required notices/source obligations.

## What was added

- `src/integrations/forge/ForgeTsBridge.js`: optional dynamic-loader/probe. It does not guess undocumented constructors or mutation APIs.
- `scripts/check-forge-ts-integration.mjs`: reports whether all three required packages are installed and prints their real export surfaces.
- `npm run probe:forge-ts`: reproducible integration probe.

## Next integration sequence

1. Obtain/install the upstream packages or repository in the development environment.
2. Run `npm run probe:forge-ts` and bind the adapter to the *actual* exported v1 API.
3. Build an Oracle-ID/name normalization map between the local 38,681-entry catalog and Forge's card database.
4. Produce overlap buckets: exact match, alias/face match, local-only, Forge-only, and non-digital/unsupported.
5. Add a server/worker game adapter translating the existing UI action model to Forge decisions/events.
6. Run differential scenarios on difficult cards and Commander mechanics before switching the default backend.
7. Keep the native Phase 360 engine as a fallback until parity tests pass.

## Current blocker

The execution environment used to prepare this checkpoint can inspect the public GitHub documentation but cannot clone/install packages from GitHub/npm. The bridge is therefore intentionally stopped at the API-discovery boundary rather than inventing an API contract.
