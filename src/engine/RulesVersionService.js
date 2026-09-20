export const CURRENT_RULES_VERSION = 'mtg-cr-2026-08-07';
export const RULES_VERSION_SCHEMA = 'mtg-commander-rules-version';
export const RULES_VERSION_SERVICE_VERSION = 1;

export class RulesVersionCompatibilityError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'RulesVersionCompatibilityError';
    this.code = 'RULES_VERSION_INCOMPATIBLE';
    this.details = structuredClone(details);
  }
}

export const RULES_COMPATIBILITY_POLICY = Object.freeze({
  mode: 'exact-by-default',
  currentRulesVersion: CURRENT_RULES_VERSION,
  guarantee: 'A historical replay runs only when its rules version is exactly supported or explicitly declared compatible; otherwise execution fails before game actions are applied.',
  explicitCompatibility: Object.freeze({
    [CURRENT_RULES_VERSION]: Object.freeze([CURRENT_RULES_VERSION])
  })
});

function normalize(value) { return String(value || '').trim(); }

export class RulesVersionService {
  constructor({ currentVersion = CURRENT_RULES_VERSION, compatibility = RULES_COMPATIBILITY_POLICY.explicitCompatibility } = {}) {
    this.currentVersion = normalize(currentVersion) || CURRENT_RULES_VERSION;
    this.compatibility = new Map();
    for (const [runtimeVersion, replayVersions] of Object.entries(compatibility || {})) {
      this.compatibility.set(normalize(runtimeVersion), new Set((replayVersions || []).map(normalize).filter(Boolean)));
    }
    if (!this.compatibility.has(this.currentVersion)) this.compatibility.set(this.currentVersion, new Set([this.currentVersion]));
    this.compatibility.get(this.currentVersion).add(this.currentVersion);
  }

  descriptor(version = this.currentVersion) {
    const normalized = normalize(version);
    return Object.freeze({ schema: RULES_VERSION_SCHEMA, schemaVersion: RULES_VERSION_SERVICE_VERSION, version: normalized, current: normalized === this.currentVersion });
  }

  isCompatible(replayVersion, runtimeVersion = this.currentVersion) {
    const replay = normalize(replayVersion);
    const runtime = normalize(runtimeVersion);
    if (!replay || !runtime) return false;
    if (replay === runtime) return true;
    return this.compatibility.get(runtime)?.has(replay) === true;
  }

  validateReplay(replayOrMetadata, runtimeVersion = this.currentVersion, { throwOnFailure = true } = {}) {
    const metadata = replayOrMetadata?.metadata || replayOrMetadata || {};
    const replayVersion = normalize(metadata.rulesVersion);
    const runtime = normalize(runtimeVersion);
    const compatible = this.isCompatible(replayVersion, runtime);
    const result = {
      schema: 'mtg-commander-rules-version-validation', schemaVersion: 1,
      replayRulesVersion: replayVersion || null,
      runtimeRulesVersion: runtime || null,
      compatible,
      policy: RULES_COMPATIBILITY_POLICY.mode,
      reason: compatible ? 'exact-or-explicitly-compatible' : (!replayVersion ? 'replay-missing-rules-version' : 'rules-version-not-compatible')
    };
    if (!compatible && throwOnFailure) {
      throw new RulesVersionCompatibilityError(`Replay rules version ${replayVersion || '(missing)'} is not compatible with runtime rules version ${runtime || '(missing)'}.`, result);
    }
    return result;
  }

  snapshot() {
    return {
      schema: RULES_VERSION_SCHEMA,
      schemaVersion: RULES_VERSION_SERVICE_VERSION,
      currentRulesVersion: this.currentVersion,
      policy: RULES_COMPATIBILITY_POLICY.mode,
      compatibleReplayVersions: [...(this.compatibility.get(this.currentVersion) || [])].sort()
    };
  }
}
