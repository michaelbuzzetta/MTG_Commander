#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
const env={...process.env,FUZZ_SEEDS:process.env.PHASE41_SEEDS||'12',FUZZ_ACTIONS:process.env.PHASE41_ACTIONS||'250'};
const r=spawnSync(process.execPath,['scripts/run-step37-fuzz.mjs','--seed=phase41-property-fuzz'],{stdio:'inherit',env});
process.exitCode=r.status??1;
