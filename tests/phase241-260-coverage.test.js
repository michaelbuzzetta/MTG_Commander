import test from 'node:test';
import assert from 'node:assert/strict';
import { OracleTemplateLibrary } from '../src/cards/compiler/OracleTemplateLibrary.js';
const lib=new OracleTemplateLibrary();
const cases=[
['Search your library for a Forest or Plains card, reveal it, put it into your hand, then shuffle.','phase241.'],
['Destroy target creature or enchantment. You lose 2 life.','phase242.'],
["When this creature enters, exile target card from an opponent's graveyard.",'phase243.'],
["{3}{U}: This creature can't be blocked this turn.",'phase244.'],
["Whenever this creature attacks and isn't blocked, it gets +2/+0 until end of combat.",'phase245.'],
['When this creature enters, you gain 3 life.','phase246.'],['Destroy target artifact.','phase247.'],['Destroy target enchantment.','phase248.'],
['Return target creature card from your graveyard to your hand.','phase249.'],['When this creature enters, untap up to seven lands.','phase250.'],
['{2}, {T}, Sacrifice this artifact: Draw three cards, then put two cards from your hand on top of your library in any order.','phase251.'],
['All Sliver creatures get +1/+1.','phase252.'],["Put target artifact or enchantment on top of its owner's library.",'phase253.'],
['When this creature enters, you gain X life, where X is the greatest power among Giants you control.','phase254.'],
['When this Equipment enters, create a 2/2 colorless Robot artifact creature token and attach this Equipment to it.','phase255.'],
["Enchanted land is a 5/6 green Treefolk creature that's still a land.",'phase256.'],["Whenever a creature dies, that creature's controller may draw a card.",'phase257.'],
['Exile all multicolored permanents.','phase258.'],['Target creature you control gains indestructible until end of turn.','phase259.'],['All lands gain shroud until end of turn.','phase260.']];
for(const [oracle,prefix] of cases)test(prefix+oracle.slice(0,25),()=>{const m=lib.match({oracleText:oracle});assert.ok(m.some(x=>x.templateId.startsWith(prefix)),JSON.stringify(m));});
