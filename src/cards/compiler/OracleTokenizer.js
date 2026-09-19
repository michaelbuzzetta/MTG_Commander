export const ORACLE_PARSER_VERSION = '1.3.0';

const NUMBER_WORDS = Object.freeze({
  zero: 0, a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20
});

export function oracleNumber(value) {
  if (value == null) return null;
  const raw = String(value).trim().toLowerCase();
  if (/^\d+$/.test(raw)) return Number(raw);
  return Object.prototype.hasOwnProperty.call(NUMBER_WORDS, raw) ? NUMBER_WORDS[raw] : null;
}

export function normalizeOracleText(value = '') {
  return String(value)
    .normalize('NFKC')
    .replace(/[’‘]/g, "'")
    .replace(/[–—]/g, '—')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

export function oracleFingerprint(value = '') {
  // Browser-safe deterministic FNV-1a hash. It is an identity/diff key, not a
  // cryptographic integrity primitive (release ZIPs use SHA-256 separately).
  const text = normalizeOracleText(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function tokenizeOracleText(value = '') {
  const text = normalizeOracleText(value);
  const tokens = [];
  const re = /(\{[^}]+\})|(\d+)|(\+\d+|-\d+)|(\/)|(—)|(•)|(\n)|([A-Za-z]+(?:'[A-Za-z]+)?)|([^\s])/g;
  let match;
  while ((match = re.exec(text))) {
    const raw = match[0];
    let type = 'punctuation';
    if (match[1]) type = 'mana';
    else if (match[2]) type = 'number';
    else if (match[3]) type = 'signedNumber';
    else if (match[4]) type = 'slash';
    else if (match[5]) type = 'dash';
    else if (match[6]) type = 'bullet';
    else if (match[7]) type = 'newline';
    else if (match[8]) type = 'word';
    tokens.push({ type, value: raw, start: match.index, end: match.index + raw.length });
  }
  return tokens;
}
