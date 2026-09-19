export const SUPPORT_STATUS = Object.freeze({
  FULL: 'fully_supported',
  PARTIAL: 'partially_supported',
  UNSUPPORTED: 'unsupported'
});

export const IMPLEMENTATION_PATH = Object.freeze({
  AUTO_TEMPLATE: 'auto-template-candidate',
  DECLARATIVE: 'declarative-scripted',
  COMPLEX: 'complex-scripted',
  CUSTOM_HOOK: 'custom-hook-required',
  NON_DIGITAL: 'non-digital-unsupported'
});

export const STEP17_RULES_VERSION = 'mtg-cr-2026-08-07';

export function normalizeOracleName(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function stableTextFingerprint(value = '') {
  // Small deterministic browser-safe FNV-1a fingerprint. It is an identity
  // discriminator, not a cryptographic integrity hash.
  let hash = 0x811c9dc5;
  for (const ch of String(value).replace(/\r\n/g, '\n').trim()) {
    hash ^= ch.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function baseOracleIdentity(card = {}, metadata = null) {
  const oracleId = card.oracleId || card.oracle_id || metadata?.oracleId || null;
  if (oracleId) return { key: `oracle:${oracleId}`, oracleId: String(oracleId), source: 'oracle-id' };
  const name = normalizeOracleName(card.name || metadata?.name || card.id || 'unknown');
  return { key: `local-name:${name}`, oracleId: null, source: 'local-name-fallback' };
}

export function printingMetadata(card = {}) {
  return {
    cardId: card.id || null,
    scryfallId: card.scryfallId || card.scryfall_id || null,
    set: card.set || null,
    setName: card.setName || null,
    collectorNumber: card.collectorNumber || null,
    image: card.image || null,
    artCrop: card.artCrop || null
  };
}
