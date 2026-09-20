import { CARD_SCRIPT_VERSION } from '../scripts/AbilityIR.js';

function clone(value, fallback = null) { return value == null ? fallback : structuredClone(value); }

function abilityFromAst(node, index) {
  const id = node.id || `oracle-ability-${index + 1}`;
  if (node.type === 'spell') {
    return { id, kind: 'spell', ...(node.targets ? { targets: clone(node.targets) } : {}), ...(node.optional ? { optional: true } : {}), ...(node.minTargets != null ? { minTargets: node.minTargets } : {}), ...(node.maxTargets != null ? { maxTargets: node.maxTargets } : {}), ...(node.timing ? { timing: clone(node.timing) } : {}), effect: clone(node.effect) };
  }
  if (node.type === 'triggered') {
    return {
      id, kind: 'triggered', event: clone(node.event),
      ...(node.sourceZones ? { sourceZones: clone(node.sourceZones) } : {}),
      ...(node.condition ? { condition: clone(node.condition) } : {}),
      ...(node.interveningIf ? { interveningIf: clone(node.interveningIf) } : {}),
      ...(node.targets ? { targets: clone(node.targets) } : {}),
      ...(node.optional ? { optional: true } : {}),
      ...(node.minTargets != null ? { minTargets: node.minTargets } : {}),
      ...(node.maxTargets != null ? { maxTargets: node.maxTargets } : {}),
      ...(node.timing ? { timing: clone(node.timing) } : {}),
      ...(node.modes ? { modes: clone(node.modes, []) } : {}),
      effect: clone(node.effect)
    };
  }
  if (node.type === 'activated') return { id, kind: 'activated', cost: clone(node.cost, {}), ...(node.sourceZones ? { sourceZones: clone(node.sourceZones) } : {}), ...(node.targets ? { targets: clone(node.targets) } : {}), ...(node.selection ? { selection: clone(node.selection) } : {}), ...(node.optional ? { optional: true } : {}), ...(node.minTargets != null ? { minTargets: node.minTargets } : {}), ...(node.maxTargets != null ? { maxTargets: node.maxTargets } : {}), ...(node.timing ? { timing: clone(node.timing) } : {}), effect: clone(node.effect) };
  if (node.type === 'static') return { id, kind: 'static', filter: clone(node.filter, {}), ...(node.dependsOn ? { dependsOn: clone(node.dependsOn, []) } : {}), ...(node.ruleObject ? { ruleObject: clone(node.ruleObject) } : {}), ...(node.ruleObjects ? { ruleObjects: clone(node.ruleObjects, []) } : {}), ...(node.effect ? { effect: clone(node.effect) } : {}) };
  if (node.type === 'characteristic') return { id, kind: 'characteristic', filter: clone(node.filter, {}), characteristic: clone(node.characteristic || node.effect, {}) };
  if (node.type === 'replacement') return { id, kind: 'replacement', event: clone(node.event), filter: clone(node.filter, {}), replacement: clone(node.replacement ?? node.effect) };
  throw new Error(`Unknown Oracle AST ability type "${node.type || '(missing)'}"`);
}

export class OracleAstCompiler {
  compile(ast = {}, metadata = {}) {
    if (ast.type !== 'card' || !Array.isArray(ast.abilities)) throw new Error('Oracle AST root must be a card with abilities.');
    return {
      version: CARD_SCRIPT_VERSION,
      abilities: ast.abilities.map(abilityFromAst),
      modes: structuredClone(ast.modes || []),
      metadata: { source: 'oracle-template-compiler', ...structuredClone(metadata), ...(ast.cardPatch ? { cardPatch: structuredClone(ast.cardPatch) } : {}) }
    };
  }
}
