import { CardScriptCompiler } from '../scripts/CardScriptCompiler.js';
import { OracleAstCompiler } from './OracleAstCompiler.js';
import { OracleTemplateLibrary } from './OracleTemplateLibrary.js';
import { ORACLE_PARSER_VERSION, normalizeOracleText, oracleFingerprint, tokenizeOracleText } from './OracleTokenizer.js';

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function equivalentHighConfidenceMatches(matches = []) {
  if (!matches.length || matches.some(row => row.confidence !== 'high')) return null;
  const first = stable(matches[0].ast);
  return matches.every(row => stable(row.ast) === first) ? matches[0] : null;
}

function behaviorFingerprint(value) {
  const text = stable(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash.toString(16).padStart(8, '0');
}

export class OracleTemplateCompiler {
  constructor({ templateLibrary = new OracleTemplateLibrary(), astCompiler = new OracleAstCompiler(), scriptCompiler = new CardScriptCompiler() } = {}) {
    this.templateLibrary = templateLibrary;
    this.astCompiler = astCompiler;
    this.scriptCompiler = scriptCompiler;
  }

  _composeExactParagraphs(card, normalizedText) {
    const rawParagraphs = normalizedText.split('\n').map(value => value.trim()).filter(value => value && value !== '//');
    const paragraphs = [];
    for (let i = 0; i < rawParagraphs.length; i++) {
      if (/^(?:When this creature enters, )?choose (?:one|two|three|one or both|one or more)(?:\. If you control a commander as you cast this spell, you may choose both instead)? [—-]$/i.test(rawParagraphs[i])) {
        const grouped = [rawParagraphs[i]];
        while (i + 1 < rawParagraphs.length && /^•\s*/.test(rawParagraphs[i + 1])) grouped.push(rawParagraphs[++i]);
        paragraphs.push(grouped.join('\n'));
      } else paragraphs.push(rawParagraphs[i]);
    }
    if (paragraphs.length < 2) return null;

    const abilities = [];
    const castingOptions = [];
    const cardPatch = {};
    const matchedTemplates = [];
    for (const paragraph of paragraphs) {
      const matches = this.templateLibrary.match({ ...card, oracleText: paragraph });
      let match = matches.length === 1 && matches[0].confidence === 'high' ? matches[0] : equivalentHighConfidenceMatches(matches);
      if (!match && matches.length > 1) {
        const specific = matches.filter(row => !row.templateId.startsWith('phase69.'));
        const foundational = specific.filter(row => !/^phase\d+\./.test(row.templateId));
        if (foundational.length === 1 && foundational[0].confidence === 'high') match = foundational[0];
      }
      if (!match) return null;
      // A textless-card template is meaningful only for a whole card and must
      // never be used as a paragraph-level building block.
      if (match.templateId === 'card.vanilla-creature') return null;
      matchedTemplates.push(...(matches.length > 1 ? matches.map(row => row.templateId) : [match.templateId]));
      abilities.push(...structuredClone(match.ast?.abilities || []));
      const patch = structuredClone(match.ast?.cardPatch || {});
      if (Array.isArray(patch.castingOptions)) castingOptions.push(...patch.castingOptions);
      for (const [key, value] of Object.entries(patch)) if (key !== 'castingOptions') cardPatch[key] = value;
    }

    // CardScriptCompiler has one card-level target contract for ordinary spell
    // abilities. Composing two independently targeted spell paragraphs would
    // lose the mapping between each effect and its targets, so fail closed
    // until the IR grows per-effect spell target binding.
    const targetedSpellAbilities = abilities.filter(ability => ability?.type === 'spell' && ability.targets);
    if (targetedSpellAbilities.length > 1) return null;

    return {
      ast: { type: 'card', abilities, ...(castingOptions.length || Object.keys(cardPatch).length ? { cardPatch: { ...cardPatch, ...(castingOptions.length ? { castingOptions } : {}) } } : {}) },
      matchedTemplates,
      composedParagraphs: paragraphs.length
    };
  }

  analyzeCard(card = {}) {
    const normalizedText = normalizeOracleText(card.oracleText || '');
    const tokens = tokenizeOracleText(normalizedText);
    const matches = this.templateLibrary.match({ ...card, oracleText: normalizedText });
    if (matches.length === 0) {
      const composed = this._composeExactParagraphs(card, normalizedText);
      if (composed) {
        return {
          parserVersion: ORACLE_PARSER_VERSION, cardId: card.id || null, name: card.name || null,
          oracleFingerprint: oracleFingerprint(normalizedText), normalizedText, tokens, status: 'matched', confidence: 'high',
          matchedTemplates: composed.matchedTemplates, ast: composed.ast, composed: true, composedParagraphs: composed.composedParagraphs, diagnostics: []
        };
      }
      return { parserVersion: ORACLE_PARSER_VERSION, cardId: card.id || null, name: card.name || null, oracleFingerprint: oracleFingerprint(normalizedText), normalizedText, tokens, status: 'review_required', confidence: 'none', matchedTemplates: [], diagnostics: ['No exact high-confidence Oracle template or complete paragraph composition matched the rules text.'] };
    }
    if (matches.length > 1) {
      const equivalent = equivalentHighConfidenceMatches(matches);
      if (equivalent) return { parserVersion: ORACLE_PARSER_VERSION, cardId: card.id || null, name: card.name || null, oracleFingerprint: oracleFingerprint(normalizedText), normalizedText, tokens, status: 'matched', confidence: 'high', matchedTemplates: matches.map(row => row.templateId), ast: structuredClone(equivalent.ast), composed: false, diagnostics: ['Multiple exact templates matched with identical executable semantics; safely collapsed.'] };
      // Coverage phases may rediscover a family already represented by one
      // foundational exact template. Prefer that established implementation
      // for execution while keeping the library's complete match list intact
      // for coverage/regression tooling.
      const specific = matches.filter(row => !row.templateId.startsWith('phase69.'));
      const foundational = specific.filter(row => !/^phase\d+\./.test(row.templateId));
      if (foundational.length === 1) {
        const chosen = foundational[0];
        return { parserVersion: ORACLE_PARSER_VERSION, cardId: card.id || null, name: card.name || null, oracleFingerprint: oracleFingerprint(normalizedText), normalizedText, tokens, status: 'matched', confidence: 'high', matchedTemplates: [chosen.templateId], ast: structuredClone(chosen.ast), composed: false, diagnostics: ['A foundational exact template was preferred over later duplicate coverage templates.'] };
      }
      return { parserVersion: ORACLE_PARSER_VERSION, cardId: card.id || null, name: card.name || null, oracleFingerprint: oracleFingerprint(normalizedText), normalizedText, tokens, status: 'review_required', confidence: 'ambiguous', matchedTemplates: matches.map(row => row.templateId), diagnostics: ['Multiple exact templates matched; manual review is required before execution.'] };
    }
    return { parserVersion: ORACLE_PARSER_VERSION, cardId: card.id || null, name: card.name || null, oracleFingerprint: oracleFingerprint(normalizedText), normalizedText, tokens, status: 'matched', confidence: matches[0].confidence, matchedTemplates: [matches[0].templateId], ast: structuredClone(matches[0].ast), composed: false, diagnostics: [] };
  }

  compileCard(card = {}) {
    const analysis = this.analyzeCard(card);
    if (analysis.status !== 'matched' || analysis.confidence !== 'high') return { ...analysis, autoAccepted: false, script: null, compiledCard: null, behaviorFingerprint: null };
    try {
      const script = this.astCompiler.compile(analysis.ast, { parserVersion: ORACLE_PARSER_VERSION, templateIds: analysis.matchedTemplates, oracleFingerprint: analysis.oracleFingerprint });
      // Compile Oracle text in isolation from any legacy/manual behavior already
      // present on the card. This makes semantic diffs meaningful and prevents
      // generated effects from being accidentally duplicated during migration.
      const candidate = { ...structuredClone(card), abilities: [], spellEffects: [], modes: [], script };
      delete candidate.targets;
      delete candidate.cardScript;
      this.scriptCompiler.validator.assertValid(candidate);
      const compiledCard = this.scriptCompiler.compileCard(candidate);
      const semantic = { keywords: compiledCard.keywords || [], abilities: compiledCard.abilities || [], spellEffects: compiledCard.spellEffects || [], targets: compiledCard.targets || null, modes: compiledCard.modes || [] };
      return { ...analysis, status: 'compiled', autoAccepted: true, script, compiledCard, behaviorFingerprint: behaviorFingerprint(semantic), diagnostics: [] };
    } catch (error) {
      return { ...analysis, status: 'review_required', autoAccepted: false, script: null, compiledCard: null, behaviorFingerprint: null, diagnostics: [`Matched template failed script validation: ${error.message}`] };
    }
  }

  compileDatabase(db = {}) {
    return Object.values(db).map(card => {
      const result = this.compileCard(card);
      return {
        cardId: card.id,
        name: card.name,
        parserVersion: result.parserVersion,
        oracleFingerprint: result.oracleFingerprint,
        status: result.status,
        confidence: result.confidence,
        autoAccepted: result.autoAccepted,
        matchedTemplates: result.matchedTemplates,
        behaviorFingerprint: result.behaviorFingerprint,
        script: result.autoAccepted ? result.script : null,
        diagnostics: result.diagnostics
      };
    });
  }

  capabilities() {
    return { parserVersion: ORACLE_PARSER_VERSION, templates: this.templateLibrary.list(), policy: 'Only an exact, unique, high-confidence full-text template match or a complete composition of independently exact high-confidence Oracle paragraphs may auto-compile. Partial, ambiguous, or unknown text is review-required and never executable.' };
  }
}
