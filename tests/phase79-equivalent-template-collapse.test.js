import test from 'node:test';
import assert from 'node:assert/strict';
import { OracleTemplateCompiler } from '../src/cards/compiler/OracleTemplateCompiler.js';

test('equivalent exact templates collapse to one executable semantic result', () => {
  const compiler = new OracleTemplateCompiler();
  const result = compiler.compileCard({id:'phase79-pump',name:'Phase 79 Pump',layout:'normal',typeLine:'Creature — Test',keywords:[],oracleText:'{1}{R}: This creature gets +1/+0 until end of turn.'});
  assert.equal(result.status, 'compiled');
  assert.equal(result.autoAccepted, true);
  assert.ok(result.matchedTemplates.includes('phase69.activated-pump'));
  assert.ok(result.matchedTemplates.includes('phase69.generic-activated-simple'));
});

test('non-equivalent multiple exact matches remain fail-closed', () => {
  const compiler = new OracleTemplateCompiler({templateLibrary:{
    match(){return [
      {templateId:'a',confidence:'high',ast:{type:'card',abilities:[]}},
      {templateId:'b',confidence:'high',ast:{type:'card',abilities:[{type:'spell',effect:{type:'draw',amount:1}}]}}
    ];}, list(){return []}
  }});
  const result = compiler.analyzeCard({id:'ambiguous',name:'Ambiguous',oracleText:'anything'});
  assert.equal(result.status, 'review_required');
  assert.equal(result.confidence, 'ambiguous');
});

test('mixed evergreen keywords plus mana Ward compile together', () => {
  const compiler = new OracleTemplateCompiler();
  const result = compiler.compileCard({id:'phase79-ward',name:'Phase 79 Ward',layout:'normal',typeLine:'Creature — Test',keywords:['Flying','Ward'],oracleText:'Flying, ward {2}'});
  assert.equal(result.status, 'compiled');
  assert.equal(result.compiledCard.wardCost, '{2}');
  assert.ok(result.compiledCard.keywords.includes('Flying'));
});
