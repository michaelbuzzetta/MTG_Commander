import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import dashboardData from '../src/data/generated/rules-coverage-dashboard.json' with { type: 'json' };
import { CoverageDashboardService } from '../src/support/CoverageDashboardService.js';

test('Step 40 dashboard metrics are data-backed and status counts reconcile to the catalog total', () => {
  const summary = dashboardData.summary;
  const total = Object.values(summary.statusCounts).reduce((sum, value) => sum + Number(value || 0), 0);
  assert.equal(total, summary.totalCards);
  assert.equal(summary.totalCards, dashboardData.cards.length);
  assert.ok(summary.mechanicsRegistered > 0);
  assert.equal(dashboardData.releaseGate.dataBackedCoverage, true);
  assert.match(dashboardData.releaseGate.policy, /repository support records/i);
});

test('Step 40 card query and drill-down expose support, parser/script, AI, test, mechanic, hook and caveat data', () => {
  const service = new CoverageDashboardService(dashboardData);
  const rows = service.queryCards({ search: 'Sol Ring', limit: 20 });
  assert.ok(rows.length >= 1);
  const card = service.findCard(rows[0].cardId);
  for (const field of ['dashboardStatus','implementationPath','parserStatus','scriptStatus','castingSupport','aiSupport','testCount','goldenTestCount','requiredCustomHooks','caveats','mechanics']) assert.ok(Object.hasOwn(card, field), field);
  assert.ok(Array.isArray(card.mechanics));
  assert.ok(Array.isArray(card.caveats));
});

test('Step 40 deck readiness reports strict blockers and maps them back to named card support records', () => {
  const service = new CoverageDashboardService(dashboardData);
  const decks = service.getDeckReadiness();
  assert.ok(decks.length > 0);
  const blocked = decks.find(deck => !deck.strictReady && deck.blockerCount > 0);
  assert.ok(blocked);
  assert.equal(blocked.blockers.length, blocked.blockerCount);
  assert.ok(blocked.blockers.every(blocker => blocker.cardId && blocker.name && blocker.status));
});

test('Step 40 subsystem health includes primitives, judge scenarios, fuzzing, performance and CI without pretending configured CI is a live pass', () => {
  const service = new CoverageDashboardService(dashboardData);
  const health = new Map(service.getSubsystemHealth().map(row => [row.id, row]));
  for (const key of ['rules-primitives','judge-scenarios','fuzzing','performance','ci']) assert.ok(health.has(key), key);
  assert.equal(service.getCi().status, 'configured-not-a-live-CI-result');
  assert.equal(service.getReleaseGate().ciStatus, 'configured-not-a-live-CI-result');
});

test('Step 40 React integration provides a searchable dashboard, per-card drill-down and deck readiness entry point', () => {
  const app = fs.readFileSync('src/App.jsx', 'utf8');
  const component = fs.readFileSync('src/components/CardSupportDashboard.jsx', 'utf8');
  assert.match(app, /CardSupportDashboard/);
  assert.match(app, /showSupportDashboard/);
  assert.match(app, /Card Support & Rules Coverage/);
  assert.match(component, /Per-card drill-down/);
  assert.match(component, /Deck readiness/);
  assert.match(component, /Subsystem health/);
  assert.match(component, /Live CI result/);
});
