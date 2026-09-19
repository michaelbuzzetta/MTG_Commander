#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import db from '../src/data/generated/cards.json' with { type: 'json' };
import decks from '../src/data/generated/decks.json' with { type: 'json' };
import { GameEngine } from '../src/engine/GameEngine.js';
import { FuzzBot } from '../src/engine/fuzz/index.js';

const args = new Map(process.argv.slice(2).map(arg => {
  const [key, value = 'true'] = arg.replace(/^--/, '').split('=');
  return [key, value];
}));
const seeds = Math.max(1, Number(args.get('seeds') || process.env.FUZZ_SEEDS || 8));
const actions = Math.max(1, Number(args.get('actions') || process.env.FUZZ_ACTIONS || 2000));
const baseSeed = args.get('seed') || process.env.FUZZ_BASE_SEED || 'step37-nightly';
const failureDirectory = path.resolve(args.get('out') || process.env.FUZZ_FAILURE_DIR || 'fuzz-artifacts/failures');
const playable = decks.filter(deck => deck.playable !== false);
if (playable.length < 2) throw new Error('Step 37 fuzz runner requires at least two playable decks.');

const summaries = [];
for (let i = 0; i < seeds; i++) {
  const seed = `${baseSeed}-${i}`;
  const deckA = playable[i % playable.length];
  let deckB = playable[(i * 3 + 1) % playable.length];
  if (deckA.id === deckB.id) deckB = playable[(i + 1) % playable.length];
  const engine = new GameEngine(deckA, deckB, db, { seed, startingPlayer: i % 2 ? 'random' : 'first', rulesVersion: 'step37-fuzz-v1', invariantChecks: true });
  const bot = new FuzzBot(engine, { seed, maxActions: actions, persistFailures: true, failureDirectory });
  try {
    const summary = bot.run();
    summaries.push({ ...summary, deckA: deckA.id, deckB: deckB.id });
    console.log(`[step37] PASS ${seed} ${deckA.id} vs ${deckB.id}: ${summary.actionsExecuted} actions, turn ${summary.turn}, ${summary.stopReason}`);
  } catch (error) {
    console.error(`[step37] FAIL ${seed}: ${error.code || error.name}: ${error.message}`);
    console.error(error.fuzz?.persisted?.reportPath || 'No failure artifact path available');
    process.exitCode = 1;
    break;
  }
}
fs.mkdirSync(path.dirname(path.resolve('fuzz-artifacts/step37-summary.json')), { recursive: true });
fs.writeFileSync('fuzz-artifacts/step37-summary.json', JSON.stringify({ generatedAt: new Date().toISOString(), seeds, actionsPerSeed: actions, summaries }, null, 2));
if (!process.exitCode) console.log(`[step37] Completed ${summaries.length} seeded fuzz runs.`);
