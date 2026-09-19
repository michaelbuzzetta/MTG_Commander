import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const testPath = path.join(root, 'tests', 'step33-rules-primitives.test.js');
const source = fs.readFileSync(testPath, 'utf8');
const required = [
  'draw', 'damage', 'moveZone', 'destroy', 'exile', 'sacrifice', 'counters',
  'createToken', 'search', 'targeting', 'costPayment', 'copy', 'controlChange'
];
const eventCritical = ['DRAW_CARD','DEAL_DAMAGE','MOVE_ZONE','DESTROY','EXILE','SACRIFICE','ADD_COUNTER','CREATE_TOKEN','CONTROL_CHANGE'];
const missing = required.filter(id => !new RegExp(`['\"]${id}['\"]`).test(source));
const missingEvents = eventCritical.filter(id => !source.includes(`ENGINE_EVENT.${id}`));
const checks = {
  requiredPrimitiveCount: required.length,
  coveredPrimitiveCount: required.length - missing.length,
  requiredPrimitives: required,
  missingPrimitives: missing,
  eventCritical,
  missingEventCritical: missingEvents,
  hasAtomicityAssertions: source.includes('assertStateUnchanged'),
  hasPartialResolutionAssertion: source.includes('resolutionTargets'),
  hasReplacementCoverage: source.includes('replacements.register'),
  hasPreventionCoverage: source.includes('addDamageShield'),
  hasSbaSchedulingCoverage: source.includes('stabilize: true'),
  hasTableDrivenCoverage: source.includes('const cases = ['),
  status: 'pass'
};
if (missing.length || missingEvents.length || !checks.hasAtomicityAssertions || !checks.hasPartialResolutionAssertion || !checks.hasReplacementCoverage || !checks.hasPreventionCoverage || !checks.hasSbaSchedulingCoverage || !checks.hasTableDrivenCoverage) checks.status = 'fail';

const outputDir = path.join(root, 'coverage');
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'step33-primitive-coverage.json'), JSON.stringify(checks, null, 2) + '\n');
const md = [
  '# Step 33 Rules Primitive Behavioral Coverage', '',
  `Status: **${checks.status.toUpperCase()}**`, '',
  `Workflow primitives covered: **${checks.coveredPrimitiveCount}/${checks.requiredPrimitiveCount}**`, '',
  '| Contract | Result |', '|---|---|',
  `| Every required workflow primitive has a dedicated Step 33 contract | ${missing.length ? `FAIL — missing ${missing.join(', ')}` : 'PASS'} |`,
  `| Critical canonical event types are exercised | ${missingEvents.length ? `FAIL — missing ${missingEvents.join(', ')}` : 'PASS'} |`,
  `| Failed operations assert atomic/no-partial state | ${checks.hasAtomicityAssertions ? 'PASS' : 'FAIL'} |`,
  `| Partial target resolution is covered | ${checks.hasPartialResolutionAssertion ? 'PASS' : 'FAIL'} |`,
  `| Replacement behavior is covered | ${checks.hasReplacementCoverage ? 'PASS' : 'FAIL'} |`,
  `| Prevention behavior is covered | ${checks.hasPreventionCoverage ? 'PASS' : 'FAIL'} |`,
  `| Trigger/SBA boundary scheduling is covered | ${checks.hasSbaSchedulingCoverage ? 'PASS' : 'FAIL'} |`,
  `| Table-driven primitive cases are present | ${checks.hasTableDrivenCoverage ? 'PASS' : 'FAIL'} |`, ''
].join('\n');
fs.writeFileSync(path.join(outputDir, 'step33-primitive-coverage.md'), md);
console.log(`Step 33 primitive behavior coverage: ${checks.coveredPrimitiveCount}/${checks.requiredPrimitiveCount} (${checks.status.toUpperCase()})`);
if (checks.status !== 'pass') process.exit(1);
