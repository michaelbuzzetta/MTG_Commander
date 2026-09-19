#!/usr/bin/env node
import fs from 'node:fs';

const required = [
  'src/support/CoverageDashboardService.js',
  'src/support/index.js',
  'src/components/CardSupportDashboard.jsx',
  'src/data/generated/rules-coverage-dashboard.json',
  'scripts/build-step40-dashboard.mjs',
  'tests/step40-card-support-dashboard.test.js',
  'step40-card-support-rules-coverage-dashboard.md'
];
const missing = required.filter(file => !fs.existsSync(file));
if (missing.length) throw new Error(`Missing Step 40 deliverables:\n${missing.map(file => ` - ${file}`).join('\n')}`);
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
for (const script of ['build:step40','check:step40','test:step40']) if (!pkg.scripts?.[script]) throw new Error(`package.json is missing ${script}`);
const app = fs.readFileSync('src/App.jsx', 'utf8');
const component = fs.readFileSync('src/components/CardSupportDashboard.jsx', 'utf8');
if (!app.includes('CardSupportDashboard') || !app.includes('showSupportDashboard')) throw new Error('Step 40 dashboard is not integrated into App.jsx.');
for (const marker of ['Subsystem health','Per-card drill-down','Deck readiness','Latest Step 38 benchmark artifact']) if (!component.includes(marker)) throw new Error(`Dashboard UI missing marker: ${marker}`);
console.log('Step 40 card support and rules coverage dashboard deliverables present.');
