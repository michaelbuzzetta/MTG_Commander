import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const testPath = path.join(root, 'tests', 'step34-cross-system-interactions.test.js');
const source = fs.readFileSync(testPath, 'utf8');
const required = [
  'hexproof×targeting',
  'protection×damage',
  'protection×attachments',
  'indestructible×destroy',
  'replacement×commander-movement',
  'token-doubling×replacement',
  'counter-doubling×replacement',
  'trample×deathtouch',
  'first-strike×double-strike',
  'copy×layers',
  'ability-removal×static-effects',
  'control-change×attachments',
  'control-change×commander-ownership',
  'multiplayer×simultaneous-triggers',
  'multiplayer×player-elimination'
];
const missing = required.filter(item => !source.includes(`'${item}'`) && !source.includes(`\"${item}\"`));
const result = { step: 34, required: required.length, present: required.length - missing.length, missing, pass: missing.length === 0 };
fs.mkdirSync(path.join(root, 'coverage'), { recursive: true });
fs.writeFileSync(path.join(root, 'coverage', 'step34-interaction-matrix.json'), JSON.stringify(result, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'coverage', 'step34-interaction-matrix.md'), `# Step 34 Interaction Matrix\n\nRequired pairs: **${required.length}**  \nPresent: **${result.present}**  \nStatus: **${result.pass ? 'PASS' : 'FAIL'}**\n\n${required.map(item => `- [${missing.includes(item) ? ' ' : 'x'}] ${item}`).join('\n')}\n`);
if (!result.pass) {
  console.error(`Step 34 interaction matrix FAIL: missing ${missing.join(', ')}`);
  process.exit(1);
}
console.log(`Step 34 interaction matrix PASS: ${result.present}/${result.required} required pairs present.`);
