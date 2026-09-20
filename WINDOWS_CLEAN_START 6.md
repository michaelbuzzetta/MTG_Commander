# Windows clean start

This release includes compatibility re-exports for older engine barrel imports (`CardFace.js`, `GameObject.js`, `GameStateSchema.js`, and `serialization.js`).

For the cleanest upgrade from an earlier build:

1. Stop the Vite dev server.
2. Keep any deck exports/backups you want.
3. Extract this ZIP into a **new empty folder** rather than merging it over an older source tree.
4. Open PowerShell in that new folder.
5. Run `npm ci`.
6. Run `npm run dev`.

The canonical state modules live in `src/engine/state/`; the files at `src/engine/*.js` with matching names are compatibility shims only.
