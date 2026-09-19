#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rawArgs = process.argv.slice(2);
const value = name => rawArgs.find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1) || null;
const oracleFile = value('--oracle-file');
const printingFile = value('--printing-file');
const sourceUpdatedAt = value('--source-updated-at');
const online = rawArgs.includes('--online') || (!oracleFile && !printingFile);

if (Boolean(oracleFile) !== Boolean(printingFile)) {
  console.error('Production ingestion requires both --oracle-file=<path> and --printing-file=<path>, or neither for online mode.');
  process.exit(2);
}

function run(id, command, args, timeout = 300_000) {
  console.log(`\n=== ${id} ===`);
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32', timeout });
  if (result.status !== 0) {
    const suffix = result.signal ? ` signal=${result.signal}` : ` status=${result.status}`;
    throw new Error(`${id} failed (${suffix.trim()}).`);
  }
}

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

const syncArgs = [path.join(ROOT, 'scripts', 'sync-scryfall-catalog.mjs'), '--strict'];
if (!online) {
  syncArgs.push(`--oracle-file=${path.resolve(process.cwd(), oracleFile)}`);
  syncArgs.push(`--printing-file=${path.resolve(process.cwd(), printingFile)}`);
  if (sourceUpdatedAt) syncArgs.push(`--source-updated-at=${sourceUpdatedAt}`);
}

try {
  run('Scryfall production catalog import', process.execPath, syncArgs, 900_000);
  const catalog = readJson('.cache/scryfall/card-catalog.json');
  const printings = readJson('.cache/scryfall/printing-catalog.json');
  const meta = readJson('.cache/scryfall/card-catalog-meta.json');
  if (catalog.complete !== true || printings.complete !== true) throw new Error('Imported catalog is not marked complete.');
  if (Number(catalog.count || catalog.cards?.length || 0) < 10_000) throw new Error('Oracle catalog is unexpectedly small; refusing production ingestion.');
  if (Number(printings.count || printings.cards?.length || 0) < Number(catalog.count || catalog.cards?.length || 0)) throw new Error('Printing catalog is unexpectedly smaller than the Oracle catalog.');

  // Classify the new catalog before downstream coverage builders consume it.
  run('Step 43 change classification', process.execPath, [path.join(ROOT, 'scripts', 'update-card-database-step43.mjs'), '--no-sync'], 900_000);

  // Re-resolve curated implementations against authoritative Oracle IDs, then rebuild every catalog-derived report.
  run('Card support / Oracle identity registry', process.execPath, [path.join(ROOT, 'scripts', 'build-card-support.mjs')]);
  run('Oracle template compiler inventory', process.execPath, [path.join(ROOT, 'scripts', 'build-oracle-templates.mjs')]);
  run('Compiler runtime promotions', process.execPath, [path.join(ROOT, 'scripts', 'build-compiler-promotions.mjs')]);
  run('Full Oracle support census', process.execPath, [path.join(ROOT, 'scripts', 'build-oracle-support-census.mjs')], 900_000);
  run('Engine capability gap report', process.execPath, [path.join(ROOT, 'scripts', 'build-engine-capability-gap-report.mjs')], 900_000);
  run('Full mechanic registry audit', process.execPath, [path.join(ROOT, 'scripts', 'build-mechanic-registry-audit.mjs')], 900_000);
  run('Step 40 rules coverage dashboard', process.execPath, [path.join(ROOT, 'scripts', 'build-step40-dashboard.mjs')], 900_000);
  run('Step 45 practical-100 report', process.execPath, [path.join(ROOT, 'scripts', 'build-step45-final-coverage.mjs')], 900_000);

  const census = readJson('src/data/generated/oracle-support-census.json');
  const mechanics = readJson('src/data/generated/mechanic-registry-audit.json');
  const gaps = readJson('src/data/generated/engine-capability-gap-report.json');
  const practical = readJson('src/data/generated/practical-100-coverage-report.json');
  const report = {
    schema: 'mtg-commander-production-catalog-ingestion',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceUpdatedAt: catalog.sourceUpdatedAt || meta.sourceUpdatedAt || null,
    oracleCount: catalog.count || catalog.cards.length,
    printingCount: printings.count || printings.cards.length,
    oracleCatalogSha256: meta.oracleCatalogSha256 || null,
    printingCatalogSha256: meta.printingCatalogSha256 || null,
    censusReviewedRows: census.catalog?.reviewedRows || census.summary?.totalReviewed || 0,
    censusCountMatchesCatalog: census.catalog?.coverageCountMatchesDeclared === true,
    strictEligible: census.summary?.strictEligible || 0,
    missingImplementationRecords: census.summary?.missingImplementationRecords || 0,
    mechanicMissingCount: mechanics.missingKeywordCount || 0,
    capabilityGapFamilies: gaps.summary?.gapFamilies || 0,
    unresolvedInScopeCount: practical.unresolvedInScopeCount || 0,
    practical100Ready: practical.practical100Ready === true
  };
  const out = path.join(ROOT, 'src', 'data', 'generated', 'production-catalog-ingestion-report.json');
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);

  if (!report.censusCountMatchesCatalog) throw new Error(`Full census reviewed ${report.censusReviewedRows} identities but catalog contains ${report.oracleCount}.`);
  console.log(`\nProduction catalog ingestion complete: ${report.oracleCount} Oracle identities / ${report.printingCount} printings.`);
  console.log(`Strict eligible: ${report.strictEligible}; missing implementations: ${report.missingImplementationRecords}; unresolved in-scope: ${report.unresolvedInScopeCount}.`);
  console.log(`Missing observed keyword mechanics: ${report.mechanicMissingCount}; gap families: ${report.capabilityGapFamilies}.`);
} catch (error) {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
}
