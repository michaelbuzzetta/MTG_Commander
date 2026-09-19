import fs from 'node:fs';
const required = [
  'src/engine/fuzz/FuzzBot.js',
  'src/engine/fuzz/PropertyAssertions.js',
  'src/engine/fuzz/FailureCorpus.js',
  'src/engine/fuzz/ReplayMinimizer.js',
  'tests/step37-simulation-fuzzing.test.js',
  'scripts/run-step37-fuzz.mjs',
  'tests/fuzz/failure-corpus/README.md',
  '.github/workflows/step37-fuzz-nightly.yml',
  'step37-simulation-fuzzing.md',
  'STEP37_COMPLETION_REPORT.md'
];
const missing = required.filter(file => !fs.existsSync(file));
if (missing.length) {
  console.error(`Step 37 missing deliverables:\n${missing.map(x => ` - ${x}`).join('\n')}`);
  process.exit(1);
}
const fuzz = fs.readFileSync('src/engine/fuzz/FuzzBot.js', 'utf8');
for (const marker of ['getLegalActions', 'SeededRandom', 'persistFailures', 'LEGAL_ACTION_REJECTED']) {
  if (!fuzz.includes(marker)) throw new Error(`Step 37 FuzzBot missing required marker: ${marker}`);
}
console.log('Step 37 fuzzing deliverables present.');
