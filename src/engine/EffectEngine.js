import { makeCardInstance } from './GameState.js';
import { ReplacementEngine } from './ReplacementEngine.js';
import { ZoneManager } from './ZoneManager.js';
import { EVENT } from './constants.js';
import { isType, shuffle, hasSubtype } from './utils.js';
import { canonicalTokenDefinition } from './TokenDefinitions.js';

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

  resolve(effect, ctx = {}) {
    if (!effect) return;
    const e = this.engine, s = e.state, pid = effect.player || ctx.controller || s.activePlayer, p = s.players[pid];
    switch (effect.type) {
      case 'sequence':
        for (const child of effect.effects || []) { this.resolve(child, ctx); if (s.pendingChoice) break; }
        break;
      case 'draw':
        for (let i = 0; i < this._amount(effect, ctx, 1); i++) e.draw(pid);
        break;
      case 'drawDiscard': {
        const draw = this._amount({ amount: effect.draw || 1 }, ctx, 1);
        for (let i = 0; i < draw; i++) e.draw(pid);
        const count = Number(effect.discard || 1);
        if (count > 0 && p.hand.length) this._openCardChoice(pid, p.hand.map(c => c.instanceId), { min: Math.min(count,p.hand.length), max: Math.min(count,p.hand.length), prompt: 'Choose card(s) to discard', continuation: { type: 'discardChosen' } });
        break;
      }
      case 'gainLife': e.changeLife(pid, effect.amount || 1); break;
      case 'gainLifeTarget': {
        for (const targetPid of ctx.targets || []) if (s.players[targetPid]) e.changeLife(targetPid, effect.amount || 1);
        break;
      }
      case 'preventDamage': {
        for (const id of ctx.targets || []) {
          const target = s.players[id] || e.findPermanent(id);
          if (target) target.damagePrevention = (target.damagePrevention || 0) + (effect.amount || 1);
        }
        break;
      }
      case 'loseLife': e.changeLife(pid, -(effect.amount || 1)); break;
      case 'damage': {
        for (const id of ctx.targets || []) {
          if (s.players[id]) e.dealDamageToPlayer(id, effect.amount || 1, ctx.source);
          else {
            const permanent = e.findPermanent(id);
            if (permanent) e.dealDamageToPermanent(permanent, effect.amount || 1, ctx.source);
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
      case 'createToken': this.createToken(pid, effect.token, effect.amount || 1); break;
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
        for (const opponentId of Object.keys(s.players).filter(id => id !== pid)) {
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
        const targets = ctx.targeted ? this._permanentTargets(ctx) : ((ctx.targets || []).length ? this._permanentTargets(ctx) : e.selectPermanents(pid, effect.filter || {}, ctx));
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
          const [item] = s.stack.splice(found.index, 1);
          if (item?.card) ZoneManager.place(s, item.card, 'graveyard', item.card.owner);
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
        for (const owner of owners) s.players[owner].library = shuffle(s.players[owner].library, e.rng);
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
          source.counters[type] -= 1; if (source.counters[type] <= 0) delete source.counters[type];
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
          e.changeController(target.instanceId, pid);
          if (effect.attachIfEquipment && isType(e.db[target.cardId], 'Equipment')) target.attachedTo = ctx.source?.instanceId || null;
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
        const eligibleIds = p.library.filter(card => isType(e.db[card.cardId], 'Basic Land')).map(card => card.instanceId);
        s.pendingChoice = {
          type: 'CULTIVATE_SEARCH',
          playerId: pid,
          eligibleIds,
          max: 2,
          resume: this._choiceResume()
        };
        s.priorityPlayer = pid;
        break;
      }
      case 'sisayTutor': {
        const source = ctx.source?.instanceId ? e.findPermanent(ctx.source.instanceId) : null;
        const sourcePower = source ? e.static.derivedStats(source).power : Number(ctx.sourcePowerAtActivation || 0);
        const eligibleIds = p.library.filter(card => {
          const definition = e.db[card.cardId];
          if (!definition || !isType(definition, 'Legendary')) return false;
          if (isType(definition, 'Instant') || isType(definition, 'Sorcery')) return false;
          return Number(definition.manaValue || 0) < sourcePower;
        }).map(card => card.instanceId);
        s.pendingChoice = {
          type: 'SISAY_TUTOR',
          playerId: pid,
          eligibleIds,
          sourcePower,
          resume: this._choiceResume()
        };
        s.priorityPlayer = pid;
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
          s.players[e.opponent(pid)].lost = true;
        }
        break;
      }
      case 'commit': {
        for (const id of ctx.targets || []) {
          const found = ZoneManager.find(s, id);
          if (!found) continue;
          let card = found.card;
          if (found.zone === 'stack') {
            const [item] = s.stack.splice(found.index, 1);
            card = item.card;
            ZoneManager.place(s, card, 'library', card.owner);
          } else {
            e.moveToZone(card, 'library', card.owner);
          }
          const library = s.players[card.owner].library;
          const index = library.findIndex(x => x.instanceId === card.instanceId);
          if (index >= 0) {
            const [moved] = library.splice(index,1);
            library.splice(Math.min(1, library.length), 0, moved);
          }
        }
        break;
      }
      case 'counterSpell': {
        for (const id of ctx.targets || []) {
          const found = ZoneManager.find(s, id);
          if (found?.zone !== 'stack') continue;
          const [item] = s.stack.splice(found.index, 1);
          if (item?.card) ZoneManager.place(s, item.card, 'graveyard', item.card.owner);
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
        for (const owner of byOwner.keys()) s.players[owner].library = shuffle(s.players[owner].library, e.rng);
        break;
      }
      case 'memory': {
        for (const [playerId, player] of Object.entries(s.players)) {
          const all = [...player.hand, ...player.graveyard];
          player.hand = [];
          player.graveyard = [];
          for (const card of all) ZoneManager.place(s, card, 'library', playerId);
          player.library = shuffle(player.library, e.rng);
        }
        for (const playerId of Object.keys(s.players)) e.draw(playerId, 7);
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
        if (stackItem) this.queueSpellCopies(stackItem, Number(effect.copies || 1), pid);
        break;
      }
      case 'copySpellByInstance': {
        const instanceId = effect.spellInstanceId || ctx.source?.instanceId;
        const stackItem = s.stack.find(item => item.card?.instanceId === instanceId);
        if (stackItem) this.queueSpellCopies(stackItem, Number(effect.copies || 1), pid);
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
        const basics = p.library.filter(card => isType(e.db[card.cardId], 'Basic Land')).map(card => card.instanceId);
        this._openCardChoice(pid, basics, { min: 0, max: Math.min(2, basics.length), prompt: 'Choose up to two basic lands sharing a land type', continuation: { type: 'myriadLandscape' } });
        break;
      }
      case 'cantBeBlocked': {
        for (const target of this._permanentTargets(ctx)) {
          if (!target.modifiers.keywords.includes('unblockable')) target.modifiers.keywords.push('unblockable');
        }
        break;
      }
      case 'searchBasic': {
        const i = p.library.findIndex(c => isType(e.db[c.cardId], 'Basic Land'));
        if (i >= 0) {
          const [c] = p.library.splice(i, 1);
          ZoneManager.place(s, c, effect.destination || 'hand', pid);
        }
        break;
      }
      case 'sacrifice': {
        const t = e.selectPermanents(pid, effect.filter || {}, ctx)[0];
        if (t) e.sacrifice(t);
        break;
      }
    }
  }

  _choiceResume() {
    return this.engine.state.phase === 'CLEANUP' ? 'CLEANUP' : 'PRIORITY';
  }

  _commitCounters(pid, permanent, type, amount) {
    if (!permanent || amount <= 0) return 0;
    permanent.counters[type] = (permanent.counters[type] || 0) + amount;
    this.engine.emit(EVENT.COUNTERS_ADDED, { controller: pid, target: permanent, counterType: type, amount });
    return amount;
  }

  addCounters(pid, permanent, type, amount, { replacementOrder = null } = {}) {
    if (!permanent || amount <= 0) return 0;
    const state = this.engine.state;
    const affectedPlayerId = permanent.controller || pid;
    const replacements = ReplacementEngine.counterReplacements(state, this.engine.db, affectedPlayerId, permanent, type);
    if (replacements.length > 1 && !replacementOrder) {
      if (state.pendingChoice) throw new Error('Cannot start a replacement-order choice while another choice is pending');
      state.pendingChoice = {
        type: 'REPLACEMENT_ORDER',
        playerId: affectedPlayerId,
        permanentId: permanent.instanceId,
        counterType: type,
        amount,
        replacementIds: replacements.map(replacement => replacement.id),
        replacements: replacements.map(replacement => ({ id: replacement.id, sourceName: replacement.sourceName, effect: replacement.effect })),
        resume: this._choiceResume()
      };
      state.priorityPlayer = affectedPlayerId;
      return 0;
    }
    const n = ReplacementEngine.applyCounterReplacements(amount, replacements, replacementOrder);
    return this._commitCounters(affectedPlayerId, permanent, type, n);
  }

  resolveCounterReplacementChoice(choice, orderIds) {
    const state = this.engine.state;
    const permanent = this.engine.findPermanent(choice.permanentId);
    state.pendingChoice = null;
    if (permanent) {
      const replacements = ReplacementEngine.counterReplacements(state, this.engine.db, permanent.controller, permanent, choice.counterType);
      const currentIds = new Set(replacements.map(replacement => replacement.id));
      const survivingOrder = orderIds.filter(id => currentIds.has(id));
      const remaining = replacements.filter(replacement => !survivingOrder.includes(replacement.id)).map(replacement => replacement.id);
      const finalOrder = [...survivingOrder, ...remaining];
      const n = ReplacementEngine.applyCounterReplacements(choice.amount, replacements, finalOrder);
      this._commitCounters(permanent.controller, permanent, choice.counterType, n);
    }
    this.resumeDeferred();
    return true;
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
    this._continueProliferate();
  }

  proliferateCandidates() {
    const out = [];
    for (const [playerId, player] of Object.entries(this.engine.state.players)) {
      if (Object.values(player.counters || {}).some(value => value > 0)) out.push(playerId);
      for (const permanent of player.battlefield) {
        if (Object.values(permanent.counters || {}).some(value => value > 0)) out.push(permanent.instanceId);
      }
    }
    return out;
  }

  beginProliferate(pid, after = null) {
    const eligibleIds = this.proliferateCandidates();
    const continuation = after ? { ...structuredClone(after), controller: after.controller || pid } : null;
    this.engine.state.pendingChoice = {
      type: 'PROLIFERATE',
      playerId: pid,
      eligibleIds,
      after: continuation,
      resume: this._choiceResume()
    };
    this.engine.state.priorityPlayer = pid;
    return eligibleIds;
  }

  chooseProliferate(pid, targetIds) {
    const choice = this.engine.state.pendingChoice;
    if (!choice || choice.type !== 'PROLIFERATE' || choice.playerId !== pid) throw new Error('No proliferate choice is pending');
    this.engine.state.pendingChoice = null;
    this.engine.state.lastProliferatedIds = [...targetIds];
    this.engine.state.afterProliferate = choice.after ? structuredClone(choice.after) : null;
    const queue = [];
    for (const id of targetIds) {
      const player = this.engine.state.players[id];
      if (player) {
        for (const type of Object.keys(player.counters || {}).filter(type => player.counters[type] > 0)) queue.push({ kind: 'player', playerId: id, counterType: type });
        continue;
      }
      const permanent = this.engine.findPermanent(id);
      if (!permanent) continue;
      for (const type of Object.keys(permanent.counters || {}).filter(type => permanent.counters[type] > 0)) queue.push({ kind: 'permanent', permanentId: id, counterType: type });
    }
    this.engine.state.pendingProliferateQueue = queue;
    this._continueProliferate();
    return targetIds;
  }

  _continueProliferate() {
    const state = this.engine.state;
    const queue = state.pendingProliferateQueue;
    if (!queue) return;
    while (queue.length && !state.pendingChoice) {
      const item = queue.shift();
      if (item.kind === 'player') {
        const player = state.players[item.playerId];
        if (player?.counters?.[item.counterType] > 0) player.counters[item.counterType] += 1;
      } else {
        const permanent = this.engine.findPermanent(item.permanentId);
        if (permanent?.counters?.[item.counterType] > 0) this.addCounters(permanent.controller, permanent, item.counterType, 1);
      }
    }
    if (!queue.length && !state.pendingChoice) {
      delete state.pendingProliferateQueue;
      const after = state.afterProliferate;
      delete state.afterProliferate;
      if (after?.type === 'phaseOutProliferated') {
        const controller = after.player || after.controller || state.priorityPlayer || state.activePlayer;
        const eligibleIds = (state.lastProliferatedIds || []).filter(id => {
          const permanent = this.engine.findPermanent(id);
          return permanent?.controller === controller;
        });
        delete state.lastProliferatedIds;
        if (eligibleIds.length) {
          state.pendingChoice = {
            type: 'PHASE_OUT_PROLIFERATED',
            playerId: controller,
            eligibleIds,
            resume: this._choiceResume()
          };
          state.priorityPlayer = controller;
          return;
        }
      } else if (after) this.resolve(after, { controller: state.priorityPlayer || state.activePlayer });
      delete state.lastProliferatedIds;
    }
  }

  createToken(pid, token, amount) {
    const normalized = canonicalTokenDefinition(token);
    const mod = ReplacementEngine.modifyTokenAmount(this.engine.state, this.engine.db, pid, normalized.name, amount);
    if (typeof mod === 'object' && mod.manufactor) {
      for (const name of ['Treasure', 'Food', 'Clue']) this.createTokenRaw(pid, canonicalTokenDefinition({ name }), mod.manufactor);
      return;
    }
    this.createTokenRaw(pid, normalized, mod);
  }

  createTokenRaw(pid, token, amount = 1) {
    const normalized = canonicalTokenDefinition(token);
    const count = Math.max(0, Number(amount) || 0);
    const id = `token:${normalized.name}`;
    // Token definitions are runtime rules data. Re-assigning here upgrades an
    // earlier placeholder definition instead of preserving empty abilities.
    this.engine.db[id] = {
      id,
      name: normalized.name,
      typeLine: normalized.typeLine || 'Token Creature',
      power: normalized.power ?? 0,
      toughness: normalized.toughness ?? 0,
      colors: normalized.colors || [],
      keywords: normalized.keywords || [],
      subtypes: normalized.subtypes || [],
      abilities: structuredClone(normalized.abilities || []),
      spellEffects: []
    };

    const created = [];
    for (let i = 0; i < count; i++) {
      const c = makeCardInstance(id, pid, 'battlefield', {
        controller: pid,
        isToken: true,
        summoningSick: isType(this.engine.db[id], 'Creature'),
        createdTurn: this.engine.state.turn,
        controlledSinceTurn: this.engine.state.turn
      });
      this.engine.state.players[pid].battlefield.push(c);
      created.push(c);
      this.engine.emit(EVENT.TOKEN_CREATED, { controller: pid, target: c });
      this.engine.emit(EVENT.ENTER_BATTLEFIELD, { controller: pid, target: c });
    }
    return created;
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
          const card = e._moveZoneNow(found.card, 'graveyard', found.card.owner);
          e.emit(EVENT.CARD_DISCARDED, { controller: pid, card });
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
      const definition = e.db[found.card.cardId] || {};
      if (definition.asEntersChooseType && !found.card.chosenType) {
        s.pendingChoice = {
          type: 'CREATURE_TYPE', playerId: pid, cardInstanceId: found.card.instanceId, cardName: definition.name,
          options: e.creatureTypeOptions(pid), landEffect: { tapped: !!continuation.tapped }, resume: this._choiceResume()
        };
        s.priorityPlayer = pid;
        return;
      }
      if (definition.entersTappedUnless?.revealLandSubtypes && !found.card.entryRevealResolved) {
        const candidates = e._revealEntryCandidates(pid, definition, found.card.instanceId);
        if (candidates.length) {
          e._openEntryRevealChoice(pid, found.card, definition, { landEffect: { tapped: !!continuation.tapped } });
          return;
        }
        found.card.entryRevealResolved = true;
        found.card.entryRevealSucceeded = false;
      }
      e._finishPutLandEffect(pid, found.card.instanceId, { tapped: !!continuation.tapped });
      return;
    }
    if (continuation.type === 'myriadLandscape') {
      const selected = cardInstanceIds.map(id => ZoneManager.find(s,id)).filter(found => found?.zone === 'library' && found.player?.id === pid);
      for (const found of selected.slice(0,2)) {
        const card = e._moveZoneNow(found.card, 'battlefield', pid);
        card.tapped = true;
        card.createdTurn = s.turn;
        card.controlledSinceTurn = s.turn;
        e.emit(EVENT.ENTER_BATTLEFIELD, { controller: pid, target: card });
      }
      p.library = shuffle(p.library, e.rng);
      return;
    }
  }

  queueSpellCopies(originalItem, count = 1, controller = originalItem?.controller) {
    const s = this.engine.state;
    if (!originalItem?.card || count <= 0) return;
    s.pendingSpellCopies = s.pendingSpellCopies || [];
    for (let i = 0; i < count; i++) {
      const copyCard = structuredClone(originalItem.card);
      copyCard.instanceId = `copy-${originalItem.card.instanceId}-${Date.now()}-${Math.random()}-${i}`;
      copyCard.zone = 'stack';
      copyCard.isToken = false;
      const copyItem = {
        ...structuredClone(originalItem),
        id: `copy-stack-${Date.now()}-${Math.random()}-${i}`,
        controller,
        card: copyCard,
        isCopy: true,
        targets: [...(originalItem.targets || [])]
      };
      s.pendingSpellCopies.push(copyItem);
    }
    this._continueSpellCopyQueue();
  }

  _continueSpellCopyQueue() {
    const e = this.engine, s = e.state;
    if (s.pendingChoice) return;
    const copyItem = s.pendingSpellCopies?.shift();
    if (!copyItem) {
      delete s.pendingSpellCopies;
      return;
    }
    const definition = e.db[copyItem.card.cardId] || {};
    const targetSource = e.targetSourceForAction({ mode: copyItem.mode }, definition);
    if (e.targeting.hasTargets(targetSource) && (copyItem.targets || []).length) {
      s.pendingChoice = {
        type: 'COPY_TARGETS',
        playerId: copyItem.controller,
        sourceName: definition.name || 'spell copy',
        copyItem,
        targetSource: structuredClone(targetSource),
        originalTargets: [...(copyItem.targets || [])],
        resume: this._choiceResume()
      };
      s.priorityPlayer = copyItem.controller;
      return;
    }
    s.stack.push(copyItem);
    this._continueSpellCopyQueue();
  }

  resolveCopyTargetChoice(choice, targetIds) {
    const s = this.engine.state;
    const item = structuredClone(choice.copyItem);
    item.targets = [...targetIds];
    s.stack.push(item);
    this._continueSpellCopyQueue();
    return item;
  }

  resolveHideawayChoice(choice, cardInstanceId) {
    const e = this.engine, s = e.state, p = s.players[choice.playerId];
    const topIds = new Set(choice.candidateIds || []);
    const selected = cardInstanceId && topIds.has(cardInstanceId) ? ZoneManager.find(s, cardInstanceId)?.card : null;
    const cards = p.library.filter(card => topIds.has(card.instanceId));
    p.library = p.library.filter(card => !topIds.has(card.instanceId));
    if (selected) {
      const remaining = cards.filter(card => card.instanceId !== selected.instanceId);
      ZoneManager.place(s, selected, 'exile', choice.playerId);
      selected.exiledBy = choice.sourceId;
      selected.faceDown = true;
      p.library.push(...shuffle(remaining, e.rng));
    } else p.library.push(...shuffle(cards, e.rng));
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
      p.library.shift();
      ZoneManager.place(this.engine.state, top, 'hand', liveTarget.controller);
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
