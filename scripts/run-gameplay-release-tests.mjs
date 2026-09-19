import { spawnSync } from 'node:child_process';

// Compact release gate: these suites collectively cover the 15 gameplay
// acceptance areas without loading every historical workflow test at once.
const tests = [
  'tests/step5-stack-priority.test.js',
  'tests/step7-costs-payment.test.js',
  'tests/step9-triggered-abilities.test.js',
  'tests/step10-replacement-prevention.test.js',
  'tests/step11-continuous-layers.test.js',
  'tests/step13-combat-engine.test.js',
  'tests/step16-card-scripting.test.js',
  'tests/step18-oracle-template-compiler.test.js',
  'tests/step34-cross-system-interactions.test.js',
  'tests/step35-golden-card-behavior.test.js',
  'tests/step36-judge-scenarios.test.js',
  'tests/step41-unsupported-interactions.test.js'
];

console.log(`Running ${tests.length} gameplay-focused release suites...`);
const result = spawnSync(process.execPath, ['--test', ...tests], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`\nGameplay release test gate passed (${tests.length} focused suites).`);
