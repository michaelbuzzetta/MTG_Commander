// Step 25 compatibility facade. New code should use engine.tokens / TokenRegistry.
import { TokenRegistry } from './tokens/TokenRegistry.js';

const COMMON = new TokenRegistry();

export function canonicalTokenDefinition(token = {}) {
  if (typeof token === 'string') return COMMON.resolve(token);
  const known = COMMON.get(token?.tokenDefinitionId || token?.id || token?.name);
  if (known) return known;
  return COMMON.resolve(token);
}

export function isUtilityTokenName(name) {
  return ['Treasure', 'Food', 'Clue'].includes(String(name || ''));
}

export function commonTokenDefinitions() { return COMMON.snapshot(); }
