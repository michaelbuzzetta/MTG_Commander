/**
 * Optional bridge to mtg-forge-ts.
 *
 * Deliberately uses runtime dynamic imports: Phase 360 remains runnable without
 * GPL dependencies installed, while allowing a controlled integration branch.
 * No Forge source is vendored in this checkpoint.
 */
const PACKAGE_NAMES = Object.freeze({
  core: '@mtg-forge-ts/core',
  cards: '@mtg-forge-ts/cards',
  game: '@mtg-forge-ts/game',
});

async function optionalImport(name) {
  try {
    return { ok: true, module: await import(/* @vite-ignore */ name), error: null };
  } catch (error) {
    return { ok: false, module: null, error };
  }
}

export class ForgeTsBridge {
  constructor(modules = {}) {
    this.modules = modules;
  }

  static async probe() {
    const entries = await Promise.all(
      Object.entries(PACKAGE_NAMES).map(async ([key, name]) => [key, name, await optionalImport(name)]),
    );
    const packages = Object.fromEntries(entries.map(([key, name, result]) => [key, {
      name,
      available: result.ok,
      exports: result.ok ? Object.keys(result.module).sort() : [],
      error: result.ok ? null : String(result.error?.message || result.error),
    }]));
    return {
      available: Object.values(packages).every((pkg) => pkg.available),
      packages,
    };
  }

  static async load() {
    const loaded = {};
    for (const [key, name] of Object.entries(PACKAGE_NAMES)) {
      const result = await optionalImport(name);
      if (!result.ok) {
        throw new Error(`Forge TS integration unavailable: ${name} could not be loaded (${result.error?.message || result.error})`);
      }
      loaded[key] = result.module;
    }
    return new ForgeTsBridge(loaded);
  }

  /**
   * Returns the actual installed package export surface. We use this to bind
   * against the real v1 API rather than guessing API names from documentation.
   */
  describeApi() {
    return Object.fromEntries(
      Object.entries(this.modules).map(([key, mod]) => [key, Object.keys(mod).sort()]),
    );
  }
}

export { PACKAGE_NAMES as FORGE_TS_PACKAGES };
