import test from 'node:test';
import assert from 'node:assert/strict';
import { OracleTemplateCompiler } from '../src/cards/compiler/OracleTemplateCompiler.js';

test('Phase 83 rebound compiles to executable card metadata', () => {
  const r = new OracleTemplateCompiler().compileCard({id:'rb',name:'Rebound Spell',typeLine:'Instant',manaCost:'{1}{U}',oracleText:'Rebound (If you cast this spell from your hand, exile it as it resolves. At the beginning of your next upkeep, you may cast this card from exile without paying its mana cost.)'});
  assert.equal(r.status, 'compiled');
  assert.equal(r.compiledCard.rebound, true);
  assert.ok(r.compiledCard.keywords.includes('rebound'));
});
