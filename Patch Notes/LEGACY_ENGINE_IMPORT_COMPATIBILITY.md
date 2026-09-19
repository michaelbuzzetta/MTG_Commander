# Legacy Engine Import Compatibility Fix

This release includes a compatibility layer for older `src/engine/index.js` barrel files that imported engine modules directly from the `src/engine/` root.

The current engine architecture stores many modules in feature folders such as `src/engine/triggers/`, `src/engine/stack/`, `src/engine/costs/`, and `src/engine/zones/`. Older barrel files can therefore request paths such as `./TriggerDefinition.js`, `./TriggerRegistry.js`, or `./CardFace.js` even though the canonical files now live in subfolders.

To prevent repeated Vite `Failed to resolve import` errors when a release is extracted over an older project directory, this release provides root-level compatibility forwarders for every uniquely named engine module. The forwarders contain no rules logic; they simply re-export the canonical implementation from its feature folder.

Verification for this release:

- 109 root-level engine JavaScript modules import successfully in Node.
- Project-wide relative-import scan: 0 missing relative modules.
- Architecture boundary check passes.
- Gameplay release regression suite: 168/168 tests pass.

You can repeat the compatibility check with:

```bash
npm run check:legacy-imports
```

A clean extraction is still recommended, but the compatibility layer is specifically intended to make merged/overlaid extractions tolerant of legacy engine barrel files.
