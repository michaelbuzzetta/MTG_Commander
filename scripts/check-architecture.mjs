import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONSUMER_PATHS = [
  'src/App.jsx',
  'src/ai',
  'src/components',
  'src/utils/turnAutomation.js'
];

const FORBIDDEN = [
  { id: 'authoritative-state', re: /\b(?:engine|this\.engine|e)\.state\b/g, message: 'Consumers must use getStateSnapshot().' },
  { id: 'mutable-database', re: /\b(?:engine|this\.engine|e)\.db\b/g, message: 'Consumers must use getCardDatabaseSnapshot()/getCardDefinition().' },
  { id: 'legacy-perform', re: /\b(?:engine|this\.engine|e)\.perform\s*\(/g, message: 'Consumers must use submitAction(), submitChoice(), or passPriority().' },
  { id: 'internal-subsystem', re: /\b(?:engine|this\.engine|e)\.(?:combat|targeting|static|effects|triggers|mana|legal)\b/g, message: 'Consumers must use GameEngine public query/action methods, not subsystem instances.' },
  { id: 'private-engine-helper', re: /\b(?:engine|this\.engine|e)\._[A-Za-z_$][\w$]*\s*\(/g, message: 'Consumers may not call private GameEngine helpers.' },
  { id: 'authoritative-object-lookup', re: /\b(?:engine|this\.engine|e)\.findPermanent\s*\(/g, message: 'Consumers must use snapshots/public immutable queries.' }
];


const ZONE_MUTATION_RULES = [
  { id: 'direct-player-zone-mutator', re: /\.(?:library|hand|battlefield|graveyard|exile|command)\.(?:push|pop|shift|unshift|splice|sort|reverse)\s*\(/g, message: 'Production player-zone arrays may only be mutated inside src/engine/zones/.' },
  { id: 'direct-player-zone-assignment', re: /\.(?:library|hand|battlefield|graveyard|exile|command)\s*=\s*(?![=>])/g, message: 'Production player-zone containers may only be replaced inside src/engine/zones/.' }
];

function filesUnder(rel) {
  const absolute = path.join(ROOT, rel);
  if (!fs.existsSync(absolute)) return [];
  const stat = fs.statSync(absolute);
  if (stat.isFile()) return [absolute];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap(entry => {
    const child = path.join(absolute, entry.name);
    if (entry.isDirectory()) return filesUnder(path.relative(ROOT, child));
    return /\.(?:js|jsx|mjs|ts|tsx)$/.test(entry.name) ? [child] : [];
  });
}

function allSourceFiles() {
  return filesUnder('src').filter(file => !path.relative(ROOT, file).replaceAll('\\', '/').startsWith('src/engine/zones/'));
}

export function checkArchitecture() {
  const violations = [];
  const files = [...new Set(CONSUMER_PATHS.flatMap(filesUnder))];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    for (const rule of FORBIDDEN) {
      rule.re.lastIndex = 0;
      let match;
      while ((match = rule.re.exec(text))) {
        const before = text.slice(0, match.index);
        const line = before.split(/\r?\n/).length;
        violations.push({
          rule: rule.id,
          file: path.relative(ROOT, file).replaceAll('\\', '/'),
          line,
          text: lines[line - 1]?.trim() || '',
          message: rule.message
        });
      }
    }
  }
  for (const file of allSourceFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    for (const rule of ZONE_MUTATION_RULES) {
      rule.re.lastIndex = 0;
      let match;
      while ((match = rule.re.exec(text))) {
        const line = text.slice(0, match.index).split(/\r?\n/).length;
        violations.push({
          rule: rule.id,
          file: path.relative(ROOT, file).replaceAll('\\', '/'),
          line,
          text: lines[line - 1]?.trim() || '',
          message: rule.message
        });
      }
    }
  }
  return violations;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const violations = checkArchitecture();
  if (violations.length) {
    console.error(`Architecture boundary check failed with ${violations.length} violation(s):`);
    for (const item of violations) console.error(`- ${item.file}:${item.line} [${item.rule}] ${item.text}\n  ${item.message}`);
    process.exitCode = 1;
  } else {
    console.log('Architecture boundary check passed: UI/AI consumers use only public GameEngine interfaces and player-zone mutations are isolated to src/engine/zones/.');
  }
}
