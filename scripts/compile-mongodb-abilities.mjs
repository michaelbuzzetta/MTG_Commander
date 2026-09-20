import { mongoDb, ensureCardIndexes, closeMongo } from './mongo-card-store.mjs';
import { OracleTemplateCompiler } from '../src/cards/compiler/OracleTemplateCompiler.js';
import { ORACLE_PARSER_VERSION, oracleFingerprint } from '../src/cards/compiler/OracleTokenizer.js';

const BATCH = 500;
const CHECK_ONLY = process.argv.includes('--check');
const compiler = new OracleTemplateCompiler();

function behaviorDoc(card, result) {
  const fully = result.autoAccepted === true;
  return {
    oracleId: card.oracleId,
    cardId: card.id,
    name: card.name,
    oracleFingerprint: oracleFingerprint(card.oracleText || ''),
    parserVersion: ORACLE_PARSER_VERSION,
    status: fully ? 'fully_supported' : 'review_required',
    confidence: result.confidence || 'none',
    matchedTemplates: result.matchedTemplates || [],
    behaviorFingerprint: result.behaviorFingerprint || null,
    script: fully ? result.script : null,
    diagnostics: result.diagnostics || [],
    compiledAt: new Date(),
    source: 'Oracle → Ability IR compiler'
  };
}

async function main() {
  const db = await mongoDb();
  await ensureCardIndexes(db);
  const cards = db.collection('cards');
  const behaviors = db.collection('card_behaviors');
  const metadata = db.collection('metadata');
  await Promise.all([
    behaviors.createIndex({ oracleId: 1 }, { unique: true }),
    behaviors.createIndex({ status: 1 }),
    behaviors.createIndex({ parserVersion: 1, status: 1 }),
    behaviors.createIndex({ name: 1 })
  ]);

  const total = await cards.countDocuments({ oracleId: { $exists: true } });
  if (CHECK_ONLY) {
    const compiled = await behaviors.countDocuments({ parserVersion: ORACLE_PARSER_VERSION });
    const stale = await behaviors.countDocuments({ parserVersion: { $ne: ORACLE_PARSER_VERSION } });
    const meta = await metadata.findOne({ _id: 'abilityCompiler' });
    if (!meta || compiled < total || stale) throw new Error(`Mongo ability cache is stale/incomplete (${compiled}/${total}, stale=${stale}). Run npm run compile:mongo-abilities.`);
    console.log(`Mongo ability cache valid: ${compiled}/${total} cards on parser ${ORACLE_PARSER_VERSION}.`);
    return;
  }

  let ops = [], seen = 0, supported = 0, review = 0;
  const cursor = cards.find({ oracleId: { $exists: true } }, { projection: { _id: 0 } });
  for await (const card of cursor) {
    const result = compiler.compileCard(card);
    const doc = behaviorDoc(card, result);
    if (doc.status === 'fully_supported') supported++; else review++;
    ops.push({ replaceOne: { filter: { oracleId: card.oracleId }, replacement: doc, upsert: true } });
    seen++;
    if (ops.length >= BATCH) { await behaviors.bulkWrite(ops, { ordered: false }); ops = []; }
  }
  if (ops.length) await behaviors.bulkWrite(ops, { ordered: false });
  await behaviors.deleteMany({ parserVersion: { $ne: ORACLE_PARSER_VERSION } });
  await metadata.replaceOne({ _id: 'abilityCompiler' }, {
    _id: 'abilityCompiler', parserVersion: ORACLE_PARSER_VERSION, cardCount: seen,
    fullySupported: supported, reviewRequired: review,
    compiledAt: new Date().toISOString(),
    policy: compiler.capabilities().policy
  }, { upsert: true });
  console.log(`Compiled MongoDB abilities: ${seen} cards; ${supported} fully supported; ${review} review-required.`);
}

main().then(closeMongo).catch(async e => { console.error(e.stack || e); try { await closeMongo(); } catch {} process.exitCode = 1; });
