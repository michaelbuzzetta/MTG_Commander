import fs from 'node:fs';
const required = [
  'src/engine/multiplayer/CommanderRules.js',
  'src/engine/sba/StateBasedActionEngine.js',
  'src/engine/damage/DamageService.js',
  'tests/phase34-commander-edge-cases.test.js'
];
for (const file of required) if (!fs.existsSync(file)) throw new Error(`Phase 34 missing ${file}`);
const commander = fs.readFileSync('src/engine/multiplayer/CommanderRules.js', 'utf8');
const sba = fs.readFileSync('src/engine/sba/StateBasedActionEngine.js', 'utf8');
const damage = fs.readFileSync('src/engine/damage/DamageService.js', 'utf8');
for (const token of ['commanderTaxLedger', 'recordCast', 'recordCombatDamageByIdentity', 'validateCommanderPair']) {
  if (!commander.includes(token)) throw new Error(`Phase 34 commander rules missing ${token}`);
}
if (!sba.includes('commanderZoneChoicePending') || !sba.includes('COMMANDER_ZONE')) throw new Error('Phase 34 SBA commander-zone choice support missing');
if (!damage.includes('damage.combat && damage.commanderIdentity')) throw new Error('Phase 34 combat-only commander damage gate missing');
console.log('Phase 34 commander edge-case audit passed.');
