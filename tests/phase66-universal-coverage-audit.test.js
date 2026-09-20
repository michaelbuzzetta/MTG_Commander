import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
const p=new URL('../coverage/phase66-universal-coverage-audit.json',import.meta.url);
test('Step 66 audit accounts for every catalog entry',()=>{const r=JSON.parse(fs.readFileSync(p,'utf8')); const s=r.summary; assert.equal(s.fullyExecutable+s.partiallyRecognized+s.manualReview+s.compilerFailures+s.explicitNonDigitalExceptions,r.totalCatalogEntries);});
test('Step 66 release gate is mathematically tied to unresolved digital cards',()=>{const r=JSON.parse(fs.readFileSync(p,'utf8')); assert.equal(r.unresolvedDigital,r.summary.partiallyRecognized+r.summary.manualReview+r.summary.compilerFailures); assert.equal(r.releaseGate.passed,r.unresolvedDigital===0);});
test('Step 66 source is declared complete',()=>{const r=JSON.parse(fs.readFileSync(p,'utf8')); assert.equal(r.sourceDeclaredComplete,true); assert.equal(r.sourceDeclaredCount,r.totalCatalogEntries);});
