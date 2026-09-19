function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function stableStringify(value) {
  return stable(value);
}

export function hashText(text = '') {
  // FNV-1a 64-bit expressed as a fixed-width hex string. BigInt arithmetic is
  // deterministic in current Node/browser runtimes and keeps this dependency-free.
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

export function authoritativeStateProjection(state) {
  const copy = structuredClone(state);
  // These arrays explain legality/timing queries but do not alter game rules.
  // UI/AI may legitimately produce different query traces during replay.
  delete copy.legalityDiagnostics;
  delete copy.timingDiagnostics;
  return copy;
}

export function hashState(state) {
  return hashText(JSON.stringify(authoritativeStateProjection(state)));
}
