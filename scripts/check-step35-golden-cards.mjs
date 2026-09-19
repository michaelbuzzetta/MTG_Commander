import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/golden/step35-golden-cards.json'), 'utf8'));
const support = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/generated/card-support.json'), 'utf8'));
const cards = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/source/cards.json'), 'utf8'));

function fingerprint(value = '') {
  return crypto.createHash('sha256').update(String(value).replace(/\r\n/g, '\n').trim()).digest('hex').slice(0, 16);
}

const errors = [];
const full = support.cards.filter(row => row.supportStatus === 'fully_supported');
const manifestIds = Object.keys(manifest.cards || {}).sort();
const fullIds = full.map(row => row.cardId).sort();
if (JSON.stringify(manifestIds) !== JSON.stringify(fullIds)) {
  const missing = fullIds.filter(id => !manifestIds.includes(id));
  const extra = manifestIds.filter(id => !fullIds.includes(id));
  if (missing.length) errors.push(`Missing golden contracts: ${missing.join(', ')}`);
  if (extra.length) errors.push(`Golden contracts exist for non-full cards: ${extra.join(', ')}`);
}

let caseCount = 0;
for (const row of full) {
  const contract = manifest.cards?.[row.cardId];
  const card = cards[row.cardId];
  if (!contract) continue;
  const cases = Array.isArray(contract.cases) ? contract.cases : [];
  caseCount += cases.length;
  if (!cases.length) errors.push(`${row.cardId} has no executable golden cases.`);
  if (new Set(cases.map(item => item.id)).size !== cases.length) errors.push(`${row.cardId} contains duplicate golden case IDs.`);
  if (contract.name !== row.name) errors.push(`${row.cardId} name mismatch (${contract.name} vs ${row.name}).`);
  if (contract.oracleIdentity !== row.oracleIdentity) errors.push(`${row.cardId} Oracle identity mismatch.`);
  if (contract.supportRulesVersion !== row.lastValidatedRulesVersion) errors.push(`${row.cardId} golden rules version is stale.`);
  if (contract.oracleTextFingerprint !== fingerprint(card?.oracleText || '')) errors.push(`${row.cardId} Oracle text fingerprint is stale; review and update its golden fixture.`);
  if (Number(row.goldenTestCount || 0) !== cases.length) errors.push(`${row.cardId} support metadata goldenTestCount is stale.`);
  if (row.goldenContractVersion !== manifest.contractVersion) errors.push(`${row.cardId} support metadata golden contract version is stale.`);
  const abilityCount = Array.isArray(card?.abilities) ? card.abilities.length : 0;
  if (abilityCount > 1 && cases.length < abilityCount) errors.push(`${row.cardId} has ${abilityCount} material abilities but only ${cases.length} golden cases.`);
}

if (manifest.engineRulesVersion !== support.rulesVersion) errors.push(`Golden engine rules version ${manifest.engineRulesVersion} does not match support rules version ${support.rulesVersion}.`);

const coverage = {
  step: 35,
  schemaVersion: 1,
  contractVersion: manifest.contractVersion,
  engineRulesVersion: manifest.engineRulesVersion,
  supportRulesVersion: manifest.generatedForSupportRulesVersion,
  fullySupportedCards: full.length,
  goldenCoveredCards: full.filter(row => (manifest.cards?.[row.cardId]?.cases || []).length > 0).length,
  goldenBehaviorCases: caseCount,
  staleOrMissingContracts: errors,
  pass: errors.length === 0,
  cards: full.map(row => ({
    cardId: row.cardId,
    name: row.name,
    oracleIdentity: row.oracleIdentity,
    oracleTextFingerprint: manifest.cards?.[row.cardId]?.oracleTextFingerprint || null,
    caseIds: (manifest.cards?.[row.cardId]?.cases || []).map(item => item.id)
  }))
};
fs.mkdirSync(path.join(ROOT, 'coverage'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'coverage', 'step35-golden-card-coverage.json'), `${JSON.stringify(coverage, null, 2)}\n`);
fs.writeFileSync(path.join(ROOT, 'coverage', 'step35-golden-card-coverage.md'), `# Step 35 Golden Card Coverage\n\nFully supported cards: **${coverage.fullySupportedCards}**  \nGolden-covered cards: **${coverage.goldenCoveredCards}**  \nGolden behavior cases: **${coverage.goldenBehaviorCases}**  \nStatus: **${coverage.pass ? 'PASS' : 'FAIL'}**\n\n${coverage.cards.map(card => `- [${card.caseIds.length ? 'x' : ' '}] **${card.name}** (${card.cardId}) — ${card.caseIds.join(', ') || 'no cases'}`).join('\n')}\n`);

if (errors.length) {
  console.error(`Step 35 golden-card gate FAILED:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log(`Step 35 golden-card gate PASS: ${full.length}/${full.length} fully supported cards covered by ${caseCount} golden behavior cases.`);
