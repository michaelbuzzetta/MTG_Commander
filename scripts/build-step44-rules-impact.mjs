import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CURRENT_RULES_VERSION, RULES_COMPATIBILITY_POLICY } from '../src/engine/rules-version/index.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p, fallback={}) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8')); } catch { return fallback; } };
const diff = read('src/data/updates/step43-oracle-diff-queue.json', { changes:[] });
const support = read('src/data/generated/card-support.json', { cards:[] });
const changedOracleIds = [...new Set((diff.changes||[]).map(x=>x.oracleId).filter(Boolean))].sort();
const impactedCards = (support.cards||[]).filter(x=>changedOracleIds.includes(x.oracleId)).map(x=>({ cardId:x.cardId, name:x.name, oracleId:x.oracleId, supportStatus:x.status, testFiles:x.testFiles||[] }));
const report = {
  schema:'mtg-commander-rules-change-impact', schemaVersion:1,
  generatedAt:new Date().toISOString(), rulesVersion:CURRENT_RULES_VERSION,
  pendingRulesUpgrade:false,
  sourceOracleDiffGeneratedAt:diff.generatedAt||null,
  changedOracleIdentityCount:changedOracleIds.length,
  changedOracleIds,
  impactedCards,
  impactedSubsystems:[],
  reviewRequired: changedOracleIds.length>0,
  policy:RULES_COMPATIBILITY_POLICY.guarantee
};
const out = path.join(ROOT,'src/data/generated/rules-change-impact-report.json');
fs.writeFileSync(out, JSON.stringify(report,null,2)+'\n');
console.log(`Step 44 rules impact report: ${changedOracleIds.length} changed Oracle identities, ${impactedCards.length} impacted support records.`);
