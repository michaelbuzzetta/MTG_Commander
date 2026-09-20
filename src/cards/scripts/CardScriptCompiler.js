import { ABILITY_KIND, CARD_SCRIPT_VERSION, normalizeAbilityIR } from './AbilityIR.js';
import { selectorToTargetSpec } from './SelectorDSL.js';
import { EffectPrimitiveLibrary } from './EffectPrimitiveLibrary.js';
import { ScriptValidator } from './ScriptValidator.js';

function clone(value, fallback = null) { return value == null ? fallback : structuredClone(value); }

function normalizeControlEffect(node, compiler) {
  if (Array.isArray(node)) return { type: 'sequence', effects: node.map(child => compiler.compileEffect(child)) };
  const op = node.op || node.primitive;
  if (op === 'sequence') return { type: 'sequence', effects: (node.effects || []).map(child => compiler.compileEffect(child)) };
  if (op === 'if') return { type: 'scriptIf', condition: clone(node.condition, {}), then: compiler.compileEffect(node.then), otherwise: node.otherwise == null ? null : compiler.compileEffect(node.otherwise) };
  if (op === 'forEach') return { type: 'scriptForEach', selector: clone(node.selector, {}), as: node.as, effect: compiler.compileEffect(node.effect) };
  if (op === 'repeat') return { type: 'scriptRepeat', times: clone(node.times, 0), effect: compiler.compileEffect(node.effect) };
  if (op === 'may') return { type: 'optionalEffect', prompt: node.prompt || 'Use this effect?', then: compiler.compileEffect(node.effect) };
  if (op === 'customHook') return { type: 'customHook', hookId: node.hookId || node.hook, version: String(node.version), args: clone(node.args, {}) };
  return null;
}

export class CardScriptCompiler {
  constructor({ primitives = new EffectPrimitiveLibrary(), validator = null } = {}) {
    this.primitives = primitives;
    this.validator = validator || new ScriptValidator({ primitives });
  }

  compileEffect(node) {
    if (node == null) return null;
    if (Array.isArray(node)) return { type: 'sequence', effects: node.map(child => this.compileEffect(child)) };
    const control = normalizeControlEffect(node, this);
    if (control) return control;
    return this.primitives.lower(node);
  }

  compileAbility(input, index = 0) {
    const ability = normalizeAbilityIR(input, index);
    const targetSpec = ability.targets ? selectorToTargetSpec(ability.targets, { minTargets: ability.minTargets, maxTargets: ability.maxTargets, optional: ability.optional }) : null;
    const common = {
      scriptAbilityId: ability.id,
      ...(targetSpec ? { targets: targetSpec } : {}),
      ...(ability.minTargets != null ? { minTargets: Number(ability.minTargets) } : {}),
      ...(ability.maxTargets != null ? { maxTargets: Number(ability.maxTargets) } : {}),
      ...(ability.optional ? { optional: true } : {}),
      ...(ability.metadata && Object.keys(ability.metadata).length ? { scriptMetadata: clone(ability.metadata, {}) } : {})
    };

    if (ability.kind === ABILITY_KIND.SPELL) return { kind: 'spell', effects: [this.compileEffect(ability.effect)], targets: targetSpec, id: ability.id, timing: clone(ability.timing, null) };
    if (ability.kind === ABILITY_KIND.ACTIVATED) return { type: 'activated', cost: clone(ability.cost, {}), ...(ability.sourceZones ? { sourceZones: clone(ability.sourceZones) } : {}), ...(ability.cost?.tap ? { tap: true } : {}), ...(ability.timing ? { timing: clone(ability.timing) } : {}), ...(ability.timing?.sorcerySpeed ? { sorcerySpeed: true } : {}), ...common, effect: this.compileEffect(ability.effect) };
    if (ability.kind === ABILITY_KIND.TRIGGERED) return { type: 'triggered', event: clone(ability.event), sourceZones: clone(ability.sourceZones, undefined), condition: clone(ability.condition, {}), interveningIf: clone(ability.interveningIf, undefined), ...(ability.modes?.length ? { modes: ability.modes.map(mode => ({ ...clone(mode, {}), ...(mode.targets ? { targets: selectorToTargetSpec(mode.targets) } : {}), effect: this.compileEffect(mode.effect) })) } : {}), ...common, effect: this.compileEffect(ability.effect) };
    if (ability.kind === ABILITY_KIND.REPLACEMENT) {
      const replacement = ability.replacement ?? ability.effect;
      return { type: 'replacement', event: clone(ability.event), filter: clone(ability.filter, {}), affectedFilter: clone(ability.affectedFilter, undefined), ...common, ...(typeof replacement === 'string' ? { effect: replacement } : { effect: clone(replacement, {}) }) };
    }
    if (ability.kind === ABILITY_KIND.STATIC) return { type: 'static', filter: clone(ability.filter, {}), ...(ability.dependsOn?.length ? { dependsOn: clone(ability.dependsOn, []) } : {}), ...(ability.ruleObject ? { ruleObject: clone(ability.ruleObject) } : {}), ...(ability.ruleObjects?.length ? { ruleObjects: clone(ability.ruleObjects, []) } : {}), ...common, ...(ability.effect ? { effect: clone(ability.effect, {}) } : {}) };
    if (ability.kind === ABILITY_KIND.CDA) return { type: 'static', cda: true, filter: { self: true, ...clone(ability.filter, {}) }, ...common, effect: clone(ability.characteristic, {}) };
    throw new Error(`Unsupported ability kind ${ability.kind}`);
  }

  compileCard(card = {}) {
    const script = card.script || card.cardScript;
    if (!script) return structuredClone(card);
    this.validator.assertValid(card);
    const compiled = structuredClone(card);
    const existingAbilities = [...(compiled.abilities || [])];
    const existingSpellEffects = [...(compiled.spellEffects || [])];
    const scriptedAbilities = [];
    const scriptedSpellEffects = [];
    const scriptedSpellTargets = [];
    const scriptedSpellTimings = [];
    for (const [index, raw] of (script.abilities || []).entries()) {
      const result = this.compileAbility(raw, index);
      if (result.kind === 'spell') {
        scriptedSpellEffects.push(...result.effects.filter(Boolean));
        if (result.targets) scriptedSpellTargets.push(result.targets);
        if (result.timing) scriptedSpellTimings.push(result.timing);
      } else scriptedAbilities.push(result);
    }
    compiled.abilities = [...existingAbilities, ...scriptedAbilities];
    compiled.spellEffects = [...existingSpellEffects, ...scriptedSpellEffects];
    // Step 18 template compilation needs targeted spell IR to lower to the
    // same card-level target contract used by hand-authored spells. A single
    // scripted spell target specification is unambiguous; modal/multi-spell
    // target structures remain represented on their individual modes.
    if (!compiled.targets && scriptedSpellTargets.length === 1) compiled.targets = structuredClone(scriptedSpellTargets[0]);
    if (!compiled.timing && scriptedSpellTimings.length === 1) compiled.timing = structuredClone(scriptedSpellTimings[0]);
    if ((script.modes || []).length) {
      compiled.modes = [...(compiled.modes || []), ...(script.modes || []).map(mode => ({
        id: mode.id,
        label: mode.label || mode.id,
        ...(mode.timing != null ? { timing: clone(mode.timing) } : {}),
        ...(mode.targets || mode.target ? { targets: selectorToTargetSpec(mode.targets || mode.target, { minTargets: mode.minTargets, maxTargets: mode.maxTargets, optional: !!mode.optional }) } : {}),
        effects: [this.compileEffect(mode.effect ?? mode.effects)].filter(Boolean)
      }))];
    }
    // Oracle templates may contribute card-level casting metadata that cannot
    // be represented as a resolving ability (for example flashback or a
    // permission to cast this card from another zone). Keep this declarative
    // and let GameEngine/CostEngine enforce it authoritatively.
    const cardPatch = script.metadata?.cardPatch;
    if (cardPatch && typeof cardPatch === 'object') {
      if (Array.isArray(cardPatch.castingOptions)) {
        compiled.castingOptions = [...(compiled.castingOptions || []), ...structuredClone(cardPatch.castingOptions)];
      }
      for (const [key, value] of Object.entries(cardPatch)) {
        if (key === 'castingOptions') continue;
        if (key === 'abilities' && Array.isArray(value)) {
          compiled.abilities = [...(compiled.abilities || []), ...structuredClone(value)];
          continue;
        }
        compiled[key] = structuredClone(value);
      }
    }
    compiled.scriptVersion = Number(script.version ?? CARD_SCRIPT_VERSION);
    compiled.scriptCompiled = true;
    compiled.scriptMetadata = clone(script.metadata, {});
    delete compiled.script;
    delete compiled.cardScript;
    return compiled;
  }

  compileDatabase(db = {}) {
    return Object.fromEntries(Object.entries(db).map(([id, card]) => [id, this.compileCard({ ...card, id: card.id || id })]));
  }
}
