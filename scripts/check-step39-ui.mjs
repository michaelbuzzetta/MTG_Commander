#!/usr/bin/env node
import fs from 'node:fs';

const required = [
  'src/ui/RulesUiModel.js',
  'src/ui/index.js',
  'src/components/ChoiceDialog.jsx',
  'src/components/PaymentDialog.jsx',
  'src/components/RulesActionPicker.jsx',
  'src/components/StackPriorityPanel.jsx',
  'src/components/UnsupportedInteractionDialog.jsx',
  'tests/step39-rules-driven-ui.test.js',
  'step39-rules-driven-ui.md'
];
const missing = required.filter(file => !fs.existsSync(file));
if (missing.length) {
  console.error(`Missing Step 39 deliverables:\n${missing.map(file => ` - ${file}`).join('\n')}`);
  process.exit(1);
}
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
for (const script of ['test:step39', 'check:step39']) if (!pkg.scripts?.[script]) throw new Error(`package.json is missing ${script}`);
const app = fs.readFileSync('src/App.jsx', 'utf8');
const battlefield = fs.readFileSync('src/components/Battlefield.jsx', 'utf8');
const card = fs.readFileSync('src/components/Card.jsx', 'utf8');
const choice = fs.readFileSync('src/components/ChoiceDialog.jsx', 'utf8');
for (const marker of ['StackPriorityPanel', 'PaymentDialog', 'RulesActionPicker', 'UnsupportedInteractionDialog', 'buildLegalActionIndex(playerLegalActions)']) {
  if (!app.includes(marker)) throw new Error(`App is missing Step 39 integration marker: ${marker}`);
}
if (!battlefield.includes('actionState(p)')) throw new Error('Battlefield does not pass rules-driven action state to cards');
if (!card.includes('legal-action') || !card.includes('actionState?.tooltip')) throw new Error('Card legal highlighting/tooltips are missing');
if (!choice.includes('request.choiceType') || !choice.includes('orderingRequired')) throw new Error('Generic ChoiceRequest renderer is incomplete');
console.log('Step 39 rules-driven UI deliverables present.');
