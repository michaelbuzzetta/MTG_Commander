import { normalizeOracleText, oracleFingerprint } from './OracleTokenizer.js';

function byIdentity(cards = {}) {
  const out = new Map();
  for (const card of Object.values(cards || {})) {
    const key = card.oracleId ? `oracle:${card.oracleId}` : `local:${String(card.name || card.id).toLowerCase()}`;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(card);
  }
  return out;
}

export function diffOracleCardSets(previousCards = {}, currentCards = {}, { compiler = null } = {}) {
  const previous = byIdentity(previousCards);
  const current = byIdentity(currentCards);
  const identities = new Set([...previous.keys(), ...current.keys()]);
  const changes = [];
  for (const identity of [...identities].sort()) {
    const before = previous.get(identity) || [];
    const after = current.get(identity) || [];
    if (!before.length || !after.length) {
      changes.push({ identity, kind: before.length ? 'removed-oracle-card' : 'new-oracle-card', previousCardIds: before.map(c => c.id), currentCardIds: after.map(c => c.id) });
      continue;
    }
    const beforeText = normalizeOracleText(before[0].oracleText || '');
    const afterText = normalizeOracleText(after[0].oracleText || '');
    if (beforeText === afterText) continue;
    const row = {
      identity,
      kind: 'oracle-text-changed',
      previousFingerprint: oracleFingerprint(beforeText),
      currentFingerprint: oracleFingerprint(afterText),
      previousText: beforeText,
      currentText: afterText,
      previousCardIds: before.map(c => c.id),
      currentCardIds: after.map(c => c.id)
    };
    if (compiler) {
      const beforeResult = compiler.compileCard({ ...before[0], oracleText: beforeText });
      const afterResult = compiler.compileCard({ ...after[0], oracleText: afterText });
      row.previousBehaviorFingerprint = beforeResult.behaviorFingerprint || null;
      row.currentBehaviorFingerprint = afterResult.behaviorFingerprint || null;
      row.semanticBehaviorChanged = row.previousBehaviorFingerprint !== row.currentBehaviorFingerprint;
      row.requiresReview = !afterResult.autoAccepted || row.semanticBehaviorChanged;
    }
    changes.push(row);
  }
  return { schemaVersion: 1, changeCount: changes.length, changes };
}

export function diffCompilerSnapshots(previousSnapshot = {}, currentSnapshot = {}) {
  const before = previousSnapshot.cards || {};
  const after = currentSnapshot.cards || {};
  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes = [];
  for (const cardId of [...ids].sort()) {
    const oldRow = before[cardId] || null;
    const newRow = after[cardId] || null;
    if (!oldRow || !newRow) {
      changes.push({ cardId, kind: oldRow ? 'removed' : 'added', parserVersionChanged: false, oracleTextChanged: false, behaviorChanged: true });
      continue;
    }
    const parserVersionChanged = oldRow.parserVersion !== newRow.parserVersion;
    const oracleTextChanged = oldRow.oracleFingerprint !== newRow.oracleFingerprint;
    const behaviorChanged = oldRow.behaviorFingerprint !== newRow.behaviorFingerprint;
    if (!parserVersionChanged && !oracleTextChanged && !behaviorChanged) continue;
    changes.push({
      cardId,
      kind: behaviorChanged ? 'compiled-behavior-changed' : (oracleTextChanged ? 'oracle-text-changed-no-behavior-change' : 'parser-version-changed-no-behavior-change'),
      parserVersionChanged,
      oracleTextChanged,
      behaviorChanged,
      previousParserVersion: oldRow.parserVersion || null,
      currentParserVersion: newRow.parserVersion || null,
      previousOracleFingerprint: oldRow.oracleFingerprint || null,
      currentOracleFingerprint: newRow.oracleFingerprint || null,
      previousBehaviorFingerprint: oldRow.behaviorFingerprint || null,
      currentBehaviorFingerprint: newRow.behaviorFingerprint || null,
      requiresReview: oracleTextChanged || behaviorChanged
    });
  }
  return {
    schemaVersion: 1,
    changeCount: changes.length,
    behaviorChangeCount: changes.filter(row => row.behaviorChanged).length,
    parserVersionChangeCount: changes.filter(row => row.parserVersionChanged).length,
    changes
  };
}
