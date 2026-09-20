import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { OracleTemplateCompiler } from '../src/cards/compiler/OracleTemplateCompiler.js';

const batch=JSON.parse(fs.readFileSync(new URL('../coverage/phase69-batch1-promoted-cards.json',import.meta.url)));
const compiler=new OracleTemplateCompiler();

test('Phase 69 Batch 1 assigns exactly 1000 promoted cards',()=>{
  assert.equal(batch.batchAssignedCount,1000);
  assert.equal(batch.batchCards.length,1000);
  assert.ok(batch.promotedByPhase69>=1000);
});

test('all 1000 Batch 1 cards compile as exact executable Oracle behavior',()=>{
  const failures=[];
  for(const card of batch.batchCards){
    const r=compiler.compileCard(card);
    if(!r.autoAccepted) failures.push({name:card.name,status:r.status,diagnostics:r.diagnostics});
  }
  assert.deepEqual(failures,[]);
});
