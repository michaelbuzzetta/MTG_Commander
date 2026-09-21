import { EVENT } from '../engine/constants.js';
import { MechanicRegistry } from './MechanicRegistry.js';
import { EVERGREEN_MECHANICS } from './packages/evergreen.js';
import { COMMANDER_MECHANICS } from './packages/commander.js';
import { CASTING_MECHANICS } from './packages/casting.js';
import { SPECIALTY_MECHANICS } from './packages/specialty.js';

const SUBSYSTEMS = Object.freeze([
  'events','damage','continuous','combat','targeting','attachments','sba','stack','costs','turn','priority',
  'multiplayer','triggers','tokens','zones','choices','counters','hidden-information','draw','discard','card-faces',
  'replacement','copy'
]);

function lower(value) { return String(value || '').trim().toLowerCase(); }
function definitionFor(engine, objectOrDefinition) {
  if (!objectOrDefinition) return {};
  if (objectOrDefinition.cardId) return engine.copy?.definitionForObject(objectOrDefinition) || engine.db[objectOrDefinition.cardId] || {};
  return objectOrDefinition;
}

function normalizedKeywords(engine, objectOrDefinition) {
  if (objectOrDefinition?.zone === 'battlefield' && engine.continuous) {
    return (engine.continuous.characteristics(objectOrDefinition)?.keywords || []).map(lower);
  }
  return (definitionFor(engine, objectOrDefinition).keywords || []).map(lower);
}

function sourceQualities(engine, sourceObject) {
  if (!sourceObject) return { colors: new Set(), typeLine: '' };
  const live = sourceObject.instanceId ? (engine.findPermanent(sourceObject.instanceId) || sourceObject) : sourceObject;
  const definition = definitionFor(engine, live);
  const chars = live?.zone === 'battlefield' && engine.continuous ? engine.continuous.characteristics(live) : null;
  return {
    colors: new Set((chars?.colors || definition.colors || definition.colorIdentity || []).map(color => lower(color === 'W' ? 'white' : color === 'U' ? 'blue' : color === 'B' ? 'black' : color === 'R' ? 'red' : color === 'G' ? 'green' : color))),
    typeLine: lower(chars ? [...(chars.supertypes || []), ...(chars.types || []), ...(chars.subtypes || [])].join(' ') : definition.typeLine || '')
  };
}

function qualityMatches(qualities, quality) {
  const q = lower(quality).replace(/s$/, '');
  return qualities.colors.has(q) || qualities.typeLine.includes(q);
}

function hasExplicitTrigger(definition, effectType) {
  return (definition.abilities || []).some(ability => ability?.type === 'triggered' && ability.effect?.type === effectType);
}

export class MechanicLibrary {
  constructor(engine) {
    this.engine = engine;
    this.registry = new MechanicRegistry()
      .registerMany(EVERGREEN_MECHANICS)
      .registerMany(COMMANDER_MECHANICS)
      .registerMany(CASTING_MECHANICS)
      .registerMany(SPECIALTY_MECHANICS);
    const missing = this.registry.validateDependencies(SUBSYSTEMS);
    if (missing.length) throw new Error(`Mechanic registry has missing subsystem dependencies: ${JSON.stringify(missing)}`);
  }

  snapshot() { return this.registry.snapshot(); }
  mechanicDefinitionsFor(objectOrDefinition) { return this.registry.recognize(definitionFor(this.engine, objectOrDefinition)); }
  mechanicNamesFor(objectOrDefinition) { return this.mechanicDefinitionsFor(objectOrDefinition).map(definition => definition.id); }

  has(objectOrDefinition, mechanicName) {
    const wanted = this.registry.resolve(mechanicName)?.id || lower(mechanicName);
    const keywords = normalizedKeywords(this.engine, objectOrDefinition);
    if (keywords.some(keyword => keyword === wanted || keyword.startsWith(`${wanted} `) || keyword.startsWith(`${wanted} from `))) return true;
    return this.mechanicDefinitionsFor(objectOrDefinition).some(definition => definition.id === wanted);
  }

  canIgnoreSummoningSickness(permanent) { return this.has(permanent, 'haste'); }
  tapsWhenAttacking(permanent) { return !this.has(permanent, 'vigilance'); }
  hasLifelink(source) { return this.has(source, 'lifelink'); }
  hasDeathtouch(source) { return this.has(source, 'deathtouch'); }
  hasInfect(source) { return this.has(source, 'infect'); }
  hasWither(source) { return this.has(source, 'wither'); }
  hasTrample(source) { return this.has(source, 'trample'); }
  isIndestructible(permanent) { return this.has(permanent, 'indestructible'); }
  canCastAtInstantTiming(cardOrDefinition) { return this.has(cardOrDefinition, 'flash'); }

  participatesInCombatDamageStep(permanent, firstStrike) {
    const first = this.has(permanent, 'first strike');
    const double = this.has(permanent, 'double strike');
    return firstStrike ? first || double : !first || double;
  }

  needsFirstStrikeStep(permanent) { return this.has(permanent, 'first strike') || this.has(permanent, 'double strike'); }
  lethalDamageForBlocker(attacker, blocker) {
    if (this.hasDeathtouch(attacker)) return 1;
    const stats = this.engine.static.derivedStats(blocker);
    return Math.max(0, Number(stats.toughness || 0) - Number(blocker.damageMarked || 0));
  }
  requiredBlockerCount(attacker) { return this.has(attacker, 'menace') ? 2 : 1; }

  keywordBlockLegality(blocker, attacker) {
    const bk = normalizedKeywords(this.engine, blocker);
    const ak = normalizedKeywords(this.engine, attacker);
    if (ak.includes('unblockable') || ak.includes("can't be blocked")) return { ok: false, reason: 'unblockable' };
    if (this.has(attacker, 'flying') && !this.has(blocker, 'flying') && !this.has(blocker, 'reach')) return { ok: false, reason: 'flying' };
    if (ak.includes('shadow') !== bk.includes('shadow')) return { ok: false, reason: 'shadow' };
    if (ak.includes('horsemanship') && !bk.includes('horsemanship')) return { ok: false, reason: 'horsemanship' };
    if (ak.includes('fear')) {
      const chars = this.engine.continuous.characteristics(blocker);
      const black = chars.colors.includes('B');
      const artifact = chars.types.some(type => lower(type) === 'artifact');
      if (!black && !artifact) return { ok: false, reason: 'fear' };
    }
    if (ak.includes('intimidate')) {
      const ac = this.engine.continuous.characteristics(attacker), bc = this.engine.continuous.characteristics(blocker);
      const artifact = bc.types.some(type => lower(type) === 'artifact');
      const sharesColor = ac.colors.some(color => bc.colors.includes(color));
      if (!artifact && !sharesColor) return { ok: false, reason: 'intimidate' };
    }
    for (const keyword of ak) {
      if (!keyword.startsWith('protection from ')) continue;
      const quality = keyword.slice('protection from '.length);
      if (quality === 'everything' || qualityMatches(sourceQualities(this.engine, blocker), quality)) return { ok: false, reason: `protection from ${quality}` };
    }
    return { ok: true, reason: null };
  }

  validateTargeting(actorPlayerId, target, sourceObject) {
    const keywords = normalizedKeywords(this.engine, target);
    if (keywords.includes('shroud')) throw new Error('Target has shroud');
    if (target.controller !== actorPlayerId && keywords.includes('hexproof')) throw new Error('Target has hexproof');
    const qualities = sourceQualities(this.engine, sourceObject);
    for (const keyword of keywords) {
      if (target.controller !== actorPlayerId && keyword.startsWith('hexproof from ')) {
        const quality = keyword.slice('hexproof from '.length);
        if (qualityMatches(qualities, quality)) throw new Error(`Target has hexproof from ${quality}`);
      }
      if (keyword.startsWith('protection from ')) {
        const quality = keyword.slice('protection from '.length);
        if (quality === 'everything' || qualityMatches(qualities, quality)) throw new Error(`Target has protection from ${quality}`);
      }
    }
    return true;
  }

  protectionPreventsDamage(target, sourceObject) {
    if (!target || !sourceObject) return false;
    const qualities = sourceQualities(this.engine, sourceObject);
    for (const keyword of normalizedKeywords(this.engine, target)) {
      if (!keyword.startsWith('protection from ')) continue;
      const quality = keyword.slice('protection from '.length);
      if (quality === 'everything' || qualityMatches(qualities, quality)) return true;
    }
    return false;
  }

  // Step 23: protection prevents Auras/Equipment/Fortifications from remaining
  // attached even though shroud/hexproof only govern targeting. Keep this
  // separate from validateTargeting() so ongoing attachment legality does not
  // incorrectly treat shroud or hexproof as a reason to detach.
  protectionDisallowsAttachment(target, sourceObject) {
    if (!target || !sourceObject) return false;
    const qualities = sourceQualities(this.engine, sourceObject);
    for (const keyword of normalizedKeywords(this.engine, target)) {
      if (!keyword.startsWith('protection from ')) continue;
      const quality = keyword.slice('protection from '.length);
      if (quality === 'everything' || qualityMatches(qualities, quality)) return true;
    }
    return false;
  }

  wardCost(permanent) {
    if (!permanent || permanent.zone !== 'battlefield') return null;
    const definition = definitionFor(this.engine, permanent);
    for (const source of this.engine.state.players[permanent.controller]?.battlefield || []) {
      if (source.instanceId === permanent.instanceId || source.phasedOut) continue;
      const sourceDef = definitionFor(this.engine, source);
      if (sourceDef.otherCreaturesWardLife && this.engine.static.isType(permanent, 'Creature')) return { mana: '', life: Number(sourceDef.otherCreaturesWardLife) };
    }
    if (permanent.faceDown && definition.faceDownCasting?.castOption === 'disguise') return this.normalizeWardCost('{2}');
    const candidates = [definition.wardCost, definition.ward];
    for (const ability of definition.abilities || []) if (lower(ability.type) === 'ward') candidates.push(ability.cost ?? ability.manaCost ?? ability.wardCost);
    for (const keyword of normalizedKeywords(this.engine, permanent)) {
      const match = keyword.match(/^ward(?:\s*[—:-]?\s*(.+))?$/i);
      if (match) candidates.push(match[1]);
    }
    for (const candidate of candidates) {
      const normalized = this.normalizeWardCost(candidate);
      if (normalized) return normalized;
    }
    return null;
  }

  normalizeWardCost(value) {
    if (value == null || value === '' || value === false) return null;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return { mana: `{${value}}`, life: 0 };
    if (typeof value === 'object') {
      const mana = value.mana || value.manaCost || '';
      const life = Number(value.life || 0);
      return (mana || life) ? { mana, life } : null;
    }
    const text = String(value).trim();
    const lifeMatch = text.match(/(?:pay\s+)?(\d+)\s+life/i);
    const mana = [...text.matchAll(/\{[^}]+\}/g)].map(match => match[0]).join('');
    const life = lifeMatch ? Number(lifeMatch[1]) : 0;
    return (mana || life) ? { mana, life } : null;
  }

  devotion(playerId, colors) {
    const wanted = new Set((Array.isArray(colors) ? colors : [colors]).map(String));
    let total = 0;
    for (const permanent of this.engine.state.players[playerId]?.battlefield || []) {
      if (permanent.phasedOut) continue;
      const definition = definitionFor(this.engine, permanent);
      for (const match of String(definition.manaCost || '').matchAll(/\{([^}]+)\}/g)) {
        if (match[1].split('/').some(part => wanted.has(part))) total += 1;
      }
    }
    return total;
  }

  domain(playerId) {
    const basicTypes = ['Plains','Island','Swamp','Mountain','Forest'];
    return basicTypes.filter(type => (this.engine.state.players[playerId]?.battlefield || []).some(permanent => !permanent.phasedOut && this.engine.static.isType(permanent, 'Land') && this.engine.static.hasSubtype(permanent, type))).length;
  }

  affinityReduction(playerId, cardOrDefinition) {
    const definition = definitionFor(this.engine, cardOrDefinition);
    const text = String(definition.oracleText || '');
    const match = text.match(/Affinity for ([^\n(]+)/i);
    if (!match) return 0;
    const quality = lower(match[1]);
    return (this.engine.state.players[playerId]?.battlefield || []).filter(permanent => {
      if (permanent.phasedOut) return false;
      if (quality.includes('artifact')) return this.engine.static.isType(permanent, 'Artifact');
      if (quality.includes('basic land')) return this.engine.static.isType(permanent, 'Land') && ['Plains','Island','Swamp','Mountain','Forest'].some(type => this.engine.static.hasSubtype(permanent, type));
      return false;
    }).length;
  }

  costPaymentContributions(playerId, cardOrDefinition) {
    const definition = definitionFor(this.engine, cardOrDefinition);
    const result = { convoke: [], improvise: [], delve: [] };
    if (this.has(definition, 'convoke')) {
      result.convoke = (this.engine.state.players[playerId]?.battlefield || []).filter(permanent => this.engine.static.isType(permanent, 'Creature') && !permanent.tapped && !permanent.phasedOut).map(permanent => ({ permanentId: permanent.instanceId, colors: [...(this.engine.continuous.characteristics(permanent)?.colors || [])] }));
    }
    if (this.has(definition, 'improvise')) {
      result.improvise = (this.engine.state.players[playerId]?.battlefield || []).filter(permanent => this.engine.static.isType(permanent, 'Artifact') && !permanent.tapped && !permanent.phasedOut).map(permanent => permanent.instanceId);
    }
    if (this.has(definition, 'delve')) result.delve = (this.engine.state.players[playerId]?.graveyard || []).map(card => card.instanceId);
    return result;
  }

  triggerDefinitionsFor(source) {
    if (!source?.cardId) return [];
    const definition = definitionFor(this.engine, source);
    const out = [];
    if (this.has(definition, 'prowess') && !hasExplicitTrigger(definition, 'mechanicProwess')) {
      out.push({
        definitionId: `mechanic:prowess:${source.cardId}`,
        eventPattern: [EVENT.SPELL_CAST], sourceZones: ['battlefield'], sourceCardId: source.cardId,
        controllerRelation: 'event-controller', condition: { cardTypeNot: 'Creature' },
        effect: { type: 'mechanicProwess' }, metadata: { mechanic: 'prowess' }
      });
    }
    if (this.has(definition, 'exalted') && !hasExplicitTrigger(definition, 'mechanicExalted')) {
      out.push({
        definitionId: `mechanic:exalted:${source.cardId}`,
        eventPattern: [EVENT.DECLARE_ATTACKERS], sourceZones: ['battlefield'], sourceCardId: source.cardId,
        controllerRelation: 'event-controller', condition: { exactlyOneAttacker: true },
        effect: { type: 'mechanicExalted' }, metadata: { mechanic: 'exalted' }
      });
    }
    if (this.has(definition, 'myriad') && !hasExplicitTrigger(definition, 'myriad')) {
      out.push({
        definitionId: `mechanic:myriad:${source.cardId}`,
        eventPattern: [EVENT.CREATURE_ATTACKED], sourceZones: ['battlefield'], sourceCardId: source.cardId,
        condition: { sourceEvent: true }, effect: { type: 'myriad' }, metadata: { mechanic: 'myriad' }
      });
    }
    return out;
  }
}

export const MECHANIC_SUBSYSTEMS = SUBSYSTEMS;
