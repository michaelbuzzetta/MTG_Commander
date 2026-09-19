import { CARD_SCRIPT_VERSION } from '../scripts/AbilityIR.js';

function clone(value, fallback = null) { return value == null ? fallback : structuredClone(value); }

function abilityFromAst(node, index) {
  const id = node.id || `oracle-ability-${index + 1}`;
  if (node.type === 'spell') {
    return { id, kind: 'spell', ...(node.targets ? { targets: clone(node.targets) } : {}), effect: clone(node.effect) };
  }
  if (node.type === 'triggered') {
    return {
      id, kind: 'triggered', event: clone(node.event),
      ...(node.condition ? { condition: clone(node.condition) } : {}),
      ...(node.targets ? { targets: clone(node.targets) } : {}),
      effect: clone(node.effect)
    };
  }
  if (node.type === 'activated') return { id, kind: 'activated', cost: clone(node.cost, {}), ...(node.targets ? { targets: clone(node.targets) } : {}), effect: clone(node.effect) };
  if (node.type === 'static') return { id, kind: 'static', filter: clone(node.filter, {}), effect: clone(node.effect) };
  if (node.type === 'replacement') return { id, kind: 'replacement', event: clone(node.event), filter: clone(node.filter, {}), replacement: clone(node.replacement ?? node.effect) };
  throw new Error(`Unknown Oracle AST ability type "${node.type || '(missing)'}"`);
}

export class OracleAstCompiler {
  compile(ast = {}, metadata = {}) {
    if (ast.type !== 'card' || !Array.isArray(ast.abilities)) throw new Error('Oracle AST root must be a card with abilities.');
    return {
      version: CARD_SCRIPT_VERSION,
      abilities: ast.abilities.map(abilityFromAst),
      metadata: { source: 'oracle-template-compiler', ...structuredClone(metadata) }
    };
  }
}
