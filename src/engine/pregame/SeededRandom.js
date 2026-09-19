let autoSeedSequence = 0;

function hashSeed(value) {
  const text = String(value ?? 'mtg-ai-trainer');
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeAutomaticSeed() {
  autoSeedSequence += 1;
  const now = Date.now();
  const cryptoPart = (() => {
    try {
      if (globalThis.crypto?.getRandomValues) {
        const values = new Uint32Array(2);
        globalThis.crypto.getRandomValues(values);
        return `${values[0].toString(16)}${values[1].toString(16)}`;
      }
    } catch {}
    return `fallback-${autoSeedSequence}`;
  })();
  return `auto-${now}-${autoSeedSequence}-${cryptoPart}`;
}

/**
 * Game-wide deterministic PRNG and randomness ledger.
 *
 * Step 30 promotes the Step 20 pregame generator into the sole rules/AI
 * randomness service. Seeded games are fully reproducible. Legacy callers may
 * still inject an external RNG for tests, and those outputs are recorded in a
 * tape so diagnostics can show exactly what randomness was consumed.
 */
export class SeededRandom {
  constructor({ seed = null, rng = null } = {}) {
    this.explicitSeed = seed != null;
    this.seed = seed ?? (typeof rng === 'function' ? null : makeAutomaticSeed());
    this.external = typeof rng === 'function' ? rng : null;
    this.initialState = this.seed == null ? null : hashSeed(this.seed);
    this.state = this.initialState;
    this.calls = 0;
    this.values = [];
  }

  reset() {
    this.state = this.initialState;
    this.calls = 0;
    this.values = [];
  }

  restore(snapshot = {}) {
    if (snapshot.mode === 'external' && this.external) {
      this.calls = Number(snapshot.calls || 0);
      this.values = [...(snapshot.values || [])];
      return this.snapshot();
    }
    if (snapshot.seed == null) throw new Error('Cannot restore seeded RNG without a seed');
    this.seed = snapshot.seed;
    this.external = null;
    this.initialState = hashSeed(this.seed);
    this.state = Number.isInteger(snapshot.state) ? (snapshot.state >>> 0) : this.initialState;
    this.calls = Number(snapshot.calls || 0);
    this.values = [...(snapshot.values || [])];
    return this.snapshot();
  }

  next() {
    let value;
    if (this.external) {
      value = Number(this.external());
    } else {
      let t = this.state = (this.state + 0x6D2B79F5) >>> 0;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    this.calls++;
    this.values.push(value);
    return value;
  }

  integer(maxExclusive) {
    const max = Math.max(0, Number(maxExclusive) || 0);
    if (max <= 0) return 0;
    return Math.floor(this.next() * max);
  }

  shuffle(values = []) {
    const out = [...values];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.integer(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  snapshot() {
    return Object.freeze({
      mode: this.external ? 'external' : 'seeded',
      seed: this.seed,
      state: this.state,
      calls: this.calls,
      deterministic: !this.external,
      explicitSeed: this.explicitSeed,
      values: Object.freeze([...this.values])
    });
  }
}

export function createSeededRng(seed) {
  const service = new SeededRandom({ seed });
  const rng = () => service.next();
  rng.service = service;
  return rng;
}
