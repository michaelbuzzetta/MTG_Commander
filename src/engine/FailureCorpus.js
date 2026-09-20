import fs from 'node:fs';
import path from 'node:path';

function safe(value) {
  return String(value ?? 'unknown').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 120);
}

export class FailureCorpus {
  constructor(directory = path.resolve('fuzz-artifacts/failures')) {
    this.directory = directory;
  }

  persist({ seed, botSeed, error, engine, actionIndex, action, minimizedReplay = null, metadata = {} }) {
    fs.mkdirSync(this.directory, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = `${stamp}-${safe(seed)}-${safe(error?.code || error?.name || 'failure')}`;
    const replay = JSON.parse(engine.serializeReplay());
    const replayPath = path.join(this.directory, `${base}.replay.json`);
    const reportPath = path.join(this.directory, `${base}.failure.json`);
    fs.writeFileSync(replayPath, JSON.stringify(replay, null, 2));
    if (minimizedReplay) fs.writeFileSync(path.join(this.directory, `${base}.min.replay.json`), JSON.stringify(minimizedReplay, null, 2));
    const report = {
      schema: 'mtg-step37-fuzz-failure',
      schemaVersion: 1,
      seed,
      botSeed,
      actionIndex,
      action,
      error: {
        name: error?.name || 'Error',
        code: error?.code || null,
        message: error?.message || String(error),
        detail: error?.detail || null,
        stack: error?.stack || null
      },
      stateHash: engine.getReplayStateHash(),
      turn: engine.state.turn,
      phase: engine.state.phase,
      priorityPlayer: engine.state.priorityPlayer,
      replayPath,
      minimized: !!minimizedReplay,
      metadata
    };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    return { reportPath, replayPath, report };
  }
}
