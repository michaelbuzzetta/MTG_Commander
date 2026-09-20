#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
const r=spawnSync(process.execPath,['scripts/run-step38-benchmarks.mjs'],{stdio:'inherit',env:{...process.env}});
process.exitCode=r.status??1;
