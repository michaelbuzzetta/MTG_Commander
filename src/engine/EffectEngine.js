import { makeCardInstance } from './GameState.js';
import { ENGINE_EVENT } from './events/index.js';
import { ZoneManager } from './ZoneManager.js';
import { EVENT } from './constants.js';
import { isType, shuffle, hasSubtype } from './utils.js';
import { createStackObject, ensureCanonicalCardObject } from './state/GameObject.js';

export class EffectEngine {
  constructor(engine) { this.engine = engine; }

  _permanentTargets(ctx = {}) {
    return (ctx.targets || []).map(id => this.engine.findPermanent(id)).filter(Boolean);
  }

  _targetId(ctx = {}, index = 0) { return (ctx.targets || [])[Number(index || 0)] || null; }

  _permanentTarget(ctx = {}, index = 0) {
    const id = this._targetId(ctx, index);
    return id ? this.engine.findPermanent(id) : null;
  }

  _amount(effect = {}, ctx = {}, fallback = 1) {
    const e = this.engine;
    if (typeof effect.amount === 'number') return effect.amount;
    if (effect.amountFromEvent) return Number(ctx.eventPayload?.[effect.amountFromEvent] || 0);
    if (effect.amountFromSourcePower) {
      const source = ctx.source?.instanceId ? e.findPermanent(ctx.source.instanceId) : null;
      return source ? e.static.derivedStats(source).power : Number(ctx.sourcePowerAtActivation || 0);
    }
    if (effect.amountFromTargetManaValue) {
      const target = this._permanentTargets(ctx)[0];
      return Number(e.db[target?.cardId]?.manaValue || 0);
    }
    if (effect.amountFromCreatures) return e.state.players[ctx.controller]?.battlefield.filter(card => e.static.isType(card, 'Creature')).length || 0;
    if (effect.amountFromCreaturesWithCounter) return e.state.players[ctx.controller]?.battlefield.filter(card => e.static.isType(card, 'Creature') && Number(card.counters?.[effect.amountFromCreaturesWithCounter] || 0) > 0).length || 0;
    if (effect.amount && typeof effect.amount === 'object' && e.cardScripts?.runtime) {
      const resolved = e.cardScripts.runtime.resolveValue(effect.amount, ctx);
      return Number(resolved ?? fallback);
    }
    return Number(effect.amount ?? fallback);
  }

  _eventObject(ctx = {}) {
    return ctx.eventPayload?.object || ctx.eventPayload?.target || ctx.eventPayload?.card || ctx.eventPayload?.source || null;
  }

  _openCardChoice(pid, candidateIds, { min = 0, max = 1, prompt = 'Choose cards', continuation = null } = {}) {
    const e = this.engine;
    if (!candidateIds.length && min === 0) {
      if (continuation) this.resolveEffectCardChoice({ playerId: pid, continuation, resume: this._choiceResume() }, []);
      return;
    }
    e.state.pendingChoice = { type: 'EFFECT_CARD_CHOICE', playerId: pid, candidateIds: [...candidateIds], min, max, prompt, continuation, resume: this._choiceResume() };
    e.state.priorityPlayer = pid;
  }

  _effectPlayer(effect = {}, ctx = {}) {
    const s = this.engine.state;
    if (effect.player && typeof effect.player === 'object' && this.engine.cardScripts?.runtime) {
      const resolved = this.engine.cardScripts.runtime.resolveValue(effect.player, ctx);
      if (resolved && s.players[resolved]) return resolved;
    }
    if (typeof effect.player === 'string' && s.players[effect.player]) return effect.player;
    if (effect.player === 'target') {
      const id = (ctx.targets || []).find(value => !!s.players[value]);
      if (id) return id;
    }
    return ctx.controller || s.activePlayer;
  }

  resolve(effect, ctx = {}) {
    if (!effect) return;
    const e = this.engine, s = e.state, pid = this._effectPlayer(effect, ctx), p = s.players[pid];
    switch (effect.type) {
      case 'sequence':
        for (const child of effect.effects || []) { this.resolve(child, ctx); if (s.pendingChoice) break; }
        break;
      case 'scriptIf':
      case 'scriptForEach':
      case 'scriptRepeat':
      case 'customHook':
        e.cardScripts.runtime.executeControl(effect, ctx);
        break;
      case 'scriptDiscard':
        e.cardScripts.runtime.discard(effect, ctx);
        break;
      case 'scriptMill':
        e.cardScripts.runtime.mill(effect, ctx);
        break;
      case 'scriptTap':
        e.cardScripts.runtime.tap(effect, ctx);
        break;
      case 'scriptMoveZone':
        e.cardScripts.runtime.moveZone(effect, ctx);
        break;
      case 'moveEventObject': {
        const object = this._eventObject(ctx);
        const ref = object?.instanceId || object?.gameObjectId || ctx.eventPayload?.target?.instanceId || null;
        const found = ref ? ZoneManager.find(s, ref) : null;
        if (!found?.card) break;
        const destinationPlayer = effect.toPlayer === 'controller' ? pid : effect.toPlayer === 'owner' ? found.card.owner : (effect.toPlayer || found.card.owner);
        e._moveZoneNow(found.card, effect.toZone, destinationPlayer, { reason: 'oracle-event-zone-move' });
        break;
      }
      case 'blink': {
        const targets = this._permanentTargets(ctx);
        for (const target of targets) {
          const owner = target.owner;
          const exiled = e._moveZoneNow(target, 'exile', owner, { reason: 'blink-exile' });
          if (exiled) e._moveZoneNow(exiled, 'battlefield', effect.returnTo === 'controller' ? pid : owner, { reason: 'blink-return' });
        }
        break;
      }
      case 'exileUntilSourceLeaves': {
        const source = ctx.source?.instanceId ? e.findPermanent(ctx.source.instanceId) : null;
        if (!source) break;
        const targets = this._permanentTargets(ctx);
        source.linkedExile = source.linkedExile || [];
        for (const target of targets) {
          const exiled = e._moveZoneNow(target, 'exile', target.owner, { reason: 'linked-exile' });
          if (exiled) source.linkedExile.push({ instanceId: exiled.instanceId, owner: exiled.owner });
        }
        break;
      }
      case 'scriptRemoveCounter':
        e.cardScripts.runtime.removeCounter(effect, ctx);
        break;
      case 'scriptReveal':
        e.cardScripts.runtime.reveal(effect, ctx);
        break;
      case 'scriptShuffle':
        e.cardScripts.runtime.shuffle(effect, ctx);
        break;
      case 'scriptSearch':
        e.cardScripts.runtime.search(effect, ctx);
        break;
      case 'scriptCopy':
        e.cardScripts.runtime.copy(effect, ctx);
        break;
      case 'scriptGrantAbility':
        e.cardScripts.runtime.grantAbility(effect, ctx);
        break;
      case 'scriptRemoveAbility':
        e.cardScripts.runtime.removeAbility(effect, ctx);
        break;
      case 'learn': {
        // Constructed digital rules: outside-the-game Lessons are represented by
        // an optional lessonBoard. If none is available, the discard/draw branch
        // remains available and choice-aware.
        const lessons = (p.lessonBoard || []).filter(card => /(?:^|—|\s)Lesson(?:$|\s)/i.test(card.typeLine || ''));
        if (lessons.length) {
          this._openCardChoice(pid, [...lessons.map(c => c.instanceId), ...p.hand.map(c => c.instanceId)], { min: 0, max: 1, prompt: 'Learn — choose a Lesson or a card to discard', continuation: { type: 'learnChoice', lessonIds: lessons.map(c => c.instanceId) } });
        } else if (p.hand.length) {
          this._openCardChoice(pid, p.hand.map(c => c.instanceId), { min: 0, max: 1, prompt: 'Learn — you may discard a card to draw a card', continuation: { type: 'discardChosenThenDraw', draw: 1 } });
        }
        break;
      }
      case 'draw':
        for (let i = 0; i < this._amount(effect, ctx, 1); i++) { e.draw(pid); if (s.pendingChoice) break; }
        break;
      case 'drawDiscard': {
        const draw = this._amount({ amount: effect.draw || 1 }, ctx, 1);
        for (let i = 0; i < draw; i++) { e.draw(pid); if (s.pendingChoice) break; }
        const count = Number(effect.discard || 1);
        if (count > 0 && p.hand.length) this._openCardChoice(pid, p.hand.map(c => c.instanceId), { min: Math.min(count,p.hand.length), max: Math.min(count,p.hand.length), prompt: 'Choose card(s) to discard', continuation: { type: 'discardChosen' } });
        break;
      }
      case 'gainLife': e.changeLife(pid, this._amount(effect, ctx, 1)); break;
      case 'becomeMonarch': e.monarch.become(effect.targetPlayer || pid, { source: ctx.source }); break;
      case 'gainLifeTarget': {
        for (const targetPid of ctx.targets || []) if (s.players[targetPid]) e.changeLife(targetPid, effect.amount || 1);
        break;
      }
      case 'preventDamage': {
        for (const id of ctx.targets || []) {
          const target = s.players[id] || e.findPermanent(id);
          if (target) e.prevention.addDamageShield(target, effect.amount || 1, { source: ctx.source ? { instanceId: ctx.source.instanceId, cardId: ctx.source.cardId } : null });
        }
        break;
      }
      case 'loseLife': e.changeLife(pid, -this._amount(effect, ctx, 1)); break;
      case 'fight': {
        const ids = (ctx.targets || []).filter(id => !!e.findPermanent(id));
        if (ids.length >= 2) {
          const a = e.findPermanent(ids[0]), b = e.findPermanent(ids[1]);
          if (a && b && e.static.isType(a, 'Creature') && e.static.isType(b, 'Creature')) {
            const ap = Math.max(0, Number(e.static.derivedStats(a).power || 0));
            const bp = Math.max(0, Number(e.static.derivedStats(b).power || 0));
            e.damage.resolveBatch([
              { targetId: b.instanceId, amount: ap, source: a, combat: false },
              { targetId: a.instanceId, amount: bp, source: b, combat: false }
            ], { cause: 'fight', combat: false, stabilize: true, emitType: 'FIGHT' });
          }
        }
        break;
      }
      case 'surveil': {
        const count = this._amount(effect, ctx, 1);
        if (count === 1) {
          const top = p.library[0];
          if (top) {
            s.pendingChoice = { type: 'SURVEIL', playerId: pid, cardInstanceId: top.instanceId, cardId: top.cardId, cardName: e.db[top.cardId]?.name || top.cardId, resume: this._choiceResume() };
            s.priorityPlayer = pid;
          }
        } else {
          throw new Error('Surveil counts greater than 1 require ordered multi-card choice support');
        }
        break;
      }
      case 'damage': {
        for (const id of ctx.targets || []) {
          if (s.players[id]) e.dealDamageToPlayer(id, this._amount(effect, ctx, 1), ctx.source);
          else {
            const permanent = e.findPermanent(id);
            if (permanent) e.dealDamageToPermanent(permanent, this._amount(effect, ctx, 1), ctx.source);
          }
        }
        break;
      }
      case 'damagePlayer': {
        const playerTargets = (ctx.targets || []).filter(id => !!s.players[id]);
        if (ctx.targeted) for (const targetPid of playerTargets) e.dealDamageToPlayer(targetPid, effect.amount || 1, ctx.source);
        else if (playerTargets.length) for (const targetPid of playerTargets) e.dealDamageToPlayer(targetPid, effect.amount || 1, ctx.source);
        else e.dealDamageToPlayer(effect.targetPlayer || e.opponent(pid), effect.amount || 1, ctx.source);
        break;
      }
      case 'addMana': e.mana.add(p, effect.mana || {}); break;
      case 'createToken': this.createToken(pid, effect.token, this._amount(effect, ctx, 1), { source: ctx.source || null }); break;
      case 'backup': {
        const source = ctx.source?.instanceId ? e.findPermanent(ctx.source.instanceId) : null;
        if (!source) break;
        const targetId = this._targetId(ctx) || source.instanceId;
        e.keywordRuntime.backup(source, targetId, effect.amount);
        break;
      }
      case 'exileReturnTransformedSelf': {
        const source = ctx.source?.instanceId ? e.findPermanent(ctx.source.instanceId) : null;
        if (source) e.events.dispatch('TRANSFORM', { permanentId: source.instanceId }, { cause:'saga-transform-chapter', stabilize:false });
        break;
      }
      case 'livingWeapon': {
        const source = ctx.source?.instanceId ? e.findPermanent(ctx.source.instanceId) : null;
        if (!source) break;
        const created = this.createToken(pid, { name:'Phyrexian Germ', typeLine:'Token Creature — Phyrexian Germ', subtypes:['Phyrexian','Germ'], colors:['B'], power:0, toughness:0, abilities:[] }, 1, { source });
        const germ = Array.isArray(created) ? created[0] : null;
        if (germ) e.attachments.attach(source, germ.instanceId, { reason:'living-weapon', attachmentType:'equipment', actionKind:'living-weapon' });
        break;
      }
      case 'equipmentTokenAttach': {
        const source = ctx.source?.instanceId ? e.findPermanent(ctx.source.instanceId) : null;
        if (!source) break;
        const created = this.createToken(pid, effect.token, 1, { source });
        const token = Array.isArray(created) ? created[0] : null;
        if (token) e.attachments.attach(source, token.instanceId, { reason:effect.reason || 'equipment-token-attach', attachmentType:'equipment', actionKind:effect.reason || 'equipment-token-attach' });
        break;
      }
      case 'transformSelf': {
        const source = e.findPermanent(ctx.source?.instanceId);
        if (source) e.events.dispatch(ENGINE_EVENT.TRANSFORM, { permanentId: source.instanceId }, { cause: 'transform-self', stabilize: false });
        break;
      }
      case 'attach': {
        const source = ctx.source?.instanceId ? e.findPermanent(ctx.source.instanceId) : null;
        const hostId = this._targetId(ctx);
        if (source && hostId) e.attachments.attach(source, hostId, {
          reason: effect.reason || effect.attachmentType || 'attach',
          attachmentType: effect.attachmentType || e.attachments.kind(source),
          actionKind: effect.attachmentType || null
        });
        break;
      }
      case 'detach': {
        const source = ctx.source?.instanceId ? e.findPermanent(ctx.source.instanceId) : null;
        if (source) e.attachments.detach(source, { reason: effect.reason || 'detach' });
        break;
      }
      case 'ertaiCounterOrDestroy': {
        const targetId = this._targetId(ctx);
        const found = targetId ? ZoneManager.find(s, targetId) : null;
        const fallbackIndex = !found ? s.stack.length - 1 : -1;
        const fallbackItem = fallbackIndex >= 0 ? s.stack[fallbackIndex] : null;
        if (!found && !fallbackItem) break;
        const beneficiary = found?.card?.controller || found?.card?.owner || fallbackItem?.controller;
        if (found?.zone === 'stack') {
          e._counterStackItem(found.stackItem?.id || found.stackItem?.gameObjectId || targetId, 'ertai');
        } else if (found?.zone === 'battlefield') {
          const targetDef = e.db[found.card.cardId] || {};
          if (isType(targetDef, 'Creature') || isType(targetDef, 'Planeswalker')) e.destroy(found.card);
        } else if (fallbackItem) {
          e._counterStackItem(fallbackItem.id || fallbackItem.gameObjectId, 'ertai');
        }
        if (beneficiary && s.players[beneficiary]) e.draw(beneficiary);
        break;
      }
      case 'createSpiritsPerPermanent': {
        const amount = p.battlefield.length;
        this.createTokenRaw(pid, { name: 'Spirit Token', typeLine: 'Token Creature — Spirit', subtypes: ['Spirit'], power: 1, toughness: 1, keywords: [], abilities: [] }, amount);
        break;
      }
      case 'stationCharge': {
        const source = e.findPermanent(ctx.source?.instanceId);
        const crew = e.findPermanent((ctx.selections || [])[0]);
        if (source && crew) this.addCounters(pid, source, 'charge', Math.max(0, e.static.derivedStats(crew).power));
        break;
      }
      case 'stanggTwin': {
        const source = e.findPermanent(ctx.source?.instanceId);
        if (!source) break;
        const [twin] = this.createTokenRaw(pid, {
          name: 'Stangg Twin', typeLine: 'Legendary Token Creature — Human Warrior', subtypes: ['Human','Warrior'],
          colors: ['R','G'], power: 3, toughness: 4, keywords: ['haste'], abilities: []
        }, 1);
        if (!twin) break;
        const attachments = p.battlefield.filter(card => card.attachedTo === source.instanceId);
        for (const attachment of attachments) {
          const attachmentDef = e.db[attachment.cardId] || {};
          for (const ability of attachmentDef.abilities || []) {
            if (ability.type !== 'static' || !ability.filter?.attachedToSource) continue;
            twin.modifiers.power += Number(ability.effect?.power || 0);
            twin.modifiers.toughness += Number(ability.effect?.toughness || 0);
            for (const keyword of ability.effect?.keywords || (ability.effect?.keyword ? [ability.effect.keyword] : [])) {
              if (!twin.modifiers.keywords.includes(keyword)) twin.modifiers.keywords.push(keyword);
            }
          }
        }
        twin.summoningSick = false;
        twin.tapped = true;
        twin.attacking = true;
        twin.attackTarget = ctx.eventPayload?.defendingPlayer || source.attackTarget || e.opponent(pid);
        twin.sacrificeAtEndTurn = s.turn;
        if (!s.combat.attackers.includes(twin.instanceId)) s.combat.attackers.push(twin.instanceId);
        s.combat.attackTargets[twin.instanceId] = twin.attackTarget;
        if (twin.attackTarget && !s.combat.defendingPlayers.includes(twin.attackTarget)) s.combat.defendingPlayers.push(twin.attackTarget);
        break;
      }
      case 'myriad': {
        const source = e.findPermanent(ctx.source?.instanceId);
        if (!source) break;
        const original = e.db[source.cardId] || {};
        const defending = ctx.eventPayload?.defendingPlayer || source.attackTarget;
        for (const opponentId of e.opponents(pid).filter(id => id !== defending)) {
          const [copy] = this.createTokenRaw(pid, {
            name: `${original.name || 'Myriad'} Token`, typeLine: original.typeLine || 'Token Creature',
            subtypes: [...(original.subtypes || [])], colors: [...(original.colors || [])],
            power: original.power ?? 0, toughness: original.toughness ?? 0,
            keywords: [...new Set([...(original.keywords || []), 'haste'])], abilities: structuredClone(original.abilities || [])
          }, 1);
          if (!copy) continue;
          copy.summoningSick = false;
          copy.tapped = true;
          copy.attacking = true;
          copy.attackTarget = opponentId;
          copy.sacrificeAtEndTurn = s.turn;
          s.combat.attackers.push(copy.instanceId);
          s.combat.attackTargets[copy.instanceId] = opponentId;
          if (!s.combat.defendingPlayers.includes(opponentId)) s.combat.defendingPlayers.push(opponentId);
        }
        break;
      }
      case 'manifestDread': {
        const revealed = p.library.slice(0, 2);
        if (!revealed.length) break;
        const manifested = revealed[0];
        const other = revealed[1];
        const moved = e._moveZoneNow(manifested, 'battlefield', pid);
        if (moved) {
          moved.faceDown = true;
          moved.summoningSick = true;
          moved.createdTurn = s.turn;
          moved.controlledSinceTurn = s.turn;
          e.emit(EVENT.ENTER_BATTLEFIELD, { controller: pid, target: moved, faceDown: true });
        }
        if (other && ZoneManager.find(s, other.instanceId)?.zone === 'library') e._moveZoneNow(other, 'graveyard', other.owner);
        break;
      }
      case 'turnFaceUp': {
        const source = e.findPermanent(ctx.source?.instanceId);
        if (source?.faceDown) source.faceDown = false;
        break;
      }
      case 'bulliesDonate': {
        const [targetPlayerId, cardId] = ctx.targets || [];
        const found = cardId ? ZoneManager.find(s, cardId) : null;
        if (!s.players[targetPlayerId] || found?.zone !== 'graveyard') break;
        const card = e._moveZoneNow(found.card, 'battlefield', targetPlayerId);
        if (!card) break;
        card.summoningSick = false;
        if (!card.modifiers.keywords.includes('haste')) card.modifiers.keywords.push('haste');
        card.exileAtEndTurn = s.turn;
        const forcedTargets = e.opponents(targetPlayerId).filter(opponentId => opponentId !== pid);
        card.mustAttackPlayer = forcedTargets[0] || e.opponents(targetPlayerId)[0] || null;
        e.emit(EVENT.ENTER_BATTLEFIELD, { controller: targetPlayerId, target: card });
        break;
      }
      case 'jhoiraSuspend': {
        const targetId = this._targetId(ctx);
        const found = targetId ? ZoneManager.find(s, targetId) : null;
        if (!found || found.zone !== 'hand' || found.card.owner !== pid || isType(e.db[found.card.cardId], 'Land')) break;
        const card = e._moveZoneNow(found.card, 'exile', pid);
        card.suspended = true;
        e.counters.add(card, 'time', Number(effect.counters || 4), { playerId: pid, source: ctx.source || null, cause: 'suspend-time-counters' });
        e.log('CARD_SUSPENDED', { controller: pid, card: card.cardId, counters: e.counters.count(card, 'time') });
        break;
      }
      case 'adjustTimeCounters': {
        const targetId = this._targetId(ctx);
        const found = targetId ? ZoneManager.find(s, targetId) : null;
        if (!found || found.zone !== 'exile' || !found.card.suspended) break;
        const delta = Number(effect.amount || 0);
        if (delta > 0) e.counters.add(found.card, 'time', delta, { playerId: pid, source: ctx.source || null, cause: 'adjust-time-counters' });
        else if (delta < 0) e.counters.remove(found.card, 'time', Math.abs(delta), { playerId: pid, source: ctx.source || null, cause: 'adjust-time-counters' });
        e.log('TIME_COUNTERS_ADJUSTED', { controller: pid, card: found.card.cardId, remaining: e.counters.count(found.card, 'time') });
        if (e.counters.count(found.card, 'time') === 0) e._castSuspendedCard(found.card, found.card.owner);
        break;
      }
      case 'extraTurn': {
        e.turn.addExtraTurn(effect.targetPlayer || pid, this._amount(effect, ctx, 1));
        break;
      }
      case 'skipNextTurn': {
        e.turn.skipNextTurns(effect.targetPlayer || pid, this._amount(effect, ctx, 1));
        break;
      }
      case 'extraUpkeep': {
        e.turn.addExtraUpkeeps(effect.targetPlayer || pid, this._amount(effect, ctx, 1));
        break;
      }
      case 'skipNextDrawStep': {
        e.turn.skipNextDrawSteps(effect.targetPlayer || pid, this._amount(effect, ctx, 1));
        break;
      }
      case 'skipNextCombat': {
        e.turn.skipNextCombatPhases(effect.targetPlayer || pid, this._amount(effect, ctx, 1));
        break;
      }
      case 'extraCombat': {
        e.turn.addExtraCombatAfterCurrent({ includeMainAfter: effect.includeMainAfter !== false });
        break;
      }
      case 'extraMainPhase': {
        e.turn.addExtraMainPhaseAfterCurrent();
        break;
      }
      case 'crewVehicle': {
        const vehicle = ctx.source?.instanceId ? e.findPermanent(ctx.source.instanceId) : null;
        if (!vehicle) break;
        e.continuous.register({
          sourceId: vehicle.instanceId, layer: 4, duration: 'until-end-of-turn',
          filter: { self: true }, transform: { addType: 'Creature' },
          metadata: { createdTurn: e.state.turn, mechanic: 'crew' }
        });
        e.log('VEHICLE_CREWED', { controller: pid, vehicleId: vehicle.instanceId, crew: [...(ctx.selections || [])] });
        break;
      }
      case 'resolveSagaChapter': {
        const liveSaga = ctx.source?.instanceId ? e.findPermanent(ctx.source.instanceId) : null;
        if (!liveSaga) break;
        const chapter = effect.chapter || {};
        const targetSource = chapter.targets ? { targets: chapter.targets } : null;
        let targets = [];
        if (targetSource) {
          const candidates = e.targeting.getCandidates(pid, targetSource, [], { sourceObject: liveSaga });
          const harmful = ['destroy','exile','damage','returnToHand'].includes(chapter.effect?.type);
          candidates.sort((a, b) => Number((b.card?.controller !== pid) && harmful) - Number((a.card?.controller !== pid) && harmful));
          if (candidates[0]) targets = [candidates[0].id];
        }
        this.resolve(chapter.effect, { controller: pid, source: liveSaga, targets, targeted: !!targetSource });
        e.log('SAGA_CHAPTER_RESOLVED', { controller: pid, card: liveSaga.cardId, chapter: chapter.number });
        const definition = e.db[liveSaga.cardId] || {};
        const finalChapter = Math.max(0, ...(definition.sagaChapters || []).map(item => Number(item.number || 0)));
        if (Number(chapter.number) === finalChapter) {
          e.emit(EVENT.SAGA_FINAL_RESOLVED, { controller: pid, source: liveSaga, chapter: chapter.number });
          const stillThere = e.findPermanent(liveSaga.instanceId);
          if (stillThere && e.static.hasSubtype(stillThere, 'Saga') && e.counters.count(stillThere, 'lore') >= finalChapter) stillThere.sagaFinalResolved = true;
        }
        break;
      }
      case 'cascade': {
        const sourceDef = ctx.source?.cardId ? e.db[ctx.source.cardId] : null;
        const sourceManaValue = Number(effect.sourceManaValue ?? sourceDef?.manaValue ?? sourceDef?.cmc ?? 0);
        e.libraryOps.cascade(pid, sourceManaValue, { reason: effect.reason || 'cascade' });
        break;
      }
      case 'discover': {
        const amount = this._amount(effect, ctx, 0);
        e.libraryOps.discover(pid, amount, { reason: effect.reason || 'discover' });
        break;
      }
      case 'revealUntilToBattlefield': {
        e.libraryOps.revealUntilToBattlefield(pid, effect.filter || {}, {
          controllerId: effect.controller || pid,
          reason: effect.reason || 'reveal-until-battlefield',
          maxCards: effect.maxCards ?? Infinity,
          castOption: effect.castOption || effect.reason || 'reveal-until-battlefield'
        });
        break;
      }
      case 'tomBombadilCascade': {
        const tom = ctx.source?.instanceId ? e.findPermanent(ctx.source.instanceId) : null;
        if (!tom || Number(tom.tomCascadeTurn) === Number(s.turn)) break;
        tom.tomCascadeTurn = s.turn;
        const sagaIndex = p.library.findIndex(card => hasSubtype(e.db[card.cardId], 'Saga'));
        if (sagaIndex < 0) break;
        const revealed = p.library.slice(0, sagaIndex + 1);
        for (const card of revealed) e.revealCard(card, { reason: 'tom-bombadil' });
        const saga = revealed.at(-1);
        e.zones.detach(saga.instanceId);
        const rest = shuffle(revealed.slice(0, -1), e.rng);
        for (const card of rest) e.zones.moveWithinZone(pid, 'library', card.instanceId, p.library.length - 1);
        e._finishPermanentResolution({ card: saga, controller: pid, mode: null, castOption: 'tom-bombadil' }, []);
        e.log('TOM_BOMBADIL_FOUND_SAGA', { controller: pid, card: saga.cardId, revealed: sagaIndex + 1 });
        break;
      }
      case 'encore': {
        const original = e.db[effect.cardId || ctx.source?.cardId] || {};
        const tokenDefinition = {
          name: original.name || 'Encore token',
          typeLine: original.typeLine || 'Token Creature',
          power: original.power ?? 0,
          toughness: original.toughness ?? 0,
          colors: [...(original.colors || [])],
          subtypes: [...(original.subtypes || [])],
          keywords: [...new Set([...(original.keywords || []), 'haste'])],
          abilities: [
            ...structuredClone(original.abilities || []),
            { type: 'triggered', event: EVENT.END_STEP, condition: { encoreSacrificeDue: true }, effect: { type: 'sacrificeSelf' } }
          ]
        };
        for (const opponentId of e.opponents(pid)) {
          const [token] = this.createToken(pid, tokenDefinition, 1);
          if (token) {
            token.summoningSick = false;
            token.mustAttackPlayer = opponentId;
            token.encoreSacrificeTurn = s.turn;
          }
        }
        break;
      }
      case 'sacrificeSelf': {
        const source = ctx.source?.instanceId ? e.findPermanent(ctx.source.instanceId) : null;
        if (source) e.sacrifice(source);
        break;
      }
      case 'addCounter': {
        const sourceTarget = effect.source === true && ctx.source?.instanceId ? e.findPermanent(ctx.source.instanceId) : null;
        const targets = sourceTarget
          ? [sourceTarget]
          : (ctx.targeted ? this._permanentTargets(ctx) : ((ctx.targets || []).length ? this._permanentTargets(ctx) : e.selectPermanents(pid, effect.filter || {}, ctx)));
        s.pendingCounterQueue = targets.slice(0, effect.maxTargets || targets.length).map(target => ({
          permanentId: target.instanceId,
          counterType: effect.counter || '+1/+1',
          amount: this._amount(effect, ctx, 1)
        }));
        this._continueCounterQueue();
        break;
      }
      case 'pump': {
        const targets = ctx.targeted ? this._permanentTargets(ctx) : ((ctx.targets || []).length ? this._permanentTargets(ctx) : e.selectPermanents(pid, effect.filter || {}, ctx));
        for (const t of targets) {
          t.modifiers.power += (effect.power || 0);
          t.modifiers.toughness += (effect.toughness || 0);
          for (const keyword of effect.keywords || (effect.keyword ? [effect.keyword] : [])) if (!t.modifiers.keywords.includes(keyword)) t.modifiers.keywords.push(keyword);
        }
        break;
      }
      case 'destroy': {
        const targets = ctx.targeted
          ? this._permanentTargets(ctx)
          : ((ctx.targets || []).length ? this._permanentTargets(ctx) : e.selectPermanents(effect.targetPlayer || e.opponent(pid), effect.filter || {}, ctx).slice(0, effect.maxTargets || 1));
        for (const t of targets) e.destroy(t);
        break;
      }
      case 'exile': {
        const targets = ctx.targeted
          ? this._permanentTargets(ctx)
          : ((ctx.targets || []).length ? this._permanentTargets(ctx) : e.selectPermanents(effect.targetPlayer || e.opponent(pid), effect.filter || {}, ctx).slice(0, effect.maxTargets || 1));
        for (const t of targets) e.exile(t);
        break;
      }
      case 'additionalLandPlay':
        p.landPlaysRemaining += Number(effect.amount || 1);
        break;
      case 'putLandFromHand': {
        const ids = p.hand.filter(card => isType(e.db[card.cardId], 'Land')).map(card => card.instanceId);
        this._openCardChoice(pid, ids, { min: effect.optional === false ? 1 : 0, max: 1, prompt: 'Choose a land from your hand to put onto the battlefield', continuation: { type: 'putLandFromHand', tapped: !!effect.tapped } });
        break;
      }
      case 'returnLandYouControl': {
        const ids = p.battlefield.filter(card => e.static.isType(card, 'Land')).map(card => card.instanceId);
        this._openCardChoice(pid, ids, { min: ids.length ? 1 : 0, max: ids.length ? 1 : 0, prompt: 'Choose a land you control to return to your hand', continuation: { type: 'returnPermanentToHand' } });
        break;
      }
      case 'returnToHand': {
        const targets = ctx.targeted ? this._permanentTargets(ctx) : ((ctx.targets || []).length ? this._permanentTargets(ctx) : e.selectPermanents(effect.targetPlayer || e.opponent(pid), effect.filter || {}));
        for (const target of targets) e.moveToZone(target, 'hand', target.owner);
        break;
      }
      case 'returnAttackers': {
        for (const id of [...(s.combat.attackers || [])]) {
          const target = e.findPermanent(id);
          if (target) e.moveToZone(target, 'hand', target.owner);
        }
        break;
      }
      case 'returnCreaturesWithoutCounter': {
        for (const player of Object.values(s.players)) for (const target of [...player.battlefield]) {
          if (e.static.isType(target, 'Creature') && Number(target.counters?.[effect.counter || '+1/+1'] || 0) <= 0) e.moveToZone(target, 'hand', target.owner);
        }
        break;
      }
      case 'replaceWithToken': {
        for (const id of ctx.targets || []) {
          const target = e.findPermanent(id);
          if (!target) continue;
          const controller = target.controller;
          if (effect.exile) e.exile(target); else e.destroy(target);
          this.createToken(controller, effect.token, effect.amount || 1);
        }
        break;
      }
      case 'tap': {
        for (const target of this._permanentTargets(ctx)) e.tapPermanent(target);
        break;
      }
      case 'skipNextUntap': {
        for (const target of this._permanentTargets(ctx)) target.skipNextUntap = true;
        break;
      }
      case 'increment': {
        const source = e.findPermanent(ctx.source?.instanceId);
        if (!source) break;
        const castCard = ctx.event?.card || ctx.card || null;
        const manaSpent = Number(ctx.event?.manaSpent ?? castCard?.manaSpent ?? castCard?.manaValue ?? (castCard ? e.db[castCard.cardId]?.manaValue : 0) ?? 0);
        const stats = e.static.derivedStats(source);
        if (manaSpent > Number(stats.power || 0) || manaSpent > Number(stats.toughness || 0)) this.addCounters(source.controller, source, '+1/+1', 1);
        break;
      }
      case 'untap': {
        for (const target of this._permanentTargets(ctx)) e.untapPermanent(target);
        break;
      }
      case 'tapOrUntap': {
        const target = this._permanentTargets(ctx)[0];
        if (!target) break;
        s.pendingChoice = {
          type: 'TAP_OR_UNTAP',
          playerId: pid,
          targetId: target.instanceId,
          targetName: e.db[target.cardId]?.name || target.cardId,
          sourceName: e.db[ctx.source?.cardId]?.name || ctx.source?.cardId || 'ability',
          resume: this._choiceResume()
        };
        s.priorityPlayer = pid;
        break;
      }
      case 'addCountersAll': {
        for (const target of e.selectPermanents(pid, effect.filter || { type: 'Creature' })) this.addCounters(pid, target, effect.counter || '+1/+1', this._amount(effect, ctx, 1));
        break;
      }
      case 'adapt': {
        const source = e.findPermanent(ctx.source?.instanceId);
        if (source && Number(source.counters?.['+1/+1'] || 0) === 0) this.addCounters(pid, source, '+1/+1', Number(effect.amount || 1));
        break;
      }
      case 'levelUp': {
        const source = e.findPermanent(ctx.source?.instanceId);
        if (source) this.addCounters(pid, source, 'level', Number(effect.amount || 1));
        break;
      }
      case 'addCounterSource': {
        const source = e.findPermanent(ctx.source?.instanceId);
        if (source) this.addCounters(pid, source, effect.counter || '+1/+1', this._amount(effect, ctx, 1));
        break;
      }
      case 'addKeywordSource': {
        const source = e.findPermanent(ctx.source?.instanceId);
        if (source) for (const keyword of effect.keywords || (effect.keyword ? [effect.keyword] : [])) if (!source.modifiers.keywords.includes(keyword)) source.modifiers.keywords.push(keyword);
        break;
      }
      case 'addCounterTarget': {
        const target = this._permanentTarget(ctx, effect.index || 0);
        if (target) this.addCounters(target.controller, target, effect.counter || '+1/+1', this._amount(effect, ctx, 1));
        break;
      }
      case 'returnTarget': {
        const target = this._permanentTarget(ctx, effect.index || 0);
        if (target) e._moveZoneNow(target, 'hand', target.owner);
        break;
      }
      case 'counterSpellTarget': {
        const id = this._targetId(ctx, effect.index || 0);
        const found = id ? ZoneManager.find(s, id) : null;
        if (found?.zone === 'stack') {
          e._counterStackItem(found.stackItem?.id || found.stackItem?.gameObjectId || id, 'counter-spell-target');
        }
        break;
      }
      case 'shuffleGraveTargets': {
        const start = Number(effect.startIndex || 0);
        const end = effect.endIndex == null ? (ctx.targets || []).length : Number(effect.endIndex);
        const owners = new Set();
        for (const id of (ctx.targets || []).slice(start, end)) {
          const found = ZoneManager.find(s, id);
          if (found?.zone !== 'graveyard') continue;
          const owner = found.card.owner;
          e._moveZoneNow(found.card, 'library', owner);
          owners.add(owner);
        }
        for (const owner of owners) e.shuffleLibrary(owner, 'shuffle-grave-targets');
        break;
      }
      case 'drawPerCreatures':
        for (let i = 0; i < e.state.players[pid].battlefield.filter(card => e.static.isType(card, 'Creature')).length; i++) e.draw(pid);
        break;
      case 'drawPerCreaturesWithCounter': {
        const n = e.state.players[pid].battlefield.filter(card => e.static.isType(card, 'Creature') && Number(card.counters?.[effect.counter || '+1/+1'] || 0) > 0).length;
        for (let i = 0; i < n; i++) e.draw(pid);
        break;
      }
      case 'drawSourcePower': {
        const source = e.findPermanent(ctx.source?.instanceId) || ctx.source;
        const n = source ? e.static.derivedStats(source).power : Number(ctx.sourcePowerAtActivation || 0);
        for (let i = 0; i < Math.max(0,n); i++) e.draw(pid);
        break;
      }
      case 'drawEventAmount':
        for (let i = 0; i < Number(ctx.eventPayload?.amount || 0); i++) e.draw(pid);
        break;
      case 'moveCounterToEvent': {
        const source = e.findPermanent(ctx.source?.instanceId);
        const target = this._eventObject(ctx);
        const type = effect.counter || '+1/+1';
        if (source && target && Number(source.counters?.[type] || 0) > 0) {
          e.removeCounters(source, type, 1, source.controller);
          this.addCounters(target.controller, e.findPermanent(target.instanceId), type, 1);
        }
        break;
      }
      case 'putLandFromHandIfExploredLand': {
        if (!ctx.eventPayload?.revealedLand) break;
        const ids = p.hand.filter(card => isType(e.db[card.cardId], 'Land')).map(card => card.instanceId);
        this._openCardChoice(pid, ids, { min: 0, max: 1, prompt: 'Nicanzil: put a land from your hand onto the battlefield tapped?', continuation: { type: 'putLandFromHand', tapped: true } });
        break;
      }
      case 'untapPermanentsWithCounters':
        for (const target of p.battlefield) if (Object.values(target.counters || {}).some(n => Number(n) > 0)) e.untapPermanent(target);
        break;
      case 'doubleCounters': {
        for (const target of this._permanentTargets(ctx)) {
          for (const [type, amount] of Object.entries({ ...(target.counters || {}) })) if (amount > 0) this.addCounters(target.controller, target, type, amount);
        }
        break;
      }
      case 'attachEquipment': {
        const source = e.findPermanent(ctx.source?.instanceId);
        const target = this._permanentTargets(ctx)[0];
        if (source && target) source.attachedTo = target.instanceId;
        break;
      }
      case 'gainControl': {
        const target = this._permanentTargets(ctx)[0];
        if (target) {
          const previousController = target.controller;
          e.changeController(target.instanceId, pid);
          const moved = e.findPermanent(target.instanceId);
          if (moved && effect.duration === 'until-end-of-turn') moved.temporaryControl = { previousController, expiresTurn: s.turn };
          if (moved && effect.untap) e.untapPermanent(moved);
          if (effect.attachIfEquipment && moved && isType(e.db[moved.cardId], 'Equipment')) moved.attachedTo = ctx.source?.instanceId || null;
        }
        break;
      }
      case 'combatRestriction': {
        for (const target of this._permanentTargets(ctx)) {
          if (effect.cantAttack) target.cantAttack = true;
          if (effect.mustAttack) target.mustAttack = true;
          target.temporaryCombatFlags = { expiresTurn: s.turn, cantAttack: !!effect.cantAttack, mustAttack: !!effect.mustAttack };
        }
        break;
      }
      case 'thievingSkydiver': {
        const source = e.findPermanent(ctx.source?.instanceId);
        const mode = String(source?.castMode || ctx.mode || ctx.castOption || '');
        const match = mode.match(/kicker-(\d+)/);
        const x = match ? Number(match[1]) : 0;
        const target = this._permanentTargets(ctx)[0];
        if (x > 0 && target && isType(e.db[target.cardId], 'Artifact') && Number(e.db[target.cardId]?.manaValue || 0) <= x) {
          e.changeController(target.instanceId, pid);
          if (isType(e.db[target.cardId], 'Equipment')) target.attachedTo = source?.instanceId || null;
        }
        break;
      }
      case 'mentor': {
        const target = this._permanentTargets(ctx)[0];
        if (target) this.addCounters(target.controller, target, '+1/+1', 1);
        break;
      }
      case 'makeMap':
        this.createToken(pid, { name:'Map', typeLine:'Artifact — Map', subtypes:['Map'], abilities:[{ type:'activated', cost:{ mana:'{1}', sacrificeSelf:true }, sorcerySpeed:true, targets:{ kind:'permanent', type:'Creature', controller:'you' }, effect:{ type:'explore' } }] }, 1);
        break;
      case 'castPermission':
        s.castingPermissions.push({ playerId: pid, timing: effect.timing || 'flash', untilTurn: s.turn });
        break;
      case 'proliferate':
        this.beginProliferate(pid, effect.after || null);
        break;
      case 'explore': {
        const explicitId = (ctx.targets || [])[0]
          || (typeof effect.target === 'string' ? effect.target : effect.target?.instanceId)
          || (typeof ctx.target === 'string' ? ctx.target : ctx.target?.instanceId);
        const sourceId = ctx.source?.instanceId;
        const target = explicitId ? e.findPermanent(explicitId) : (sourceId ? e.findPermanent(sourceId) : null);
        this.explore(target);
        break;
      }
      case 'exploreAll': {
        const ids = e.selectPermanents(pid, effect.filter || { type: 'Creature' }, ctx).map(target => target.instanceId);
        if (ids.length > 1) {
          s.pendingChoice = {
            type: 'EXPLORE_ORDER',
            playerId: pid,
            permanentIds: ids,
            resume: this._choiceResume()
          };
          s.priorityPlayer = pid;
        } else {
          s.pendingExploreQueue = ids;
          this._continueExploreQueue();
        }
        break;
      }
      case 'hakbalAttack': {
        const landInstanceIds = p.hand.filter(card => isType(e.db[card.cardId], 'Land')).map(card => card.instanceId);
        s.pendingChoice = {
          type: 'HAKBAL_ATTACK',
          playerId: pid,
          landInstanceIds,
          resume: this._choiceResume()
        };
        s.priorityPlayer = pid;
        break;
      }
      case 'cultivate': {
        const prepared = e.libraryOps.prepareSearch({
          searchingPlayerId: pid,
          filter: { type:'Land', basic:true },
          minCount: 0,
          maxCount: 2,
          destinationPlan: [{ zone:'battlefield', tapped:true }, { zone:'hand' }],
          revealFound: true,
          shuffleAfter: true,
          reason: 'cultivate'
        });
        if (prepared.prevented) break;
        const eligibleIds = prepared.candidates.map(card => card.instanceId);
        s.pendingChoice = {
          type: 'CULTIVATE_SEARCH',
          playerId: prepared.request.chooserPlayerId,
          searchingPlayerId: pid,
          eligibleIds,
          max: Math.min(2, eligibleIds.length),
          librarySearchRequest: structuredClone(prepared.request),
          resume: this._choiceResume()
        };
        s.priorityPlayer = prepared.request.chooserPlayerId;
        break;
      }
      case 'sisayTutor': {
        const source = ctx.source?.instanceId ? e.findPermanent(ctx.source.instanceId) : null;
        const sourcePower = source ? e.static.derivedStats(source).power : Number(ctx.sourcePowerAtActivation || 0);
        const prepared = e.libraryOps.prepareSearch({
          searchingPlayerId: pid,
          filter: { and:[{ legendary:true }, { not:{ type:'Instant' } }, { not:{ type:'Sorcery' } }], maxManaValue: Math.max(0, sourcePower - 0.0001) },
          minCount: 0,
          maxCount: 1,
          destination: 'battlefield',
          revealFound: true,
          shuffleAfter: true,
          reason: 'sisay-tutor'
        });
        if (prepared.prevented) break;
        const eligibleIds = prepared.candidates.map(card => card.instanceId).filter(id => {
          const found = e.zones.find(id);
          return found && Number(e.db[found.card.cardId]?.manaValue || 0) < sourcePower;
        });
        s.pendingChoice = {
          type: 'SISAY_TUTOR',
          playerId: prepared.request.chooserPlayerId,
          searchingPlayerId: pid,
          eligibleIds,
          sourcePower,
          librarySearchRequest: structuredClone(prepared.request),
          resume: this._choiceResume()
        };
        s.priorityPlayer = prepared.request.chooserPlayerId;
        break;
      }
      case 'scry': {
        const top = p.library[0];
        if (top) {
          s.pendingChoice = {
            type: 'SCRY',
            playerId: pid,
            cardInstanceId: top.instanceId,
            cardId: top.cardId,
            cardName: e.db[top.cardId]?.name || top.cardId,
            resume: this._choiceResume()
          };
          s.priorityPlayer = pid;
        }
        break;
      }
      case 'pumpEventObject': {
        const eventObject = this._eventObject(ctx);
        const target = eventObject?.instanceId ? e.findPermanent(eventObject.instanceId) : null;
        if (target) {
          target.modifiers.power += Number(effect.power || 0);
          target.modifiers.toughness += Number(effect.toughness || 0);
          for (const keyword of effect.keywords || (effect.keyword ? [effect.keyword] : [])) if (!target.modifiers.keywords.includes(keyword)) target.modifiers.keywords.push(keyword);
        }
        break;
      }
      case 'mechanicProwess': {
        const source = ctx.source?.instanceId ? e.findPermanent(ctx.source.instanceId) : null;
        if (source) { source.modifiers.power += 1; source.modifiers.toughness += 1; }
        break;
      }
      case 'mechanicExalted': {
        const attackerId = ctx.eventPayload?.attackers?.length === 1 ? ctx.eventPayload.attackers[0] : null;
        const attacker = attackerId ? e.findPermanent(attackerId) : null;
        if (attacker) { attacker.modifiers.power += 1; attacker.modifiers.toughness += 1; }
        break;
      }
      case 'investigate': {
        this.createToken(pid, { name: 'Clue' }, Math.max(1, Number(effect.amount || 1)));
        break;
      }
      case 'populate': {
        const tokenId = (ctx.targets || [])[0] || effect.tokenId || null;
        const token = tokenId ? e.findPermanent(tokenId) : (p.battlefield || []).find(card => card.isToken && e.static.isType(card, 'Creature'));
        if (!token?.isToken) break;
        const definition = e.db[token.cardId] || {
          name: token.name || 'Token', typeLine: token.typeLine || 'Token Creature', power: token.basePower ?? token.power ?? 0, toughness: token.baseToughness ?? token.toughness ?? 0,
          colors: token.colors || [], subtypes: token.subtypes || [], keywords: e.static.derivedStats(token).keywords, abilities: e.static.effectiveAbilities(token)
        };
        this.createToken(pid, { ...structuredClone(definition), name: definition.name || 'Token' }, 1);
        break;
      }
      case 'optionalPayManaThen': {
        const cost = effect.mana || '';
        if (!cost) { this.resolve(effect.then, ctx); break; }
        if (!e.mana.canAfford(p, e.db, cost, 0, e, { kind: 'other' })) break;
        s.pendingChoice = {
          type: 'OPTIONAL_MANA_PAYMENT',
          playerId: pid,
          mana: cost,
          sourceName: e.db[ctx.source?.cardId]?.name || ctx.source?.cardId || 'ability',
          then: structuredClone(effect.then || null),
          context: {
            controller: pid,
            source: ctx.source ? structuredClone(ctx.source) : null,
            sourcePowerAtActivation: ctx.sourcePowerAtActivation ?? null,
            eventPayload: ctx.eventPayload ? structuredClone(ctx.eventPayload) : null,
            targets: [...(ctx.targets || [])],
            selections: [...(ctx.selections || [])],
            targeted: !!ctx.targeted,
            mode: ctx.mode ?? null,
            castOption: ctx.castOption ?? null
          },
          resume: this._choiceResume()
        };
        s.priorityPlayer = pid;
        break;
      }
      case 'optionalEffect': {
        s.pendingChoice = {
          type: 'OPTIONAL_EFFECT',
          playerId: pid,
          prompt: effect.prompt || 'Use this optional effect?',
          sourceName: e.db[ctx.source?.cardId]?.name || ctx.source?.cardId || 'ability',
          then: structuredClone(effect.then || null),
          context: {
            controller: pid,
            source: ctx.source ? structuredClone(ctx.source) : null,
            sourcePowerAtActivation: ctx.sourcePowerAtActivation ?? null,
            eventPayload: ctx.eventPayload ? structuredClone(ctx.eventPayload) : null,
            targets: [...(ctx.targets || [])],
            selections: [...(ctx.selections || [])],
            targeted: !!ctx.targeted,
            mode: ctx.mode ?? null,
            castOption: ctx.castOption ?? null
          },
          resume: this._choiceResume()
        };
        s.priorityPlayer = pid;
        break;
      }
      case 'conditionalDraw': {
        const cond = effect.condition || {};
        let okay = true;
        if (cond.otherCreatureWithCounter) okay = p.battlefield.some(card => card.instanceId !== ctx.source?.instanceId && e.static.isType(card,'Creature') && Number(card.counters?.[cond.otherCreatureWithCounter] || 0) > 0);
        if (okay) for (let i=0;i<Number(effect.amount || 1);i++) e.draw(pid);
        break;
      }
      case 'winIfSourceCounterAtLeast': {
        const source = e.findPermanent(ctx.source?.instanceId);
        if (source && Number(source.counters?.[effect.counter || 'growth'] || 0) >= Number(effect.amount || 20)) {
          s.winner = pid;
          for (const opponentId of e.opponents(pid)) e.elimination.markLost(opponentId, { reason: 'effect-win' });
          e.elimination.cleanup();
        }
        break;
      }
      case 'commit': {
        for (const id of ctx.targets || []) {
          const found = ZoneManager.find(s, id);
          if (!found) continue;
          let card = found.card;
          if (found.zone === 'stack') {
            const item = e.stack.remove(found.stackItem?.id || found.stackItem?.gameObjectId || id);
            card = item?.card || null;
            // A spell copy is not a physical card. Removing it from the stack
            // must never insert its source card into a library.
            if (!card || item?.isCopy) continue;
            e._moveZoneNow(card, 'library', card.owner);
          } else {
            e.moveToZone(card, 'library', card.owner);
          }
          const library = s.players[card.owner].library;
          const index = library.findIndex(x => x.instanceId === card.instanceId);
          if (index >= 0) e.zones.moveWithinZone(card.owner, 'library', card.instanceId, Math.min(1, Math.max(0, library.length - 1)));
        }
        break;
      }
      case 'counterSpell': {
        for (const id of ctx.targets || []) {
          const found = ZoneManager.find(s, id);
          if (found?.zone !== 'stack') continue;
          e._counterStackItem(found.stackItem?.id || found.stackItem?.gameObjectId || id, 'counter-spell');
        }
        break;
      }
      case 'shuffleGraveCards': {
        const byOwner = new Map();
        for (const id of ctx.targets || []) {
          const found = ZoneManager.find(s, id);
          if (!found || found.zone !== 'graveyard') continue;
          const owner = found.card.owner;
          const moved = e._moveZoneNow(found.card, 'library', owner);
          if (moved) byOwner.set(owner, true);
        }
        for (const owner of byOwner.keys()) e.shuffleLibrary(owner, 'shuffle-grave-cards');
        break;
      }
      case 'memory': {
        for (const playerId of e.livingPlayerIds()) {
          const player = s.players[playerId];
          const all = [...player.hand, ...player.graveyard];
          for (const card of all) e._moveZoneNow(card, 'library', playerId);
          e.shuffleLibrary(playerId, 'memory');
        }
        for (const playerId of e.livingPlayerIds()) e.draw(playerId, 7);
        break;
      }
      case 'phaseOut': {
        for (const target of this._permanentTargets(ctx)) target.phasedOut = true;
        break;
      }
      case 'ruinousIntrusion': {
        const [exileId, creatureId] = ctx.targets || [];
        const exiled = e.findPermanent(exileId);
        const creature = e.findPermanent(creatureId);
        const mv = Number(e.db[exiled?.cardId]?.manaValue || 0);
        if (exiled) e.exile(exiled);
        if (creature && mv > 0) this.addCounters(creature.controller, creature, '+1/+1', mv);
        break;
      }
      case 'returnPermanentCard': {
        for (const id of ctx.targets || []) {
          const found = ZoneManager.find(s, id);
          if (found?.zone === 'graveyard') e._moveZoneNow(found.card, 'hand', found.card.owner);
        }
        break;
      }
      case 'copySpell': {
        const eventCard = ctx.eventPayload?.card;
        const stackItem = s.stack.find(item => item.card?.instanceId === eventCard?.instanceId);
        if (stackItem) this.queueSpellCopies(stackItem, Number(effect.copies || 1), pid, { retargetAllowed: effect.retargetAllowed ?? effect.chooseNewTargets ?? true });
        break;
      }
      case 'copySpellByInstance': {
        const instanceId = effect.spellInstanceId || ctx.source?.instanceId;
        const stackItem = s.stack.find(item => item.card?.instanceId === instanceId);
        if (stackItem) this.queueSpellCopies(stackItem, Number(effect.copies || 1), pid, { retargetAllowed: effect.retargetAllowed ?? effect.chooseNewTargets ?? true });
        break;
      }
      case 'hideaway': {
        const source = e.findPermanent(ctx.source?.instanceId);
        if (!source) break;
        const top = p.library.slice(0, Number(effect.count || 4));
        if (!top.length) break;
        s.pendingChoice = { type: 'HIDEAWAY', playerId: pid, sourceId: source.instanceId, candidateIds: top.map(card => card.instanceId), count: top.length, resume: this._choiceResume() };
        s.priorityPlayer = pid;
        break;
      }
      case 'playHideaway': {
        const sourceId = ctx.source?.instanceId;
        if (!sourceId) break;
        const totalPower = p.battlefield.filter(card => e.static.isType(card,'Creature')).reduce((sum,card)=>sum+Math.max(0,e.static.derivedStats(card).power),0);
        if (totalPower < Number(effect.powerThreshold || 10)) break;
        const card = p.exile.find(card => card.exiledBy === sourceId);
        if (!card) break;
        s.pendingChoice = {
          type: 'HIDEAWAY_PLAY', playerId: pid, sourceId, cardInstanceId: card.instanceId,
          cardName: e.db[card.cardId]?.name || card.cardId, resume: this._choiceResume()
        };
        s.priorityPlayer = pid;
        break;
      }
      case 'myriadLandscape': {
        const prepared = e.libraryOps.prepareSearch({ searchingPlayerId:pid, filter:{ type:'Land', basic:true }, minCount:0, maxCount:2, destination:'battlefield', tapped:true, revealFound:true, shuffleAfter:true, reason:'myriad-landscape' });
        if (prepared.prevented) break;
        const basics = prepared.candidates.map(card => card.instanceId);
        this._openCardChoice(prepared.request.chooserPlayerId, basics, { min: 0, max: Math.min(2, basics.length), prompt: 'Choose up to two basic lands sharing a land type', continuation: { type: 'myriadLandscape', librarySearchRequest: structuredClone(prepared.request) } });
        break;
      }
      case 'cantBeBlocked': {
        for (const target of this._permanentTargets(ctx)) {
          if (!target.modifiers.keywords.includes('unblockable')) target.modifiers.keywords.push('unblockable');
        }
        break;
      }
      case 'searchBasic': {
        e.libraryOps.searchImmediate({ searchingPlayerId:pid, filter:{ type:'Land', basic:true }, minCount:0, maxCount:1, destination:effect.destination || 'hand', revealFound:!!effect.reveal, shuffleAfter:true, tapped:!!effect.tapped, reason:'search-basic' });
        break;
      }
      case 'searchLand': {
        const landTypes = (effect.landTypes || []).map(type => String(type));
        const prepared = e.libraryOps.prepareSearch({
          searchingPlayerId: pid,
          filter: { type:'Land', ...(effect.basicOnly ? { basic:true } : {}), ...(landTypes.length ? { subtypes:landTypes } : {}) },
          minCount: 0,
          maxCount: 1,
          destination: effect.destination || 'battlefield',
          revealFound: !!effect.reveal,
          shuffleAfter: true,
          tapped: !!effect.tapped,
          reason: 'search-land'
        });
        if (prepared.prevented) break;
        const eligibleIds = prepared.candidates.map(card => card.instanceId);
        const descriptor = effect.basicOnly
          ? (landTypes.length ? `a basic ${landTypes.join(' or ')} card` : 'a basic land card')
          : (landTypes.length ? `a ${landTypes.join(' or ')} card` : 'a land card');
        this._openCardChoice(pid, eligibleIds, {
          min: 0,
          max: eligibleIds.length ? 1 : 0,
          prompt: `Search your library for ${descriptor}`,
          continuation: {
            type: 'searchLand',
            basicOnly: !!effect.basicOnly,
            landTypes,
            destination: effect.destination || 'battlefield',
            tapped: !!effect.tapped,
            librarySearchRequest: structuredClone(prepared.request)
          }
        });
        break;
      }
      case 'exploit': { const src=e.findPermanent(ctx.source?.instanceId); if(src) e.keywordRuntime.exploit(src, effect.sacrificeId || ctx.sacrificeId || null); break; }
      case 'cumulativeUpkeep': { const src=e.findPermanent(ctx.source?.instanceId); if(src) e.keywordRuntime.cumulativeUpkeep(src,{pay:!!(effect.pay ?? ctx.pay)}); break; }
      case 'extort': { const src=e.findPermanent(ctx.source?.instanceId); if(src) e.keywordRuntime.extort(src,{pay:!!(effect.pay ?? ctx.pay)}); break; }
      case 'melee': { const src=e.findPermanent(ctx.source?.instanceId); if(src) e.keywordRuntime.melee(src); break; }
      case 'soulbond': { const src=e.findPermanent(ctx.source?.instanceId); if(src) e.keywordRuntime.soulbond(src,effect.partnerId||ctx.partnerId||null); break; }
      case 'sacrifice': {
        const t = e.selectPermanents(pid, effect.filter || {}, ctx)[0];
        if (t) e.sacrifice(t);
        break;
      }
      default: {
        // Step 41: unknown effect nodes are never silently ignored. In normal
        // and strict play this raises UNSUPPORTED_INTERACTION before mutation;
        // permissive sandbox mode records an explicit no-op approximation and
        // marks the run ineligible for official statistics.
        e.unsupported?.encounter({
          message: `Effect node "${effect.type || '(missing)'}" is not implemented by the authoritative effect engine.`,
          source: ctx.source || null,
          ability: ctx.abilityId || ctx.scriptAbilityId || null,
          stackObjectId: ctx.stackObjectId || null,
          scriptNode: effect,
          context: { kind: 'effect-node', effectType: effect.type || null }
        }, {
          approximation: {
            kind: 'explicit-no-op',
            description: `Sandbox skipped unsupported effect node "${effect.type || '(missing)'}".`
          }
        });
        break;
      }
    }
  }

  _choiceResume() {
    return this.engine.state.phase === 'CLEANUP' ? 'CLEANUP' : 'PRIORITY';
  }

  _commitCounters(pid, permanent, type, amount) {
    if (!permanent || amount <= 0) return 0;
    return this.engine.counters.addWithoutChoice(permanent, type, amount, { playerId: pid, cause: 'add-counter' });
  }

  addCounters(pid, permanent, type, amount, { replacementOrder = null, source = null, cause = 'add-counter' } = {}) {
    if (!permanent || amount <= 0) return 0;
    return this.engine.counters.add(permanent, type, amount, { playerId: permanent.controller || pid, source, cause, replacementOrder });
  }

  resolveCounterReplacementChoice(choice, orderIds) {
    // Compatibility for serialized Step 7-9 choices. New Step 10 choices carry
    // replacementEvent and are resolved by ReplacementService directly.
    if (choice?.replacementEvent) return this.engine.replacements.resolveOrderChoice(choice, orderIds);
    const permanent = this.engine.findPermanent(choice?.permanentId);
    this.engine.state.pendingChoice = null;
    if (!permanent) return false;
    return this.addCounters(permanent.controller, permanent, choice.counterType, choice.amount, { replacementOrder: orderIds });
  }

  _continueCounterQueue() {
    const state = this.engine.state;
    const queue = state.pendingCounterQueue;
    if (!queue || state.pendingChoice) return;
    while (queue.length && !state.pendingChoice) {
      const item = queue.shift();
      const permanent = this.engine.findPermanent(item.permanentId);
      if (permanent) this.addCounters(permanent.controller, permanent, item.counterType, item.amount);
    }
    if (!queue.length && !state.pendingChoice) delete state.pendingCounterQueue;
  }

  _continueExploreQueue() {
    const state = this.engine.state;
    const queue = state.pendingExploreQueue;
    if (!queue || state.pendingChoice) return;
    while (queue.length && !state.pendingChoice) {
      const permanent = this.engine.findPermanent(queue.shift());
      if (permanent) this.explore(permanent);
    }
    if (!queue.length && !state.pendingChoice) delete state.pendingExploreQueue;
  }

  resumeDeferred() {
    if (this.engine.state.pendingChoice) return;
    this._continueCounterQueue();
    if (this.engine.state.pendingChoice) return;
    this._openDeferredExploreChoice();
    if (this.engine.state.pendingChoice) return;
    this._continueExploreQueue();
    if (this.engine.state.pendingChoice) return;
    this._continueExploreRepeats();
    if (this.engine.state.pendingChoice) return;
    this.engine.counters.continueProliferate();
  }

  proliferateCandidates() { return this.engine.counters.proliferateCandidates(); }

  beginProliferate(pid, after = null) { return this.engine.counters.beginProliferate(pid, after); }

  chooseProliferate(pid, targetIds) { return this.engine.counters.chooseProliferate(pid, targetIds); }

  _continueProliferate() { return this.engine.counters.continueProliferate(); }

  createToken(pid, token, amount, options = {}) {
    return this.engine.tokens.create(pid, token, amount, { ...options, cause: options.cause || 'create-token' });
  }

  createTokenRaw(pid, token, amount = 1, options = {}) {
    return this.engine.tokens.create(pid, token, amount, { ...options, skipReplacements: true, cause: options.cause || 'create-token' });
  }

  _openDeferredExploreChoice() {
    const state = this.engine.state;
    const deferred = state.deferredExploreChoice;
    if (!deferred || state.pendingChoice) return false;
    const player = state.players[deferred.playerId];
    const top = player?.library?.[0];
    if (!top || top.instanceId !== deferred.cardInstanceId) {
      delete state.deferredExploreChoice;
      return false;
    }
    state.pendingChoice = { ...deferred, type: 'EXPLORE_NONLAND' };
    state.priorityPlayer = deferred.playerId;
    delete state.deferredExploreChoice;
    return true;
  }

  resolveEffectCardChoice(choice, cardInstanceIds) {
    const e = this.engine, s = e.state, pid = choice.playerId, p = s.players[pid];
    const continuation = choice.continuation || {};
    if (continuation.type === 'discardChosen') {
      for (const id of cardInstanceIds) {
        const found = ZoneManager.find(s, id);
        if (found?.zone === 'hand' && found.player?.id === pid) {
          e.events.dispatch(ENGINE_EVENT.DISCARD_CARD, { playerId: pid, cardInstanceId: found.card.instanceId, reason: 'effect-discard' }, { cause: 'discard', stabilize: false });
        }
      }
      return;
    }
    if (continuation.type === 'returnPermanentToHand') {
      const id = cardInstanceIds[0];
      const target = id ? e.findPermanent(id) : null;
      if (target && target.controller === pid) e._moveZoneNow(target, 'hand', target.owner);
      return;
    }
    if (continuation.type === 'putLandFromHand') {
      const id = cardInstanceIds[0];
      if (!id) return;
      const found = ZoneManager.find(s, id);
      if (!found || found.zone !== 'hand' || found.player?.id !== pid || !isType(e.db[found.card.cardId], 'Land')) return;
      e._beginPutLandEffect(pid, found.card.instanceId, { tapped: !!continuation.tapped, resume: this._choiceResume() });
      return;
    }
    if (continuation.type === 'myriadLandscape') {
      if (continuation.librarySearchRequest) e.libraryOps.finishPreparedSearch(continuation.librarySearchRequest, cardInstanceIds.slice(0,2));
      else {
        const selected = cardInstanceIds.map(id => ZoneManager.find(s,id)).filter(found => found?.zone === 'library' && found.player?.id === pid);
        for (const found of selected.slice(0,2)) {
          const card = e._moveZoneNow(found.card, 'battlefield', pid);
          card.tapped = true;
          card.createdTurn = s.turn;
          card.controlledSinceTurn = s.turn;
          e.emit(EVENT.ENTER_BATTLEFIELD, { controller: pid, target: card });
        }
        e.shuffleLibrary(pid, 'library-search');
      }
      return;
    }
    if (continuation.type === 'searchLand') {
      const id = cardInstanceIds[0] || null;
      if (!id) {
        e.shuffleLibrary(pid, 'library-search');
        return;
      }
      const found = ZoneManager.find(s, id);
      if (!found || found.zone !== 'library' || found.player?.id !== pid) {
        e.shuffleLibrary(pid, 'library-search');
        return;
      }
      const definition = e.db[found.card.cardId] || {};
      const landTypes = continuation.landTypes || [];
      const legal = isType(definition, 'Land')
        && (!continuation.basicOnly || isType(definition, 'Basic Land'))
        && (!landTypes.length || landTypes.some(type => hasSubtype(definition, type)));
      if (!legal) {
        e.shuffleLibrary(pid, 'library-search');
        return;
      }
      if ((continuation.destination || 'battlefield') === 'hand') {
        e._moveZoneNow(found.card, 'hand', pid);
        e.shuffleLibrary(pid, 'library-search');
        return;
      }
      e._beginPutLandEffect(pid, id, {
        tapped: !!continuation.tapped,
        sourceZone: 'library',
        shuffleAfter: true,
        resume: this._choiceResume()
      });
      return;
    }
  }

  queueSpellCopies(originalItem, count = 1, controller = originalItem?.controller, { retargetAllowed = false } = {}) {
    if (!originalItem || count <= 0) return [];
    return this.engine.events.dispatch(ENGINE_EVENT.COPY, {
      originalItem,
      count,
      controller,
      retargetAllowed,
      source: originalItem.card || originalItem.source || null
    }, { cause: originalItem.type === 'spell' ? 'copy-spell' : 'copy-ability', stabilize: false });
  }

  _queueSpellCopiesNow(originalItem, count = 1, controller = originalItem?.controller, { retargetAllowed = false } = {}) {
    const e = this.engine, s = e.state;
    if (!originalItem || count <= 0) return [];
    s.pendingSpellCopies = s.pendingSpellCopies || [];
    const created = e.copy.createStackCopies(originalItem, { count, controller, retargetAllowed });
    s.pendingSpellCopies.push(...created);
    this._continueSpellCopyQueue();
    return created;
  }

  _continueSpellCopyQueue() {
    const e = this.engine, s = e.state;
    if (s.pendingChoice) return;
    const copyItem = s.pendingSpellCopies?.shift();
    if (!copyItem) {
      delete s.pendingSpellCopies;
      return;
    }
    const definition = copyItem.card ? (e.copy?.definitionForObject(copyItem.card) || e.db[copyItem.card.cardId] || {}) : {};
    const targetSource = copyItem.type === 'spell'
      ? e.targetSourceForAction({ mode: copyItem.mode }, definition)
      : (copyItem.ability || copyItem.targetSource || null);
    if (copyItem.copyMetadata?.retargetAllowed && e.targeting.hasTargets(targetSource) && (copyItem.targets || []).length) {
      s.pendingChoice = {
        type: 'COPY_TARGETS',
        playerId: copyItem.controller,
        sourceName: definition.name || 'ability copy',
        copyItem,
        targetSource: structuredClone(targetSource),
        originalTargets: [...(copyItem.targets || [])],
        resume: this._choiceResume()
      };
      s.priorityPlayer = copyItem.controller;
      return;
    }
    e.stack.push({ ...copyItem, gameObjectId: copyItem.gameObjectId || undefined });
    this._continueSpellCopyQueue();
  }

  resolveCopyTargetChoice(choice, targetIds) {
    const e = this.engine, s = e.state;
    const item = structuredClone(choice.copyItem);
    item.targets = [...targetIds];
    const stacked = e.stack.push(item);
    this._continueSpellCopyQueue();
    return stacked;
  }

  resolveHideawayChoice(choice, cardInstanceId) {
    const e = this.engine, s = e.state, p = s.players[choice.playerId];
    const topIds = new Set(choice.candidateIds || []);
    const selected = cardInstanceId && topIds.has(cardInstanceId) ? ZoneManager.find(s, cardInstanceId)?.card : null;
    const cards = p.library.filter(card => topIds.has(card.instanceId));
    for (const card of cards) e.lookAtCard(choice.playerId, card, { reason: 'hideaway-look' });
    if (selected) {
      const remaining = shuffle(cards.filter(card => card.instanceId !== selected.instanceId), e.rng);
      e._moveZoneNow(selected, 'exile', choice.playerId, { reason: 'hideaway-exile' });
      selected.exiledBy = choice.sourceId;
      selected.faceDown = true;
      if (selected.faceState) selected.faceState.faceUp = false;
      e.knownInformation.look(choice.playerId, selected, { reason: 'hideaway-exile' });
      for (const card of remaining) e.zones.moveWithinZone(choice.playerId, 'library', card.instanceId, p.library.length - 1);
    } else {
      for (const card of shuffle(cards, e.rng)) e.zones.moveWithinZone(choice.playerId, 'library', card.instanceId, p.library.length - 1);
    }
  }

  chooseExplore(pid, putInGraveyard) {
    const choice = this.engine.state.pendingChoice;
    if (!choice || choice.type !== 'EXPLORE_NONLAND' || choice.playerId !== pid) throw new Error('No explore choice is pending');
    const player = this.engine.state.players[pid];
    const top = player.library[0];
    if (!top || top.instanceId !== choice.cardInstanceId) throw new Error('The revealed explore card is no longer on top of the library');
    this.engine.state.pendingChoice = null;
    if (putInGraveyard) this.engine._moveZoneNow(top, 'graveyard', top.owner);
    this.resumeDeferred();
    return !!putInGraveyard;
  }

  _exploreOnce(target) {
    if (!target) return false;
    const liveTarget = this.engine.findPermanent(target.instanceId);
    if (!liveTarget || liveTarget.controller !== target.controller || !this.engine.static.isType(liveTarget, 'Creature')) return false;
    const p = this.engine.state.players[liveTarget.controller];
    const top = p.library[0];

    if (!top) {
      this.addCounters(liveTarget.controller, liveTarget, '+1/+1', 1);
      this.engine.emit(EVENT.EXPLORED, { controller: liveTarget.controller, target: liveTarget, object: liveTarget, revealedLand: false, revealedCard: null });
      return true;
    }

    const d = this.engine.db[top.cardId];
    if (isType(d, 'Land')) {
      this.engine._moveZoneNow(top, 'hand', liveTarget.controller);
      this.engine.emit(EVENT.EXPLORED, { controller: liveTarget.controller, target: liveTarget, object: liveTarget, revealedLand: true, revealedCard: top });
      return true;
    }

    this.engine.state.deferredExploreChoice = {
      playerId: liveTarget.controller,
      permanentId: liveTarget.instanceId,
      cardInstanceId: top.instanceId,
      cardId: top.cardId,
      cardName: d?.name || top.cardId,
      resume: this._choiceResume()
    };
    this.addCounters(liveTarget.controller, liveTarget, '+1/+1', 1);
    this.engine.emit(EVENT.EXPLORED, { controller: liveTarget.controller, target: liveTarget, object: liveTarget, revealedLand: false, revealedCard: top });
    this._openDeferredExploreChoice();
    return true;
  }

  explore(target) {
    if (!target) return false;
    const live = this.engine.findPermanent(target.instanceId);
    if (!live) return false;
    const trackerCount = this.engine.state.players[live.controller].battlefield.filter(card => card.cardId === 'lcc-topography-tracker' && !card.phasedOut).length;
    const times = trackerCount > 0 ? 2 : 1;
    this.engine.state.pendingExploreRepeats = Math.max(0, times - 1);
    this.engine.state.pendingExploreRepeatTarget = live.instanceId;
    const result = this._exploreOnce(live);
    if (!this.engine.state.pendingChoice) this._continueExploreRepeats();
    return result;
  }

  _continueExploreRepeats() {
    const state = this.engine.state;
    while (!state.pendingChoice && Number(state.pendingExploreRepeats || 0) > 0) {
      state.pendingExploreRepeats -= 1;
      const target = this.engine.findPermanent(state.pendingExploreRepeatTarget);
      if (target) this._exploreOnce(target);
    }
    if (!state.pendingChoice && !state.pendingExploreRepeats) {
      delete state.pendingExploreRepeats;
      delete state.pendingExploreRepeatTarget;
    }
  }
}
