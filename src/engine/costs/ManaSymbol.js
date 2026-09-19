const COLORS = new Set(['W','U','B','R','G','C']);
const VARIABLES = new Set(['X','Y','Z']);

export function parseManaSymbols(cost = '') {
  return [...String(cost).matchAll(/\{([^}]+)\}/g)].map((match, index) => {
    const raw = String(match[1]).trim().toUpperCase();
    if (/^\d+$/.test(raw)) return { kind: 'generic', amount: Number(raw), raw, index };
    if (COLORS.has(raw)) return { kind: 'colored', color: raw, raw, index };
    if (VARIABLES.has(raw)) return { kind: 'variable', variable: raw, raw, index };
    if (raw === 'S') return { kind: 'snow', raw, index };
    if (raw.includes('/')) {
      const parts = raw.split('/');
      if (parts.length === 2 && parts[1] === 'P' && COLORS.has(parts[0])) return { kind: 'phyrexian', color: parts[0], raw, index };
      if (parts.length === 2 && parts[0] === '2' && COLORS.has(parts[1])) return { kind: 'monohybrid', color: parts[1], generic: 2, raw, index };
      if (parts.length === 2 && parts.every(part => COLORS.has(part))) return { kind: 'hybrid', colors: parts, raw, index };
    }
    return { kind: 'unknown', raw, index };
  });
}

export function expandManaCostAlternatives(cost = '', { variables = {}, maxAlternatives = 256 } = {}) {
  let alternatives = [{ exact: { W:0,U:0,B:0,R:0,G:0,C:0 }, generic: 0, snow: 0, life: 0, choices: [] }];
  const addBranch = (base, patch) => ({
    exact: { ...base.exact, ...(patch.exact || {}) },
    generic: base.generic + Number(patch.generic || 0),
    snow: base.snow + Number(patch.snow || 0),
    life: base.life + Number(patch.life || 0),
    choices: [...base.choices, patch.choice].filter(Boolean)
  });

  for (const symbol of parseManaSymbols(cost)) {
    const next = [];
    for (const alt of alternatives) {
      if (symbol.kind === 'generic') next.push(addBranch(alt, { generic: symbol.amount }));
      else if (symbol.kind === 'colored') next.push(addBranch(alt, { exact: { [symbol.color]: alt.exact[symbol.color] + 1 } }));
      else if (symbol.kind === 'variable') next.push(addBranch(alt, { generic: Math.max(0, Number(variables[symbol.variable] || 0)) }));
      else if (symbol.kind === 'snow') next.push(addBranch(alt, { snow: 1 }));
      else if (symbol.kind === 'hybrid') {
        for (const color of symbol.colors) next.push(addBranch(alt, { exact: { [color]: alt.exact[color] + 1 }, choice: { symbol: symbol.raw, paidAs: color } }));
      } else if (symbol.kind === 'monohybrid') {
        next.push(addBranch(alt, { generic: symbol.generic, choice: { symbol: symbol.raw, paidAs: '2' } }));
        next.push(addBranch(alt, { exact: { [symbol.color]: alt.exact[symbol.color] + 1 }, choice: { symbol: symbol.raw, paidAs: symbol.color } }));
      } else if (symbol.kind === 'phyrexian') {
        next.push(addBranch(alt, { exact: { [symbol.color]: alt.exact[symbol.color] + 1 }, choice: { symbol: symbol.raw, paidAs: symbol.color } }));
        next.push(addBranch(alt, { life: 2, choice: { symbol: symbol.raw, paidAs: '2 life' } }));
      } else throw new Error(`Unsupported mana symbol {${symbol.raw}}`);
    }
    if (next.length > maxAlternatives) throw new Error(`Mana cost expands beyond ${maxAlternatives} legal alternatives`);
    alternatives = next;
  }

  const seen = new Set();
  return alternatives.filter(alt => {
    const key = JSON.stringify([alt.exact, alt.generic, alt.snow, alt.life]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function manaCostHasAdvancedSymbols(cost = '') {
  return parseManaSymbols(cost).some(symbol => !['generic','colored'].includes(symbol.kind));
}
