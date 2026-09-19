import fs from 'fs';
const required = [
  'src/engine/rules-version/RulesVersionService.js',
  'src/engine/rules-version/index.js',
  'tests/step44-rules-versioning-compatibility.test.js',
  'scripts/build-step44-rules-impact.mjs',
  'src/data/generated/rules-change-impact-report.json',
  'step44-rules-versioning-compatibility.md'
];
const missing = required.filter(p=>!fs.existsSync(p));
if (missing.length) { console.error('Step 44 missing deliverables:', missing.join(', ')); process.exit(1); }
const report = JSON.parse(fs.readFileSync('src/data/generated/rules-change-impact-report.json','utf8'));
if (report.schema !== 'mtg-commander-rules-change-impact') { console.error('Invalid Step 44 impact report schema'); process.exit(1); }
console.log('Step 44 deliverable check: PASS');
