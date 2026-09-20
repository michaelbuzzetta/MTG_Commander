import test from 'node:test';
import assert from 'node:assert/strict';
import { OracleTemplateCompiler } from '../src/cards/compiler/OracleTemplateCompiler.js';
import { CostEngine } from '../src/engine/costs/CostEngine.js';

const compiler = new OracleTemplateCompiler();
const compile = (oracleText, typeLine='Creature') => compiler.compileCard({ id:'p50', name:'Phase 50 Test', typeLine, keywords:[], oracleText, manaCost:'{2}{G}' });

test('Step49: fixed-mana Kicker compiles as an additional-cost cast option', () => {
  const r=compile('Kicker {1}{G} (You may pay an additional {1}{G} as you cast this spell.)');
  assert.equal(r.autoAccepted,true);
  assert.equal(r.compiledCard.kickerCost,'{1}{G}');
  assert.equal(r.compiledCard.castingOptions[0].castOption,'kicked');
  assert.equal(r.compiledCard.castingOptions[0].additionalManaCost,'{1}{G}');
});

test('Step49: CostEngine adds Kicker to the normal mana cost rather than replacing it', () => {
  const engine={ db:{ c:{ manaCost:'{2}{G}', castingOptions:[{castOption:'kicked',fromZone:'hand',additionalManaCost:'{1}{G}'}] } }, commanders:null, state:{players:{p:{}}}, static:{targetingTax:()=>0,spellGenericCostReduction:()=>0}, mechanics:{affinityReduction:()=>0} };
  const ce=new CostEngine(engine);
  const locked=ce.determineSpellCost('p',{instanceId:'i',cardId:'c',zone:'hand'},{zone:'hand',castOption:'kicked'});
  assert.equal(locked.finalManaCost,'{3}{G}{G}');
});

test('Step50: fixed-mana Cycling compiles to a hand-zone activated ability with discard-self cost', () => {
  const r=compile('Cycling {2} ({2}, Discard this card: Draw a card.)');
  assert.equal(r.autoAccepted,true);
  assert.equal(r.compiledCard.cyclingCost,'{2}');
  const a=r.compiledCard.abilities[0];
  assert.equal(a.type,'activated');
  assert.deepEqual(a.sourceZones,['hand']);
  assert.equal(a.cost.mana,'{2}');
  assert.equal(a.cost.discardSelf,true);
});

test('Step50: discardSelf lowers into the authoritative discard non-mana cost primitive', () => {
  const engine={ static:{targetingTax:()=>0} };
  const ce=new CostEngine(engine);
  const locked=ce.determineAbilityCost('p',{instanceId:'card-1'},{cost:{mana:'{2}',discardSelf:true}});
  assert.deepEqual(locked.nonManaCosts,[{type:'discard',cardInstanceId:'card-1'}]);
});
