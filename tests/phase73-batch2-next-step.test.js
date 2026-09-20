import test from 'node:test';
import assert from 'node:assert/strict';
import { OracleTemplateCompiler } from '../src/cards/compiler/OracleTemplateCompiler.js';
import { commanderPairingProfile, validateCommanderPair } from '../src/engine/multiplayer/CommanderRules.js';

function compile(oracleText, typeLine='Legendary Creature — Human') {
  return new OracleTemplateCompiler().compileCard({ id:'p73', name:'Phase73 Fixture', oracleText, typeLine, manaCost:'{1}' });
}

test("Doctor's companion lowers to CommanderRules pairing metadata", () => {
  const out=compile("Doctor's companion (You can have two commanders if the other is the Doctor.)");
  assert.equal(out.status,'compiled');
  assert.equal(out.compiledCard.commanderPairing.kind,'doctors-companion');
  const companion={name:'Clara Oswald',typeLine:'Legendary Creature — Human Advisor',...out.compiledCard};
  const doctor={name:'The Doctor',typeLine:'Legendary Creature — Time Lord Doctor'};
  assert.equal(commanderPairingProfile(companion).doctorsCompanion,true);
  assert.equal(validateCommanderPair(companion,doctor).ok,true);
});

test('Aftermath lowers to executable graveyard sorcery casting option', () => {
  const out=compile('Aftermath (Cast this spell only from your graveyard. Then exile it.)','Sorcery');
  assert.equal(out.status,'compiled');
  const opt=out.compiledCard.castingOptions.find(x=>x.castOption==='aftermath');
  assert.deepEqual({fromZone:opt.fromZone,timing:opt.timing,exileOnLeaveStack:opt.exileOnLeaveStack},{fromZone:'graveyard',timing:'sorcery',exileOnLeaveStack:true});
});
