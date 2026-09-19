import { uid } from '../utils.js';
import { getObjectCardDefinition } from '../state/CardFace.js';
import { ensureCanonicalCardObject } from '../state/GameObject.js';
import { createStackObject } from '../stack/StackObject.js';
import { ENGINE_EVENT } from '../events/index.js';
import { LAYER } from '../continuous/index.js';
import {
  createCopiableValues,
  applyCopyModifications,
  definitionFromCopiableValues,
  copyLayerTransform
} from './CopiableValues.js';

function refId(ref) { return typeof ref === 'string' ? ref : (ref?.instanceId || ref?.gameObjectId || ref?.id || null); }

export class CopyService {
  constructor(engine) { this.engine = engine; }

  object(ref) {
    if (!ref) return null;
    if (typeof ref === 'object' && (ref.cardId || ref.type)) return ref;
    return this.engine._queryObject(refId(ref));
  }

  rawDefinitionForObject(object) {
    if (!object?.cardId) return {};
    return getObjectCardDefinition(this.engine.db[object.cardId] || {}, object, object.zone);
  }

  activeCopyState(object) {
    const state = object?.copyState;
    if (!state?.copiableValues) return null;
    if (state.duration === 'until-end-of-turn' && Number(state.createdTurn) !== Number(this.engine.state.turn)) return null;
    if (state.duration === 'while-source-present' && state.effectSourceInstanceId && !this.engine.findPermanent(state.effectSourceInstanceId)) return null;
    if (state.expiresAtTurn != null && Number(this.engine.state.turn) > Number(state.expiresAtTurn)) return null;
    return state;
  }

  getCopiableValues(ref) {
    const object = this.object(ref);
    if (!object) throw new Error('Copy source no longer exists');
    const active = this.activeCopyState(object);
    if (active) return structuredClone(active.copiableValues);
    if (object.copyMetadata?.copiableValues) return structuredClone(object.copyMetadata.copiableValues);
    return createCopiableValues(this.rawDefinitionForObject(object), object);
  }

  definitionForObject(ref) {
    const object = this.object(ref);
    if (!object?.cardId) return {};
    const active = this.activeCopyState(object);
    if (active) return definitionFromCopiableValues(active.copiableValues);
    if (object.copyMetadata?.copiableValues) return definitionFromCopiableValues(object.copyMetadata.copiableValues);
    return this.rawDefinitionForObject(object);
  }

  copyLayerEffectFor(ref) {
    const object = this.object(ref);
    const state = this.activeCopyState(object);
    if (!object || !state) return null;
    return {
      id: `copy-layer:${object.gameObjectId || object.instanceId}`,
      sourceId: null,
      layer: LAYER.COPY,
      sublayer: 0,
      timestamp: Number(state.timestamp || 0),
      dependsOn: [],
      duration: state.duration || 'indefinite',
      filter: { instanceId: object.instanceId },
      transform: copyLayerTransform(state.copiableValues),
      metadata: { copy: true, copiedFromGameObjectId: state.copiedFromGameObjectId || null }
    };
  }

  applyPermanentCopy(targetRef, sourceRef, options = {}) {
    const target = this.object(targetRef);
    const source = this.object(sourceRef);
    if (!target?.cardId) throw new Error('Copy target must be a card object');
    if (!source?.cardId) throw new Error('Copy source must be a card object');
    let values = this.getCopiableValues(source);
    if (options.except || options.modifications) values = applyCopyModifications(values, options.except || options.modifications);
    const timestamp = Number(options.timestamp || this.engine.continuous?.timestamps?.next?.() || 0);
    target.copyState = {
      schemaVersion: 1,
      kind: options.kind || 'permanent-copy',
      copiedFromInstanceId: source.instanceId || null,
      copiedFromGameObjectId: source.gameObjectId || null,
      copiedAtTurn: this.engine.state.turn,
      createdTurn: this.engine.state.turn,
      timestamp,
      duration: options.duration || 'indefinite',
      effectSourceInstanceId: options.effectSourceInstanceId || options.effectSourceId || null,
      expiresAtTurn: options.expiresAtTurn ?? null,
      copiableValues: values
    };
    this.engine.performance?.markTopology?.('copy:apply-permanent');
    return target;
  }

  clearPermanentCopy(targetRef) {
    const target = this.object(targetRef);
    if (!target?.copyState) return false;
    delete target.copyState;
    this.engine.performance?.markTopology?.('copy:clear-permanent');
    return true;
  }

  requestPermanentCopyChoice(targetRef, {
    playerId = null,
    candidateIds = null,
    filter = null,
    optional = true,
    except: modifications = null,
    duration = 'indefinite',
    effectSourceInstanceId = null,
    prompt = null,
    resume = null
  } = {}) {
    const target = this.object(targetRef);
    if (!target) throw new Error('Copy-choice source no longer exists');
    const controller = playerId || target.controller || target.owner;
    const ids = candidateIds || Object.values(this.engine.state.players)
      .flatMap(player => player.battlefield || [])
      .filter(candidate => !candidate.phasedOut && candidate.instanceId !== target.instanceId)
      .filter(candidate => {
        if (!filter) return true;
        if (filter.type && !this.engine.static.isType(candidate, filter.type)) return false;
        if (filter.subtype && !this.engine.static.hasSubtype(candidate, filter.subtype)) return false;
        if (filter.controller === 'you' && candidate.controller !== controller) return false;
        if (filter.controller === 'opponent' && candidate.controller === controller) return false;
        if (filter.nonToken && candidate.isToken) return false;
        if (filter.nonlegendary && this.engine.continuous.characteristics(candidate).supertypes.some(type => String(type).toLowerCase() === 'legendary')) return false;
        return true;
      })
      .map(candidate => candidate.instanceId);
    this.engine.state.pendingChoice = {
      type: 'COPY_PERMANENT',
      playerId: controller,
      sourceId: target.instanceId,
      sourceName: this.definitionForObject(target).name || 'copy permanent',
      candidateIds: [...ids],
      optional: !!optional,
      modifications: modifications ? structuredClone(modifications) : null,
      duration,
      effectSourceInstanceId,
      prompt: prompt || 'Choose a permanent to copy',
      resume: resume || (this.engine.state.phase === 'CLEANUP' ? 'CLEANUP' : 'PRIORITY')
    };
    this.engine.state.priorityPlayer = controller;
    this.engine.state.passes = 0;
    return this.engine.state.pendingChoice;
  }

  resolvePermanentCopyChoice(choice, selectedInstanceId = null) {
    const pendingCard = this.engine.state.pendingResolution?.item?.card;
    const target = this.object(choice?.sourceId) || (pendingCard?.instanceId === choice?.sourceId ? pendingCard : null);
    if (!target) throw new Error('Copying object no longer exists');
    target.copyAsEntersResolved = true;
    if (!selectedInstanceId) return target;
    if (!choice.candidateIds?.includes(selectedInstanceId)) throw new Error('Selected permanent is not a legal copy choice');
    return this.applyPermanentCopy(target, selectedInstanceId, {
      except: choice.modifications || null,
      duration: choice.duration || 'indefinite',
      effectSourceInstanceId: choice.effectSourceInstanceId || null,
      kind: 'clone-choice'
    });
  }

  createTokenCopy(playerId, sourceRef, {
    amount = 1,
    except: modifications = null,
    tapped = false,
    attacking = false,
    attackTarget = null,
    sacrificeAtEndTurn = false,
    exileAtEndCombat = false
  } = {}) {
    let values = this.getCopiableValues(sourceRef);
    if (modifications) values = applyCopyModifications(values, modifications);
    return this.engine.tokens.createFromCopiableValues(playerId, values, Math.max(0, Number(amount) || 0), {
      cause: 'create-token-copy',
      tokenCopyMetadata: {
        tapped: !!tapped,
        attacking: !!attacking,
        attackTarget,
        sacrificeAtEndTurn: !!sacrificeAtEndTurn,
        exileAtEndCombat: !!exileAtEndCombat
      }
    });
  }

  createStackCopies(originalItem, {
    count = 1,
    controller = originalItem?.controller,
    retargetAllowed = false
  } = {}) {
    if (!originalItem || !['spell','ability','trigger'].includes(originalItem.type)) throw new Error('Copy source must be a spell or ability on the stack');
    const copies = [];
    for (let index = 0; index < Math.max(0, Number(count) || 0); index++) {
      let copyCard = null;
      let copiedValues = null;
      if (originalItem.card) {
        copiedValues = originalItem.copyMetadata?.copiableValues
          ? structuredClone(originalItem.copyMetadata.copiableValues)
          : this.getCopiableValues(originalItem.card);
        copyCard = structuredClone(originalItem.card);
        copyCard.instanceId = uid('copycard');
        copyCard.zone = 'stack';
        copyCard.controller = controller;
        copyCard.isToken = false;
        copyCard.isCommander = false;
        delete copyCard.commanderIdentity;
        delete copyCard.commanderDesignationIndex;
        delete copyCard.commanderZoneChoicePending;
        copyCard.copyState = {
          schemaVersion: 1,
          kind: 'spell-copy',
          copiedFromInstanceId: originalItem.card.instanceId || null,
          copiedFromGameObjectId: originalItem.card.gameObjectId || null,
          copiedAtTurn: this.engine.state.turn,
          createdTurn: this.engine.state.turn,
          timestamp: Number(this.engine.continuous?.timestamps?.next?.() || 0),
          duration: 'while-on-stack-or-permanent-copy',
          copiableValues: structuredClone(copiedValues)
        };
        ensureCanonicalCardObject(copyCard, this.engine.db[copyCard.cardId] || {});
        copyCard.previousGameObjectId = originalItem.card.gameObjectId || null;
        copyCard.gameObjectId = uid('obj');
        copyCard.objectKind = 'spell';
      }
      const copyItem = createStackObject({
        ...structuredClone(originalItem),
        id: uid('copy-stack'),
        gameObjectId: undefined,
        controller,
        card: copyCard,
        source: originalItem.source ? structuredClone(originalItem.source) : (copyCard || null),
        isCopy: true,
        targets: [...(originalItem.targets || [])],
        copyMetadata: {
          ...(originalItem.copyMetadata || {}),
          isCopy: true,
          copiedFromStackObjectId: originalItem.id || originalItem.gameObjectId || null,
          retargetAllowed: !!retargetAllowed,
          copiableValues: copiedValues ? structuredClone(copiedValues) : null,
          originalController: originalItem.controller || null
        }
      });
      copies.push(copyItem);
    }
    return copies;
  }
}
