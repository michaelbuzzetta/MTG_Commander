import { uid } from '../utils.js';
import { ENGINE_EVENT } from '../events/index.js';

function lower(value) { return String(value || '').toLowerCase(); }
function refId(ref) { return typeof ref === 'string' ? ref : (ref?.instanceId || ref?.gameObjectId || ref?.id || null); }
function relationMatches(engine, sourceController, targetController, relation) {
  if (!relation || relation === 'any') return true;
  if (engine.multiplayer?.matches) return engine.multiplayer.matches(relation, targetController, { actorPlayerId: sourceController });
  if (['you','self','controller'].includes(relation)) return sourceController === targetController;
  if (['opponent','an-opponent'].includes(relation)) return sourceController !== targetController;
  return relation === targetController;
}

function parseEnchantFilter(text = '') {
  const match = String(text).match(/(?:^|\n)Enchant\s+([^\n.]+)/i);
  if (!match) return null;
  const phrase = match[1].trim().toLowerCase();
  const controller = /\byou control\b/.test(phrase) ? 'you' : (/\ban opponent\b|\bopponent\b/.test(phrase) ? 'opponent' : 'any');
  if (/\bplayer\b|\bopponent\b/.test(phrase)) return { kind: 'player', controller };
  const zone = /\bin a graveyard\b/.test(phrase) ? 'graveyard' : 'battlefield';
  if (/\bcreature card\b/.test(phrase)) return { kind: zone === 'battlefield' ? 'permanent' : 'card', zone, type: 'Creature', controller };
  if (/\bcreature\b/.test(phrase)) return { kind: 'permanent', zone: 'battlefield', type: 'Creature', controller };
  if (/\bland\b/.test(phrase)) return { kind: 'permanent', zone: 'battlefield', type: 'Land', controller };
  if (/\bartifact\b/.test(phrase)) return { kind: 'permanent', zone: 'battlefield', type: 'Artifact', controller };
  if (/\benchantment\b/.test(phrase)) return { kind: 'permanent', zone: 'battlefield', type: 'Enchantment', controller };
  if (/\bpermanent\b/.test(phrase)) return { kind: 'permanent', zone: 'battlefield', controller };
  if (/\bcard in a graveyard\b/.test(phrase)) return { kind: 'card', zone: 'graveyard', controller };
  return { kind: 'permanent', zone: 'battlefield', controller };
}

function parseManaCost(text, keyword) {
  const pattern = new RegExp(`(?:^|\\n)${keyword}\\s+((?:\\{[^}]+\\})+)`, 'i');
  const match = String(text || '').match(pattern);
  return match?.[1] || null;
}

export class AttachmentService {
  constructor(engine) {
    this.engine = engine;
    this.ensureState();
    this.reconcileLegacyAttachments();
  }

  ensureState() {
    this.engine.state.attachments ||= [];
    this.engine.state.attachmentTimestampSequence = Number(this.engine.state.attachmentTimestampSequence || 0);
  }

  nextTimestamp() {
    this.ensureState();
    this.engine.state.attachmentTimestampSequence += 1;
    return this.engine.state.attachmentTimestampSequence;
  }

  object(ref) {
    if (!ref) return null;
    if (typeof ref === 'object' && (ref.instanceId || ref.id)) return ref;
    if (this.engine.state.players[ref]) return this.engine.state.players[ref];
    return this.engine._queryObject(refId(ref));
  }

  definition(attached) {
    return attached?.cardId ? (this.engine.copy?.definitionForObject(attached) || this.engine.db[attached.cardId] || {}) : {};
  }

  kind(attached) {
    if (!attached) return 'attachment';
    const definition = this.definition(attached);
    const text = String(definition.oracleText || '');
    if (this.engine.static?.hasSubtype(attached, 'Aura') || /\bEnchant\s+/i.test(text)) return 'aura';
    if (this.reconfigureCost(attached)) return 'reconfigure';
    if (this.engine.static?.hasSubtype(attached, 'Equipment')) return 'equipment';
    if (this.engine.static?.hasSubtype(attached, 'Fortification')) return 'fortification';
    return 'attachment';
  }

  equipCost(attached) {
    const d = this.definition(attached);
    return d.equipCost ?? d.equip?.cost ?? parseManaCost(d.oracleText, 'Equip');
  }

  fortifyCost(attached) {
    const d = this.definition(attached);
    return d.fortifyCost ?? d.fortify?.cost ?? parseManaCost(d.oracleText, 'Fortify');
  }

  reconfigureCost(attached) {
    const d = this.definition(attached);
    return d.reconfigureCost ?? d.reconfigure?.cost ?? parseManaCost(d.oracleText, 'Reconfigure');
  }

  legalHostFilter(attached, { actionKind = null } = {}) {
    const d = this.definition(attached);
    const explicit = d.attachment?.legalHostFilter || d.legalHostFilter || d.enchantFilter || null;
    if (explicit) return structuredClone(explicit);
    const kind = actionKind || this.kind(attached);
    if (kind === 'equipment' || kind === 'equip' || kind === 'reconfigure') return { kind: 'permanent', zone: 'battlefield', type: 'Creature' };
    if (kind === 'fortification' || kind === 'fortify') return { kind: 'permanent', zone: 'battlefield', type: 'Land' };
    if (kind === 'aura') return parseEnchantFilter(d.oracleText) || { kind: 'permanent', zone: 'battlefield' };
    return { kind: 'permanent', zone: 'battlefield' };
  }

  relationshipForAttached(ref) {
    const id = refId(ref);
    return (this.engine.state.attachments || []).find(item => item.attachedId === id || item.attachedGameObjectId === id) || null;
  }

  relationshipsForHost(ref) {
    const id = refId(ref);
    return (this.engine.state.attachments || []).filter(item => item.hostId === id || item.hostGameObjectId === id);
  }


  restrictionsForHost(ref) {
    const out = {};
    for (const relationship of this.relationshipsForHost(ref)) {
      const attached = this.object(relationship.attachedId);
      const restrictions = this.definition(attached)?.grantedRestrictions || {};
      for (const [key, value] of Object.entries(restrictions)) if (value) out[key] = value;
    }
    return out;
  }

  isAttached(ref) { return !!this.relationshipForAttached(ref); }

  isReconfigured(ref) {
    const relationship = this.relationshipForAttached(ref);
    return relationship?.attachmentType === 'reconfigure';
  }

  _hostCandidate(hostRef) {
    if (typeof hostRef === 'string' && this.engine.state.players[hostRef]) {
      return { kind: 'player', id: hostRef, player: this.engine.state.players[hostRef], controller: hostRef, owner: hostRef, zone: null, object: null };
    }
    const id = refId(hostRef);
    const found = id ? this.engine.zones.find(id) : null;
    const object = found?.card || (typeof hostRef === 'object' ? hostRef : null);
    if (!object) return null;
    return { kind: found?.zone === 'battlefield' ? 'permanent' : 'card', id: object.instanceId, object, controller: object.controller, owner: object.owner, zone: found?.zone || object.zone || null };
  }

  isLegalHost(attachedRef, hostRef, { filter = null, actionKind = null, targeted = false, actorPlayerId = null } = {}) {
    const attached = this.object(attachedRef);
    const host = this._hostCandidate(hostRef);
    if (!attached || !host) return false;
    if (host.object?.phasedOut) return false;
    if (host.object && attached.instanceId === host.object.instanceId) return false;
    const spec = filter || this.legalHostFilter(attached, { actionKind });
    if (spec.kind === 'player' && host.kind !== 'player') return false;
    if (spec.kind === 'permanent' && host.kind !== 'permanent') return false;
    if (spec.kind === 'card' && host.kind === 'player') return false;
    if (spec.zone && host.zone !== spec.zone) return false;
    if (spec.controller && !relationMatches(this.engine, attached.controller || attached.owner, host.controller, spec.controller)) return false;
    if (spec.owner && !relationMatches(this.engine, attached.controller || attached.owner, host.owner, spec.owner)) return false;
    if (host.object) {
      if (spec.type && !(host.zone === 'battlefield' ? this.engine.static.isType(host.object, spec.type) : this.engine.db[host.object.cardId] && String(this.engine.db[host.object.cardId].typeLine || '').toLowerCase().includes(lower(spec.type)))) return false;
      if (spec.subtype && !(host.zone === 'battlefield' ? this.engine.static.hasSubtype(host.object, spec.subtype) : (this.engine.db[host.object.cardId]?.subtypes || []).some(x => lower(x) === lower(spec.subtype)))) return false;
      if (spec.nonland && host.zone === 'battlefield' && this.engine.static.isType(host.object, 'Land')) return false;
      if (host.zone === 'battlefield' && this.engine.mechanics?.protectionDisallowsAttachment?.(host.object, attached)) return false;
      if (targeted) {
        const targetSpec = { kind: 'permanent', ...(spec.type ? { type: spec.type } : {}), ...(spec.subtype ? { subtype: spec.subtype } : {}), ...(spec.controller ? { controller: spec.controller } : {}) };
        if (!this.engine.targeting.isLegalTarget(actorPlayerId || attached.controller || attached.owner, host.object.instanceId, targetSpec, { sourceObject: attached })) return false;
      }
    }
    return true;
  }

  legalHosts(attachedRef, { filter = null, actionKind = null, targeted = false, actorPlayerId = null } = {}) {
    const attached = this.object(attachedRef);
    if (!attached) return [];
    const spec = filter || this.legalHostFilter(attached, { actionKind });
    const ids = [];
    if (spec.kind === 'player') {
      for (const playerId of this.engine.livingPlayerIds()) if (this.isLegalHost(attached, playerId, { filter: spec, actionKind, targeted, actorPlayerId })) ids.push(playerId);
      return ids;
    }
    for (const player of Object.values(this.engine.state.players)) {
      const zones = spec.zone ? [spec.zone] : ['battlefield'];
      for (const zone of zones) for (const card of player[zone] || []) {
        if (this.isLegalHost(attached, card, { filter: spec, actionKind, targeted, actorPlayerId })) ids.push(card.instanceId);
      }
    }
    return ids;
  }

  validateAttach(attachedRef, hostRef, options = {}) {
    const attached = this.object(attachedRef);
    if (!attached || attached.zone !== 'battlefield') throw new Error('Attachment must be on the battlefield');
    if (!this.isLegalHost(attached, hostRef, options)) throw new Error('Illegal attachment host');
    return true;
  }

  attach(attachedRef, hostRef, options = {}) {
    const attached = this.object(attachedRef);
    if (!attached) throw new Error('Attachment source no longer exists');
    return this.engine.events.dispatch(ENGINE_EVENT.ATTACH, {
      attachedId: attached.instanceId,
      hostId: refId(hostRef),
      reason: options.reason || 'attach',
      attachmentType: options.attachmentType || options.actionKind || this.kind(attached),
      legalHostFilter: structuredClone(options.filter || this.legalHostFilter(attached, { actionKind: options.actionKind }))
    }, { cause: options.reason || 'attach', stabilize: false });
  }

  _attachNow(attachedRef, hostRef, options = {}) {
    this.ensureState();
    const attached = this.object(attachedRef);
    const host = this._hostCandidate(hostRef);
    if (!attached || !host) throw new Error('Attachment relationship references a missing object');
    const existing = this.relationshipForAttached(attached);
    if (existing) this._detachNow(attached, { reason: 'reattach' });
    const relationship = {
      id: options.id || uid('attachment'),
      attachedId: attached.instanceId,
      attachedGameObjectId: attached.gameObjectId || null,
      hostId: host.id,
      hostGameObjectId: host.object?.gameObjectId || (host.kind === 'player' ? `player:${host.id}` : null),
      hostKind: host.kind,
      attachmentType: options.attachmentType || this.kind(attached),
      legalHostFilter: structuredClone(options.legalHostFilter || this.legalHostFilter(attached)),
      reason: options.reason || 'attach',
      timestamp: Number(options.timestamp || this.nextTimestamp()),
      controllerAtAttach: attached.controller || attached.owner || null
    };
    this.engine.state.attachments.push(relationship);
    attached.attachedTo = host.id;
    attached.attachmentRelationshipId = relationship.id;
    return structuredClone(relationship);
  }

  detach(attachedRef, options = {}) {
    const attached = this.object(attachedRef);
    const relationship = this.relationshipForAttached(attachedRef);
    if (!attached || !relationship) return false;
    return this.engine.events.dispatch(ENGINE_EVENT.DETACH, {
      attachedId: attached.instanceId,
      relationshipId: relationship.id,
      reason: options.reason || 'detach'
    }, { cause: options.reason || 'detach', stabilize: false });
  }

  _detachNow(attachedRef, options = {}) {
    this.ensureState();
    const attached = this.object(attachedRef);
    const id = refId(attachedRef);
    const relationship = this.relationshipForAttached(id);
    if (!relationship) {
      if (attached) { attached.attachedTo = null; delete attached.attachmentRelationshipId; }
      return false;
    }
    this.engine.state.attachments = this.engine.state.attachments.filter(item => item.id !== relationship.id);
    if (attached) { attached.attachedTo = null; delete attached.attachmentRelationshipId; }
    return structuredClone({ ...relationship, detachReason: options.reason || 'detach' });
  }

  relationshipLegal(relationship) {
    if (!relationship) return false;
    const attached = this.object(relationship.attachedId);
    if (!attached || attached.zone !== 'battlefield') return false;
    return this.isLegalHost(attached, relationship.hostId, { filter: relationship.legalHostFilter, actionKind: relationship.attachmentType, targeted: false });
  }

  onWillLeaveBattlefield(object) {
    if (!object || object.zone !== 'battlefield') return;
    const own = this.relationshipForAttached(object);
    if (own) this.detach(object, { reason: 'attachment-left-battlefield' });
    for (const relationship of [...this.relationshipsForHost(object)]) {
      const attached = this.object(relationship.attachedId);
      if (attached) this.detach(attached, { reason: 'host-left-battlefield' });
    }
  }

  reconcileLegacyAttachments() {
    this.ensureState();
    const known = new Set(this.engine.state.attachments.map(item => item.attachedId));
    for (const player of Object.values(this.engine.state.players || {})) {
      for (const permanent of player.battlefield || []) {
        if (!permanent.attachedTo || known.has(permanent.instanceId)) continue;
        const host = this._hostCandidate(permanent.attachedTo);
        if (!host) { permanent.attachedTo = null; continue; }
        const relationship = this._attachNow(permanent, host.id, { reason: 'legacy-hydration', attachmentType: this.kind(permanent) });
        known.add(relationship.attachedId);
      }
    }
  }

  syntheticAbilities(permanent) {
    if (!permanent || permanent.zone !== 'battlefield') return [];
    const out = [];
    const equip = this.equipCost(permanent);
    const fortify = this.fortifyCost(permanent);
    const reconfigure = this.reconfigureCost(permanent);
    if (equip != null) out.push({
      id: 'attachment:equipment:attach', type: 'activated', sorcerySpeed: true, cost: { mana: String(equip) },
      targets: { kind: 'permanent', type: 'Creature', controller: 'you', minTargets: 1, maxTargets: 1 },
      effect: { type: 'attach', attachmentType: 'equipment', reason: 'equip' }, attachmentAction: 'equip'
    });
    if (fortify != null) out.push({
      id: 'attachment:fortification:attach', type: 'activated', sorcerySpeed: true, cost: { mana: String(fortify) },
      targets: { kind: 'permanent', type: 'Land', controller: 'you', minTargets: 1, maxTargets: 1 },
      effect: { type: 'attach', attachmentType: 'fortification', reason: 'fortify' }, attachmentAction: 'fortify'
    });
    if (reconfigure != null) {
      out.push({
        id: 'attachment:reconfigure:attach', type: 'activated', sorcerySpeed: true, cost: { mana: String(reconfigure) },
        targets: { kind: 'permanent', type: 'Creature', controller: 'you', minTargets: 1, maxTargets: 1, notSelf: true },
        effect: { type: 'attach', attachmentType: 'reconfigure', reason: 'reconfigure' }, attachmentAction: 'reconfigure-attach'
      });
      if (this.isAttached(permanent)) out.push({
        id: 'attachment:reconfigure:detach', type: 'activated', sorcerySpeed: true, cost: { mana: String(reconfigure) },
        effect: { type: 'detach', reason: 'reconfigure' }, attachmentAction: 'reconfigure-detach'
      });
    }
    return out;
  }

  requestAuraEntryChoice(card, { toPlayerId = null, reason = 'aura-entry', resume = null } = {}) {
    if (!card || this.kind(card) !== 'aura') return null;
    const playerId = toPlayerId || card.controller || card.owner;
    const candidateIds = this.legalHosts(card, { actorPlayerId: playerId, targeted: false });
    if (!candidateIds.length) return { impossible: true, candidateIds: [] };
    this.engine.state.pendingChoice = {
      type: 'ATTACHMENT_ENTRY', playerId, sourceId: card.instanceId, candidateIds, destinationPlayerId: playerId,
      reason, prompt: `Choose what ${this.definition(card).name || 'this Aura'} will enchant`,
      resume: resume || (this.engine.state.phase === 'CLEANUP' ? 'CLEANUP' : 'PRIORITY')
    };
    this.engine.state.priorityPlayer = playerId;
    this.engine.state.passes = 0;
    return this.engine.state.pendingChoice;
  }

  resolveAuraEntryChoice(choice, hostId) {
    const card = this.object(choice.sourceId);
    if (!card) throw new Error('Aura entering the battlefield no longer exists');
    if (!choice.candidateIds.includes(hostId)) throw new Error('That object is not a legal Aura host');
    return this.attach(card, hostId, { reason: choice.reason || 'aura-entry', attachmentType: 'aura' });
  }

  getSnapshot() {
    this.ensureState();
    return structuredClone(this.engine.state.attachments);
  }

  uiMetadata() {
    return this.getSnapshot().map(relationship => {
      const attached = this.object(relationship.attachedId);
      const host = this._hostCandidate(relationship.hostId);
      return {
        relationshipId: relationship.id,
        attachedId: relationship.attachedId,
        attachedName: this.definition(attached).name || attached?.cardId || null,
        hostId: relationship.hostId,
        hostKind: relationship.hostKind,
        hostController: host?.controller || null,
        attachmentType: relationship.attachmentType,
        timestamp: relationship.timestamp,
        legal: this.relationshipLegal(relationship)
      };
    });
  }
}
