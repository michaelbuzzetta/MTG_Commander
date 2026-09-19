export const STRICT_RULES_MODE_VERSION = 'step42-strict-rules-v1';
export const STRICT_ENGINE_BUILD = 'step42-strict-release-gate';

export const STRICT_RULES_GUARANTEES = Object.freeze({
  noApproximations: true,
  noUnsupportedScripts: true,
  noManualStateEdits: true,
  noSkippedMandatoryTriggers: true,
  aiUsesAuthoritativeLegalActionsOnly: true,
  deterministicSimulationRandomness: true,
  fullySupportedCardsOnly: true,
  startupPreflightRequired: true,
  certificationMetadataRequired: true
});

const REQUIRED_ENGINE_MODULES = Object.freeze([
  'events', 'turn', 'stack', 'priority', 'choices', 'costs', 'zones', 'triggers',
  'replacements', 'continuous', 'sba', 'combat', 'commanders', 'multiplayer',
  'mechanics', 'cardScripts', 'cardSupport', 'timing', 'legal', 'replay',
  'invariants', 'unsupported'
]);

function clone(value, fallback = null) {
  if (value == null) return fallback;
  try { return structuredClone(value); } catch { return fallback; }
}

function normalizeMechanic(value) {
  return String(value || '').trim().toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ');
}

function asModeConfig(value, enabledFallback = false) {
  if (value === true) return { enabled: true };
  if (value === false) return { enabled: false };
  if (value && typeof value === 'object') return { ...value, enabled: value.enabled !== false };
  return { enabled: !!enabledFallback };
}

export class StrictModeViolation extends Error {
  constructor(message, { code = 'STRICT_MODE_VIOLATION', tool = null, failures = null } = {}) {
    super(message);
    this.name = 'StrictModeViolation';
    this.code = code;
    this.tool = tool;
    this.failures = clone(failures, null);
  }
}

/**
 * Step 42 strict-rules release service.
 *
 * This service does not implement Magic rules itself. It turns the guarantees
 * delivered by Steps 1-41 into an enforceable operating mode, validates the
 * startup environment, locks developer/manual mutation tools, and emits
 * reproducibility/certification metadata for strict simulations.
 */
export class StrictRulesService {
  constructor(engine, options = {}) {
    this.engine = engine;
    const inferred = engine?.unsupported?.isStrict?.() || false;
    const config = asModeConfig(options, inferred);
    this.config = Object.freeze({
      version: STRICT_RULES_MODE_VERSION,
      enabled: !!config.enabled,
      lockDeveloperTools: config.lockDeveloperTools !== false,
      requireDeterministicSimulationRandomness: config.requireDeterministicSimulationRandomness !== false,
      requireFullySupportedCards: config.requireFullySupportedCards !== false,
      requiredMechanics: Object.freeze([...(config.requiredMechanics || [])].map(normalizeMechanic).filter(Boolean)),
      requiredEngineModules: Object.freeze([...(config.requiredEngineModules || REQUIRED_ENGINE_MODULES)]),
      guarantees: STRICT_RULES_GUARANTEES
    });
    this.lastPreflight = null;
    this.preflightSequence = 0;
  }

  isEnabled() { return !!this.config.enabled; }

  configSnapshot() {
    return clone({
      version: this.config.version,
      enabled: this.config.enabled,
      lockDeveloperTools: this.config.lockDeveloperTools,
      requireDeterministicSimulationRandomness: this.config.requireDeterministicSimulationRandomness,
      requireFullySupportedCards: this.config.requireFullySupportedCards,
      requiredMechanics: [...this.config.requiredMechanics],
      requiredEngineModules: [...this.config.requiredEngineModules],
      guarantees: { ...this.config.guarantees }
    }, {});
  }

  _initialDecks() {
    const e = this.engine;
    return [e?.initialDeckA, ...(Array.isArray(e?.initialDeckB) ? e.initialDeckB : [e?.initialDeckB])].filter(Boolean);
  }

  _requiredMechanics(decks) {
    const e = this.engine;
    const required = new Set(this.config.requiredMechanics);
    const explicitUnknown = new Set();
    for (const deck of decks || []) {
      for (const entry of deck?.cards || []) {
        const def = e?.db?.[entry.id] || e?.initialDb?.[entry.id];
        if (!def) continue;
        const explicit = [...(def.mechanics || []), ...(def.mechanicTags || [])].map(normalizeMechanic).filter(Boolean);
        for (const name of explicit) {
          required.add(name);
          if (!e?.mechanics?.registry?.resolve?.(name)) explicitUnknown.add(name);
        }
        for (const name of e?.mechanics?.mechanicNamesFor?.(def) || []) required.add(normalizeMechanic(name));
      }
    }
    return { required: [...required].sort(), explicitUnknown: [...explicitUnknown].sort() };
  }

  _requiredCustomHooks(decks) {
    const e = this.engine;
    const required = new Set();
    for (const deck of decks || []) {
      for (const entry of deck?.cards || []) {
        const status = e?.cardSupport?.getCardStatus?.(entry.id, e?.db || e?.initialDb || {});
        for (const hook of status?.requiredCustomHooks || []) required.add(String(hook).trim().toLowerCase());
      }
    }
    const registered = new Set((e?.cardScripts?.snapshot?.().customHooks || []).map(row => String(row.id).trim().toLowerCase()));
    return {
      required: [...required].sort(),
      missing: [...required].filter(id => !registered.has(id)).sort()
    };
  }

  _isSimulationPurpose() {
    return /simulation|benchmark|fuzz/i.test(String(this.engine?.simulationPurpose || ''));
  }

  preflight(decks = this._initialDecks(), { phase = 'startup', throwOnFailure = this.isEnabled() } = {}) {
    this.preflightSequence += 1;
    const e = this.engine;
    const rows = [];
    const check = (id, ok, detail = null) => rows.push({ id, ok: !!ok, detail: clone(detail, detail) });

    const unsupportedPolicy = e?.unsupported?.policySnapshot?.() || {};
    check('strict-interaction-policy', !this.isEnabled() || unsupportedPolicy.mode === 'strict', { mode: unsupportedPolicy.mode || null });
    check('no-partial-support-override', !this.isEnabled() || unsupportedPolicy.allowPartialSimulationOverride !== true, { allowPartialSimulationOverride: !!unsupportedPolicy.allowPartialSimulationOverride });
    check('no-permissive-approximations', !this.isEnabled() || (unsupportedPolicy.mode !== 'sandbox' && unsupportedPolicy.statisticsEligible !== false), { statisticsEligible: unsupportedPolicy.statisticsEligible !== false });

    const support = e?.unsupported?.preflightDecks?.(decks, { requireStrict: false, purpose: `step42-${phase}` }) || { strictReady: false, decks: [], blockers: [{ reason: 'Support preflight unavailable.' }] };
    check('deck-card-support', !this.isEnabled() || !this.config.requireFullySupportedCards || support.strictReady, { strictReady: !!support.strictReady, blockers: support.blockers || [] });

    check('rules-version', !this.isEnabled() || (typeof e?.rulesVersion === 'string' && e.rulesVersion.trim().length > 0), { rulesVersion: e?.rulesVersion || null });
    check('card-database-version', !this.isEnabled() || (typeof e?.cardDatabaseVersion === 'string' && e.cardDatabaseVersion.trim().length > 0), { cardDatabaseVersion: e?.cardDatabaseVersion || null });

    const missingModules = this.config.requiredEngineModules.filter(name => !e?.[name]);
    check('required-engine-modules', !this.isEnabled() || missingModules.length === 0, { required: [...this.config.requiredEngineModules], missing: missingModules });

    const mechanics = this._requiredMechanics(decks);
    const availableMechanics = new Set((e?.mechanics?.snapshot?.() || []).map(row => normalizeMechanic(row.id)));
    const missingMechanics = mechanics.required.filter(name => !availableMechanics.has(normalizeMechanic(name)));
    for (const unknown of mechanics.explicitUnknown) if (!missingMechanics.includes(unknown)) missingMechanics.push(unknown);
    missingMechanics.sort();
    check('required-mechanic-modules', !this.isEnabled() || missingMechanics.length === 0, { required: mechanics.required, missing: missingMechanics });

    const hooks = this._requiredCustomHooks(decks);
    check('required-custom-hooks', !this.isEnabled() || hooks.missing.length === 0, hooks);

    const rng = e?.random?.snapshot?.() || {};
    const deterministicRequired = this.isEnabled() && this.config.requireDeterministicSimulationRandomness && this._isSimulationPurpose();
    check('deterministic-simulation-randomness', !deterministicRequired || (rng.deterministic === true && rng.seed != null), { required: deterministicRequired, deterministic: rng.deterministic === true, seed: rng.seed ?? null, mode: rng.mode || null });

    // These guarantees are architecture/release-gate backed rather than user
    // switches. The gate runs their dedicated subsystem tests on every release.
    check('mandatory-trigger-enforcement', !this.isEnabled() || !!e?.triggers, { bypassSupported: false });
    check('ai-authoritative-legality', !this.isEnabled() || !!e?.legal, { bypassSupported: false });
    check('runtime-invariant-checks', !this.isEnabled() || e?.invariants?.enabled !== false, { enabled: e?.invariants?.enabled !== false });

    const failures = rows.filter(row => !row.ok);
    const report = {
      schema: 'mtg-commander-strict-preflight',
      schemaVersion: 1,
      strictModeVersion: STRICT_RULES_MODE_VERSION,
      engineBuild: STRICT_ENGINE_BUILD,
      sequence: this.preflightSequence,
      phase,
      enabled: this.isEnabled(),
      strictReady: !this.isEnabled() ? true : failures.length === 0,
      rulesVersion: e?.rulesVersion || null,
      cardDatabaseVersion: e?.cardDatabaseVersion || null,
      simulationPurpose: e?.simulationPurpose || 'gameplay',
      checks: rows,
      failures,
      deckSupport: clone(support, support)
    };
    this.lastPreflight = report;

    if (this.isEnabled() && failures.length && throwOnFailure) {
      throw new StrictModeViolation(`Strict rules startup preflight failed (${failures.map(row => row.id).join(', ')}).`, {
        code: 'STRICT_PREFLIGHT_FAILED', failures
      });
    }
    return clone(report, report);
  }

  assertStartupReady() {
    return this.preflight(this._initialDecks(), { phase: 'game-start', throwOnFailure: true });
  }

  preflightSnapshot() {
    return clone(this.lastPreflight, null);
  }

  assertDeveloperToolAllowed(tool, { internal = false } = {}) {
    if (internal || !this.isEnabled() || !this.config.lockDeveloperTools) return true;
    throw new StrictModeViolation(`Strict rules mode blocks developer/manual state tool: ${tool}.`, {
      code: 'STRICT_MODE_FORBIDDEN_TOOL', tool
    });
  }

  certificationSnapshot() {
    const e = this.engine;
    const preflight = this.lastPreflight || this.preflight(this._initialDecks(), { phase: 'certification', throwOnFailure: false });
    const rng = e?.random?.snapshot?.() || {};
    let replayHash = null;
    try { replayHash = e?.replay?.stateHash?.() || null; } catch {}
    const unsupported = e?.unsupported?.policySnapshot?.() || {};
    const certified = this.isEnabled()
      && preflight?.strictReady === true
      && unsupported.mode === 'strict'
      && unsupported.statisticsEligible !== false
      && Number(unsupported.diagnosticCount || 0) === 0
      && (!this._isSimulationPurpose() || (rng.deterministic === true && rng.seed != null));
    return clone({
      schema: 'mtg-commander-strict-certification',
      schemaVersion: 1,
      strictModeVersion: STRICT_RULES_MODE_VERSION,
      engineBuild: STRICT_ENGINE_BUILD,
      certified,
      rulesVersion: e?.rulesVersion || null,
      cardDatabaseVersion: e?.cardDatabaseVersion || null,
      gameId: e?.gameId || null,
      simulationPurpose: e?.simulationPurpose || 'gameplay',
      preflightResult: {
        strictReady: !!preflight?.strictReady,
        phase: preflight?.phase || null,
        failureIds: (preflight?.failures || []).map(row => row.id),
        deckCount: preflight?.deckSupport?.deckCount ?? null,
        blockerCount: preflight?.deckSupport?.blockers?.length ?? null
      },
      unsupportedPolicy: {
        mode: unsupported.mode || null,
        statisticsEligible: unsupported.statisticsEligible !== false,
        diagnosticCount: Number(unsupported.diagnosticCount || 0),
        allowPartialSimulationOverride: !!unsupported.allowPartialSimulationOverride
      },
      rng: {
        mode: rng.mode || null,
        seed: rng.seed ?? null,
        deterministic: rng.deterministic === true,
        calls: Number(rng.calls || 0)
      },
      replayHash
    }, {});
  }
}
