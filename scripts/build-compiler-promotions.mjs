#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyCatalogCardScope } from '../src/support/CardScopePolicy.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const read = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const outFile = path.join(ROOT, 'src/data/generated/compiler-promoted-cards.json');
const stable = value => JSON.stringify(value, (key, val) => key === 'generatedAt' ? undefined : val);

const catalog = read('.cache/scryfall/card-catalog.json');
const compilation = read('src/data/generated/oracle-template-compilation.json');
const support = read('src/data/generated/card-support.json');
if (catalog.complete !== true) throw new Error('Compiler promotions require a complete production Oracle catalog.');
if (compilation.parserVersion == null) throw new Error('Compiler promotions require versioned Step 18 compilation artifacts.');

const byId = new Map(catalog.cards.map(card => [card.id, card]));
const implementedOracleIds = new Set((support.cards || []).map(row => row.oracleId).filter(Boolean));
const implementedNames = new Set((support.cards || []).map(row => String(row.name || '').toLowerCase()));
const cards = {};
const skippedExisting = [];

function subtypes(typeLine = '') {
  const parts = String(typeLine).split(/\s+[—-]\s+/);
  return parts.length > 1 ? parts.slice(1).join(' — ').trim().split(/\s+/).filter(Boolean) : [];
}

for (const row of compilation.rows || []) {
  if (!(row.autoAccepted === true && row.status === 'compiled' && row.confidence === 'high' && row.script)) continue;
  const catalogCard = byId.get(row.cardId);
  if (!catalogCard || !classifyCatalogCardScope(catalogCard).inScope) continue;
  if (catalogCard.layout !== 'normal') continue; // Current exact templates are certified only for normal-layout promotion.
  if ((catalogCard.oracleId && implementedOracleIds.has(catalogCard.oracleId)) || implementedNames.has(String(catalogCard.name || '').toLowerCase())) {
    skippedExisting.push({ cardId: row.cardId, name: row.name, oracleId: catalogCard.oracleId || null });
    continue;
  }
  cards[row.cardId] = {
    id: row.cardId,
    oracleId: catalogCard.oracleId || null,
    scryfallId: catalogCard.scryfallId || null,
    name: catalogCard.name,
    layout: catalogCard.layout,
    typeLine: catalogCard.typeLine,
    manaCost: catalogCard.manaCost || '',
    manaValue: Number(catalogCard.manaValue || 0),
    power: catalogCard.power ?? null,
    toughness: catalogCard.toughness ?? null,
    loyalty: catalogCard.loyalty ?? null,
    defense: catalogCard.defense ?? null,
    colors: catalogCard.colors || [],
    colorIdentity: catalogCard.colorIdentity || [],
    subtypes: subtypes(catalogCard.typeLine),
    keywords: catalogCard.keywords || [],
    producedMana: catalogCard.producedMana || null,
    oracleText: catalogCard.oracleText || '',
    abilities: [],
    spellEffects: [],
    script: row.script,
    supported: true,
    compilerPromoted: true,
    compilerPromotion: {
      parserVersion: compilation.parserVersion,
      oracleFingerprint: row.oracleFingerprint,
      behaviorFingerprint: row.behaviorFingerprint,
      templateIds: row.matchedTemplates || [],
      certificationEligible: false,
      certificationStatus: 'uncertified'
    }
  };
}

const payload = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  parserVersion: compilation.parserVersion,
  catalogCount: catalog.cards.length,
  promotedCount: Object.keys(cards).length,
  skippedExistingCount: skippedExisting.length,
  policy: 'Exact high-confidence compiler output may become runtime-authoritative partial support, but remains strict-ineligible until card-specific behavioral and golden certification passes.',
  skippedExisting,
  cards
};

if (CHECK) {
  if (!fs.existsSync(outFile)) throw new Error('Missing compiler-promoted-cards.json; run build:promotions.');
  const existing = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  if (stable(existing) !== stable(payload)) throw new Error('compiler-promoted-cards.json is stale; run build:promotions.');
  console.log(`Compiler promotion artifact current: ${payload.promotedCount} runtime partial implementations (${payload.skippedExistingCount} existing implementations skipped).`);
} else {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const tmp = `${outFile}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(payload)}\n`);
  fs.renameSync(tmp, outFile);
  console.log(`Built compiler promotion artifact: ${payload.promotedCount} runtime partial implementations (${payload.skippedExistingCount} existing implementations skipped).`);
}
