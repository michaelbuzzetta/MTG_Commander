# UI boundary

`src/App.jsx` and `src/components/` are the current React UI implementation. They may consume immutable `GameEngine` snapshots, legal actions, and public read-only query results, but may not access mutable engine state or internal rules subsystems. `npm run check:architecture` enforces that boundary.
