#!/usr/bin/env node
import fs from 'node:fs';
const required = [
  'src/support/PracticalCoverageService.js',
  'scripts/build-step45-final-coverage.mjs',
  'scripts/run-step45-verification.mjs',
  'tests/step45-final-edge-case-pass.test.js',
  'src/data/generated/step45-remaining-card-triage.json',
  'src/data/generated/non-digital-exclusions.json',
  'src/data/generated/practical-100-coverage-report.json',
  'PRACTICAL_100_COVERAGE_RELEASE_NOTES.md',
  'step45-final-edge-case-practical-100.md'
];
const missing = required.filter(file => !fs.existsSync(file));
if (missing.length) { console.error(`Step 45 missing deliverables: ${missing.join(', ')}`); process.exit(1); }
const triage = JSON.parse(fs.readFileSync('src/data/generated/step45-remaining-card-triage.json', 'utf8'));
const report = JSON.parse(fs.readFileSync('src/data/generated/practical-100-coverage-report.json', 'utf8'));
const exclusions = JSON.parse(fs.readFileSync('src/data/generated/non-digital-exclusions.json', 'utf8'));
if (triage.schema !== 'mtg-commander-step45-remaining-card-triage') throw new Error('Invalid Step 45 triage schema');
if (report.schema !== 'mtg-commander-step45-practical-100-coverage') throw new Error('Invalid Step 45 release report schema');
if (exclusions.schema !== 'mtg-commander-step45-non-digital-exclusions') throw new Error('Invalid Step 45 exclusion schema');
if (report.practical100Ready && (!report.catalogComplete || report.unresolvedInScopeCount !== 0 || report.censusCoversDeclaredCatalog !== true || report.productionUniverseLoaded !== true || report.step43ReviewClear !== true || report.pendingImplementationReview !== 0 || report.pendingLegalityRefresh !== 0)) throw new Error('Step 45 cannot certify practical 100% with an incomplete/uncovered catalog, pending Step 43 review, or unresolved in-scope cards');
if (report.catalogComplete && report.censusCatalogCount !== report.catalogCount) throw new Error('Step 45 complete-catalog census count must match the Step 43 declared catalog count');
if (report.explicitNonDigitalExclusionCount !== exclusions.count) throw new Error('Non-digital exclusion count mismatch');
console.log(`Step 45 deliverable check: PASS (${report.status}; strict coverage ${report.strictCoveragePercent}%).`);
