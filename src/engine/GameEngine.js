import { createGameState, makeCardInstance } from './GameState.js';
import { EVENT } from './constants.js';
import { ManaEngine } from './ManaEngine.js';
import { ZoneManager } from './ZoneManager.js';
import { EffectEngine } from './EffectEngine.js';
import { TriggerEngine } from './TriggerEngine.js';
import { StaticEngine } from './StaticEngine.js';
import { CombatEngine } from './CombatEngine.js';
import { LegalActions } from './LegalActions.js';
import { TargetingEngine } from './TargetingEngine.js';
import { isType, hasSubtype, hasKeyword, currentUidSequence, setUidSequence } from './utils.js';
import { immutableClone } from './public/immutable.js';
import { GAME_ENGINE_API_VERSION } from './public/api.js';
import { getLegacyAdapterRegistry } from './compat/legacyAdapters.js';
import { getObjectCardDefinition, createCardFaceModel, setCurrentFace, setCastFace } from './state/CardFace.js';
import { serializeGameState, deserializeGameState } from './state/serialization.js';
import { EventDispatcher, ENGINE_EVENT } from './events/index.js';
import { TurnEngine } from './turn/TurnEngine.js';
import { StackService, PriorityManager, ResolutionPipeline, buildStackPriorityView } from './stack/index.js';
import { ChoiceService } from './choices/index.js';
import { ZoneService, HiddenInformationService, KnownInformationTracker, LastKnownInformationService, isPlayerZone } from './zones/index.js';
import { CostEngine, PaymentService, CostMechanicRegistry } from './costs/index.js';
import { ReplacementService, PreventionService } from './replacement/index.js';
import { ContinuousEffectEngine } from './continuous/index.js';
import { StateBasedActionEngine } from './sba/index.js';
import { CommanderRulesService, MultiplayerRelationService, PlayerEliminationService } from './multiplayer/index.js';
import { MechanicLibrary } from '../mechanics/index.js';
import { CardScriptService, CardSupportService } from '../cards/index.js';
import { LoopService, SimulationSafetyBudget, LOOP_SHORTCUT_ACTION } from './loops/index.js';
import { SeededRandom, PregameService } from './pregame/index.js';
import { LegalityService, LEGALITY_OPERATION } from './legality/index.js';
import { CopyService } from './copy/index.js';
import { AttachmentService } from './attachments/index.js';
import { CounterService } from './counters/index.js';
import { TokenService } from './tokens/index.js';
import { DamageService } from './damage/index.js';
import { LibraryOperationService } from './library/index.js';
import { TimingService } from './timing/index.js';
import { ReplayService, ReplayRunner } from './replay/index.js';
import { RulesLogger, InvariantChecker, UnsupportedInteractionService, UNSUPPORTED_INTERACTION_MODE } from './diagnostics/index.js';
import { PerformanceService } from './performance/index.js';
import { StrictRulesService } from './strict/index.js';
import { RulesVersionService, CURRENT_RULES_VERSION } from './rules-version/index.js';

const INTERNAL = Symbol('GameEngineInternal');

export class GameEngine {
  constructor(deckA, deckB, db, { rng = null, seed = null, startingPlayer = 'first', validateDecks = true, formatRules = {}, uidSequenceStart = null, rulesVersion = CURRENT_RULES_VERSION, cardDatabaseVersion = 'embedded-generated-db', invariantChecks = true, headless = false, performanceOptimizations = true, profilePerformance = false, cardSupportOptions = {}, allowPartialSimulationOverride = false, unsupportedInteractionMode = UNSUPPORTED_INTERACTION_MODE.STANDARD, strictRulesMode = null, simulationPurpose = 'gameplay', gameId = null } = {}) {
    this.initialDeckA = structuredClone(deckA);
    this.initialDeckB = structuredClone(deckB);
    this.initialDb = structuredClone(db);
    this._uidSequenceStart = uidSequenceStart == null ? currentUidSequence() : Number(uidSequenceStart || 0);
    if (uidSequenceStart != null) setUidSequence(this._uidSequenceStart);
    this.rulesVersion = rulesVersion || CURRENT_RULES_VERSION;
    this.rulesVersions = new RulesVersionService({ currentVersion: this.rulesVersion });
    this.cardDatabaseVersion = cardDatabaseVersion;
    this.gameId = gameId || `game:${String(seed ?? 'unseeded')}:${String(rulesVersion || 'rules')}`;
    this.simulationPurpose = String(simulationPurpose || 'gameplay');
    this._randomConfig = { seed, rng };
    this.random = new SeededRandom({ seed, rng });
    this.rng = () => this.random.next();
    this._pregameConfig = { startingPlayer, validateDecks, formatRules: structuredClone(formatRules) };
    // Step 17: resolve every printing through an Oracle-identity rules
    // implementation before Step 16 compiles scripts. Printing metadata stays
    // distinct while rules behavior is shared by Oracle identity.
    this.cardSupport = new CardSupportService(db, cardSupportOptions);
    // Step 42: strict rules mode is an operating guarantee, not merely a UI
    // toggle. Requesting it forces the Step 41 unsupported-interaction policy
    // into fail-closed strict mode before any authoritative game state exists.
    const strictRulesRequested = strictRulesMode === true
      || (!!strictRulesMode && typeof strictRulesMode === 'object' && strictRulesMode.enabled !== false)
      || unsupportedInteractionMode === UNSUPPORTED_INTERACTION_MODE.STRICT;
    const effectiveUnsupportedMode = strictRulesRequested
      ? UNSUPPORTED_INTERACTION_MODE.STRICT
      : unsupportedInteractionMode;
    this._strictRulesConfigInput = strictRulesMode && typeof strictRulesMode === 'object'
      ? structuredClone(strictRulesMode)
      : { enabled: strictRulesRequested };
    this._strictRulesConfigInput.enabled = strictRulesRequested;
    // Step 41: unsupported interactions are centralized before state creation.
    // Strict support preflight can therefore reject a deck before any shuffle,
    // cost payment, zone mutation, or other irreversible game action occurs.
    this.unsupported = new UnsupportedInteractionService(this, {
      mode: effectiveUnsupportedMode,
      simulationPurpose: this.simulationPurpose,
      allowPartialSimulationOverride
    });
    const initialDecks = [deckA, ...(Array.isArray(deckB) ? deckB : [deckB])].filter(Boolean);
    const simulationRequiresCertifiedSupport = /official|benchmark/i.test(this.simulationPurpose);
    if (this.unsupported.isStrict() || (simulationRequiresCertifiedSupport && !allowPartialSimulationOverride)) {
      this.unsupported.preflightDecks(initialDecks, { requireStrict: true, purpose: this.simulationPurpose });
    }
    const oraclePreparedDb = this.cardSupport.prepareDatabase(db);
    // Step 16: scripts are validated and compiled into the same declarative
    // ability/effect structures consumed by the authoritative engine before
    // any game object is created. Invalid scripts therefore fail at load time.
    this.cardScripts = new CardScriptService(this);
    this.db = this.cardScripts.compileDatabase(oraclePreparedDb);
    this.state = createGameState(deckA, deckB, this.db, this.rng);
    // Step 38: performance services own non-authoritative caches/profiling.
    // Cache revision metadata never enters GameState/replay hashes, so optimizations
    // can be enabled or disabled without changing rules results.
    this.headless = !!headless;
    this.performance = new PerformanceService(this, { enabled: performanceOptimizations, profiling: profilePerformance });
    // Step 19: loop/safety services are engine-owned and observe only the
    // authoritative state/action/event stream. They never let UI/AI mutate state.
    this.safety = new SimulationSafetyBudget(this);
    this.loops = new LoopService(this);
    this.pregameRules = new PregameService(this, this._pregameConfig);
    this.multiplayer = new MultiplayerRelationService(this);
    // Step 21: all permission/restriction/requirement checks are centralized
    // here so UI and AI consume the same authoritative legality decisions.
    this.legality = new LegalityService(this);
    // Step 22: copy/copiable-value rules are engine-owned and remain separate
    // from both immutable physical-card identity and later continuous effects.
    this.copy = new CopyService(this);
    this.commanders = new CommanderRulesService(this);
    this.mechanics = new MechanicLibrary(this);
    this.mana = ManaEngine;
    this.costMechanics = new CostMechanicRegistry();
    this.costs = new CostEngine(this, this.costMechanics);
    this.payments = new PaymentService(this);
    this.effects = new EffectEngine(this);
    this.events = new EventDispatcher(this);
    this.replacements = new ReplacementService(this);
    this.prevention = new PreventionService(this);
    // Replacement effects transform events first; prevention then consumes the
    // final damage event. This ordering is explicit and covered by Step 10 tests.
    this.events.addTransformer((event) => this.replacements.transformEvent(event));
    this.events.addTransformer((event) => this.prevention.transformEvent(event));
    this.triggers = new TriggerEngine(this);
    this.continuous = new ContinuousEffectEngine(this);
    this.static = new StaticEngine(this);
    // Step 28: timing legality is a first-class rules subsystem. Every cast,
    // activation and supported special action consults this service before
    // costs are paid or authoritative state is changed.
    this.timing = new TimingService(this);
    // Step 24: generic counters are an engine-owned subsystem. All counter
    // placement/removal routes through ADD_COUNTER/REMOVE_COUNTER events.
    this.counters = new CounterService(this);
    // Step 26: every combat/noncombat damage event now uses one metadata-rich
    // service after replacement/prevention and before recipient consequences.
    this.damage = new DamageService(this);
    // Step 25: token definitions/generated objects are authoritative and share
    // the universal CREATE_TOKEN replacement/event path.
    this.tokens = new TokenService(this);
    // Step 23: authoritative attachment relationships sit beside zones/layers/SBAs.
    // Card.attachedTo remains a compatibility projection, never the source of truth.
    this.attachments = new AttachmentService(this);
    this.sba = new StateBasedActionEngine(this);
    this.stack = new StackService(this);
    this.zones = new ZoneService(this);
    this.elimination = new PlayerEliminationService(this);
    this.lki = new LastKnownInformationService(this);
    this.knownInformation = new KnownInformationTracker(this);
    this.hiddenInformation = new HiddenInformationService(this);
    // Step 27: searching and top-of-library manipulation are centralized so
    // hidden information, search restrictions and shuffle semantics share one path.
    this.libraryOps = new LibraryOperationService(this);
    this._registerCoreEventHandlers();
    this.combat = new CombatEngine(this, INTERNAL);
    this.turn = new TurnEngine(this, INTERNAL);
    this.priority = new PriorityManager(this, INTERNAL);
    this.resolution = new ResolutionPipeline(this);
    this.targeting = new TargetingEngine(this);
    this.choices = new ChoiceService(this);
    this.legal = new LegalActions(this);
    // Step 30: deterministic replay/checkpoint service owns state hashes and
    // reproducibility metadata. Rules code still mutates only through GameEngine.
    this.replay = new ReplayService(this);
    // Step 31: structured player/developer/verbose rules logging observes the
    // authoritative event stream and action lifecycle without mutating state.
    this.logger = new RulesLogger(this, { enabled: !this.headless });
    // Step 32: runtime invariants detect impossible authoritative states at
    // stable action/transaction boundaries and retain a reproduction bundle.
    this.invariants = new InvariantChecker(this, { enabled: invariantChecks });
    this._runtimeIdSequence = 0;
    this._triggerDeferral = 0;
    this._replayActions = [];
    this._actionSequence = 0;
    // Step 29: AI strategy decisions are replay metadata only. They never
    // mutate authoritative game state, but recording them makes seeded/stable
    // AI runs inspectable and reproducible alongside action replays.
    this._aiDecisions = [];
    this._aiDecisionSequence = 0;
    this._activeActionContext = null;
    this._databaseRevision = 0;
    this._publicDatabaseSnapshot = null;
    this._publicDatabaseSnapshotRevision = -1;
    // Step 42: consolidate all strict guarantees, startup checks, developer-tool
    // locks and simulation certification metadata in one engine-owned service.
    this.strictRules = new StrictRulesService(this, this._strictRulesConfigInput);
    this.strictRules.preflight(initialDecks, { phase: 'constructor', throwOnFailure: this.strictRules.isEnabled() });
  }

  _registerCoreEventHandlers() {
    const requirePlayer = (playerId, engine) => {
      const player = engine.state.players[playerId];
      if (!player) throw new Error(`Unknown player ${playerId}`);
      return player;
    };
    const requirePermanent = (ref, engine) => {
      const id = typeof ref === 'string' ? ref : (ref?.instanceId || ref?.gameObjectId);
      const permanent = id ? engine.findPermanent(id) : null;
      if (!permanent) throw new Error('Permanent is no longer on the battlefield');
      return permanent;
    };
    const requireObject = (ref, engine) => {
      const object = engine._queryObject(ref);
      if (!object) throw new Error('Game object is no longer available');
      return object;
    };

    this.events.register(ENGINE_EVENT.MOVE_ZONE, {
      validate: event => {
        const { cardRef, cardInstanceId, toZone, toPlayerId } = event.payload;
        const ref = cardInstanceId || cardRef?.instanceId || cardRef?.gameObjectId || cardRef;
        const found = this.zones.find(ref);
        if (!found && !(cardRef && typeof cardRef === 'object' && (event.payload.detached || event.payload.fromZone))) {
          throw new Error('Object is no longer in a game zone');
        }
        if (!isPlayerZone(toZone)) throw new Error(`Unsupported destination zone ${toZone}`);
        if (toPlayerId && !this.state.players[toPlayerId]) throw new Error(`Unknown destination player ${toPlayerId}`);
      },
      commit: event => {
        const { cardRef, cardInstanceId, toZone, toPlayerId } = event.payload;
        const ref = cardInstanceId || cardRef?.instanceId || cardRef?.gameObjectId || cardRef;
        const found = this.zones.find(ref);
        const sourceCard = found?.card || cardRef;
        const oldZone = found?.zone || event.payload.fromZone || sourceCard?.zone || null;
        const oldController = sourceCard?.controller || sourceCard?.owner || null;
        const oldOwner = sourceCard?.owner || null;
        const oldGameObjectId = sourceCard?.gameObjectId || null;
        const reason = event.payload.reason || event.provenance?.cause || 'zone-change';
        const lki = sourceCard ? this.lki.capture(sourceCard, { reason, eventId: event.eventId, fromZone: oldZone }) : null;

        if (oldZone === 'battlefield' && sourceCard) this.attachments?.onWillLeaveBattlefield(sourceCard);

        let moved;
        if (found?.zone === 'stack') {
          const stackItem = this.stack.remove(found.stackItem?.id || found.stackItem?.gameObjectId || ref);
          // A spell copy is not a physical card and cannot become a card in a
          // non-stack zone. Removing it from the stack is the entire move.
          moved = stackItem?.isCopy
            ? null
            : this.zones.place(stackItem?.card || sourceCard, toZone, toPlayerId, { index: event.payload.destinationIndex ?? null });
        } else {
          moved = found
            ? this.zones.move(ref, toZone, toPlayerId, { index: event.payload.destinationIndex ?? null })
            : this.zones.place(sourceCard, toZone, toPlayerId, { index: event.payload.destinationIndex ?? null });
        }

        event.payload.fromZone = oldZone;
        event.payload.owner = oldOwner;
        event.payload.previousController = oldController;
        event.payload.previousGameObjectId = oldGameObjectId;
        event.payload.newGameObjectId = moved?.gameObjectId || null;
        event.payload.zoneChangeId = moved?.zoneChangeId ?? sourceCard?.zoneChangeId ?? null;
        event.payload.lkiId = lki?.lkiId || null;

        if (moved) {
          this.knownInformation.onZoneChange(moved, {
            fromZone: oldZone,
            toZone,
            reason,
            knownTo: event.payload.knownTo || [],
            publicReveal: !!event.payload.publicReveal,
            position: event.payload.position || null
          });
        }

        // Step 10 entry replacements are applied before the permanent is
        // observed by enter-the-battlefield triggers. The MOVE_ZONE replacement
        // pipeline writes declarative entryState rather than mutating the object
        // from card/UI code.
        if (moved && toZone === 'battlefield' && event.payload.entryState) {
          const entryState = event.payload.entryState;
          if (entryState.tapped === true) moved.tapped = true;
          for (const counter of entryState.counters || []) {
            const amount = Math.max(0, Number(counter.amount || 0));
            if (amount > 0) this.events.dispatch(ENGINE_EVENT.ADD_COUNTER, {
              playerId: moved.controller || moved.owner,
              permanentId: moved.instanceId,
              counterType: counter.type || '+1/+1',
              amount
            }, { cause: 'entry-replacement-counter', stabilize: false });
          }
        }

        if (moved && toZone === 'battlefield') this.counters.ensureEntryCounters(moved);

        if (moved && toZone === 'battlefield' && event.payload.attachmentTargetId) {
          this.events.dispatch(ENGINE_EVENT.ATTACH, {
            attachedId: moved.instanceId, hostId: event.payload.attachmentTargetId,
            reason: event.payload.attachmentReason || reason || 'entry-attach',
            attachmentType: this.attachments.kind(moved),
            legalHostFilter: this.attachments.legalHostFilter(moved)
          }, { cause: event.payload.attachmentReason || reason || 'entry-attach', stabilize: false });
        }

        if (moved && oldZone === 'battlefield' && lki?.object) {
          this.emit(EVENT.LEAVE_BATTLEFIELD, {
            controller: oldController,
            owner: oldOwner,
            target: moved,
            card: moved,
            object: structuredClone(lki.object),
            lkiId: lki.lkiId,
            fromZone: oldZone,
            toZone
          });
        }
        this.lki.prune();
        return moved;
      }
    });

    this.events.register(ENGINE_EVENT.DRAW_CARD, {
      validate: event => requirePlayer(event.payload.playerId, this),
      commit: event => {
        const pid = event.payload.playerId;
        const player = this.state.players[pid];
        // Opening-hand draws happen before normal turn rules begin and must not
        // consume per-turn draw allowances such as Spirit of the Labyrinth.
        if (this.state.gameBegun && this.legality && !this.legality.allowsOperation(LEGALITY_OPERATION.DRAW, pid, { metadata: event.payload })) {
          this.log('RULE_OPERATION_PREVENTED', { operation: LEGALITY_OPERATION.DRAW, playerId: pid });
          return null;
        }
        const top = player.library[0];
        if (!top) {
          player.drewFromEmptyLibrary = true;
          this.log('EMPTY_LIBRARY_DRAW', { playerId: pid });
          return null;
        }
        const card = this.events.dispatch(ENGINE_EVENT.MOVE_ZONE, {
          cardInstanceId: top.instanceId,
          toZone: 'hand',
          toPlayerId: pid,
          reason: 'draw'
        }, { cause: 'draw', stabilize: false });
        const drawNumber = (this.state.cardsDrawnThisTurn[pid] || 0) + 1;
        this.state.cardsDrawnThisTurn[pid] = drawNumber;
        this.emit(EVENT.CARD_DRAWN, {
          controller: pid,
          card,
          drawNumber,
          firstDrawThisTurn: drawNumber === 1
        });
        if (this.state.gameBegun) this.legality?.recordOperation(LEGALITY_OPERATION.DRAW, pid, { card, zone: 'hand', metadata: { drawNumber } });
        return card;
      }
    });

    this.events.register(ENGINE_EVENT.GAIN_LIFE, {
      validate: event => {
        requirePlayer(event.payload.playerId, this);
        if (!(Number(event.payload.amount) > 0)) throw new Error('Life gain amount must be positive');
      },
      commit: event => {
        const { playerId, amount } = event.payload;
        const n = Number(amount);
        if (!this.static.canPlayerGainLife(playerId)) return 0;
        if (this.legality && !this.legality.allowsOperation(LEGALITY_OPERATION.GAIN_LIFE, playerId, { count: n, metadata: event.payload })) {
          this.log('RULE_OPERATION_PREVENTED', { operation: LEGALITY_OPERATION.GAIN_LIFE, playerId, amount: n });
          return 0;
        }
        this.state.players[playerId].life += n;
        this.emit(EVENT.LIFE_GAIN, { controller: playerId, amount: n });
        this.legality?.recordOperation(LEGALITY_OPERATION.GAIN_LIFE, playerId, { count: n, metadata: event.payload });
        this.checkWinner();
        return n;
      }
    });

    this.events.register(ENGINE_EVENT.LOSE_LIFE, {
      validate: event => {
        requirePlayer(event.payload.playerId, this);
        if (!(Number(event.payload.amount) > 0)) throw new Error('Life loss amount must be positive');
      },
      commit: event => {
        const { playerId, amount } = event.payload;
        const n = Number(amount);
        this.state.players[playerId].life -= n;
        this.emit(EVENT.LIFE_LOSS, { controller: playerId, amount: n });
        this.checkWinner();
        return -n;
      }
    });

    this.events.register(ENGINE_EVENT.TAP, {
      validate: event => requirePermanent(event.payload.permanentId || event.payload.permanent, this),
      commit: event => {
        const permanent = requirePermanent(event.payload.permanentId || event.payload.permanent, this);
        if (permanent.tapped) return false;
        permanent.tapped = true;
        this.emit(EVENT.BECAME_TAPPED, { controller: permanent.controller, target: permanent, object: permanent });
        return true;
      }
    });

    this.events.register(ENGINE_EVENT.UNTAP, {
      validate: event => requirePermanent(event.payload.permanentId || event.payload.permanent, this),
      commit: event => {
        const permanent = requirePermanent(event.payload.permanentId || event.payload.permanent, this);
        if (!permanent.tapped) return false;
        // Stun counters replace the untap event with removing one stun counter.
        if (this.counters.wouldUntap(permanent)) return false;
        permanent.tapped = false;
        this.emit(EVENT.BECAME_UNTAPPED, { controller: permanent.controller, target: permanent, object: permanent });
        return true;
      }
    });

    this.events.register(ENGINE_EVENT.ADD_COUNTER, {
      validate: event => this.counters.validateEventPayload(event.payload),
      commit: event => this.counters.commitAdd(event.payload)
    });

    this.events.register(ENGINE_EVENT.REMOVE_COUNTER, {
      validate: event => this.counters.validateEventPayload(event.payload),
      commit: event => this.counters.commitRemove(event.payload)
    });

    this.events.register(ENGINE_EVENT.DISCARD_CARD, {
      validate: event => {
        requirePlayer(event.payload.playerId, this);
        const found = ZoneManager.find(this.state, event.payload.cardInstanceId);
        if (!found || found.zone !== 'hand' || found.player?.id !== event.payload.playerId) throw new Error('Card is not in that player’s hand');
      },
      commit: event => {
        const card = this.events.dispatch(ENGINE_EVENT.MOVE_ZONE, {
          cardInstanceId: event.payload.cardInstanceId,
          toZone: 'graveyard',
          toPlayerId: ZoneManager.find(this.state, event.payload.cardInstanceId)?.card?.owner,
          reason: event.payload.reason || 'discard'
        }, { cause: event.payload.reason || 'discard', stabilize: false });
        this.emit(EVENT.CARD_DISCARDED, { controller: event.payload.playerId, card });
        return card;
      }
    });

    this.events.register(ENGINE_EVENT.MILL_CARD, {
      validate: event => requirePlayer(event.payload.playerId, this),
      commit: event => {
        const player = this.state.players[event.payload.playerId];
        const card = event.payload.cardInstanceId
          ? ZoneManager.find(this.state, event.payload.cardInstanceId)?.card
          : player.library[0];
        if (!card || ZoneManager.find(this.state, card.instanceId)?.zone !== 'library') return null;
        return this.events.dispatch(ENGINE_EVENT.MOVE_ZONE, {
          cardInstanceId: card.instanceId,
          toZone: 'graveyard',
          toPlayerId: card.owner,
          reason: 'mill'
        }, { cause: 'mill', stabilize: false });
      }
    });

    this.events.register(ENGINE_EVENT.SHUFFLE, {
      validate: event => requirePlayer(event.payload.playerId, this),
      commit: event => {
        const playerId = event.payload.playerId;
        const library = this.zones.shuffleLibrary(playerId, this.rng);
        this.knownInformation.clearLibraryKnowledge(playerId);
        this.emit(EVENT.LIBRARY_SHUFFLED, { controller: playerId, reason: event.payload.reason || null });
        return library.map(card => card.instanceId);
      }
    });

    this.events.register(ENGINE_EVENT.CONTROL_CHANGE, {
      validate: event => {
        requirePlayer(event.payload.newController, this);
        requirePermanent(event.payload.permanentId || event.payload.permanent, this);
      },
      commit: event => {
        const permanent = requirePermanent(event.payload.permanentId || event.payload.permanent, this);
        const newController = event.payload.newController;
        if (permanent.controller === newController) return permanent;
        const previousController = permanent.controller;
        permanent.controlHistory ||= [];
        permanent.controlHistory.push(previousController);
        this.zones.transferBattlefieldControl(permanent.instanceId, newController);
        permanent.controller = newController;
        permanent.controlledSinceTurn = this.state.turn;
        if (this.static.isType(permanent, 'Creature')) {
          permanent.summoningSick = !this.mechanics.canIgnoreSummoningSickness(permanent);
        }
        this.emit(EVENT.CONTROL_CHANGED, { controller: newController, previousController, target: permanent });
        return permanent;
      }
    });

    this.events.register(ENGINE_EVENT.ATTACH, {
      validate: event => this.attachments.validateAttach(event.payload.attachedId, event.payload.hostId, {
        filter: event.payload.legalHostFilter || null, actionKind: event.payload.attachmentType || null, targeted: false
      }),
      commit: event => this.attachments._attachNow(event.payload.attachedId, event.payload.hostId, {
        reason: event.payload.reason || 'attach', attachmentType: event.payload.attachmentType || null,
        legalHostFilter: event.payload.legalHostFilter || null
      })
    });

    this.events.register(ENGINE_EVENT.DETACH, {
      validate: event => {
        const permanent = requirePermanent(event.payload.attachedId, this);
        if (!this.attachments.relationshipForAttached(permanent)) throw new Error('Permanent is not attached');
      },
      commit: event => this.attachments._detachNow(event.payload.attachedId, { reason: event.payload.reason || 'detach' })
    });

    this.events.register(ENGINE_EVENT.DEAL_DAMAGE, {
      validate: event => this.damage.validatePayload(event.payload),
      commit: event => this.damage.commitEvent(event)
    });

    this.events.register(ENGINE_EVENT.DESTROY, {
      validate: event => requirePermanent(event.payload.permanentId || event.payload.permanent, this),
      commit: event => {
        const permanent = requirePermanent(event.payload.permanentId || event.payload.permanent, this);
        const stats = this.static.derivedStats(permanent);
        if (this.mechanics.isIndestructible(permanent)) return false;
        if (Number(permanent.counters?.shield || 0) > 0) {
          this.events.dispatch(ENGINE_EVENT.REMOVE_COUNTER, { permanentId: permanent.instanceId, counterType: 'shield', amount: 1, playerId: permanent.controller }, { cause: 'shield-destroy', stabilize: false });
          permanent.damageMarked = 0;
          return false;
        }
        return this.toGraveyard(permanent, true);
      }
    });

    this.events.register(ENGINE_EVENT.SACRIFICE, {
      validate: event => requirePermanent(event.payload.permanentId || event.payload.permanent, this),
      commit: event => {
        const permanent = requirePermanent(event.payload.permanentId || event.payload.permanent, this);
        this.emit(EVENT.SACRIFICED, { controller: permanent.controller, target: permanent });
        return this.toGraveyard(permanent, true);
      }
    });

    this.events.register(ENGINE_EVENT.EXILE, {
      validate: event => requireObject(event.payload.permanentId || event.payload.permanent || event.payload.objectId || event.payload.object, this),
      commit: event => {
        const object = requireObject(event.payload.permanentId || event.payload.permanent || event.payload.objectId || event.payload.object, this);
        return this.moveToZone(object, 'exile', object.owner);
      }
    });

    this.events.register(ENGINE_EVENT.CREATE_TOKEN, {
      snapshotOnCommitError: true,
      validate: event => this.tokens.validateCreate(event.payload),
      commit: event => this.tokens.commitCreate(event.payload)
    });

    this.events.register(ENGINE_EVENT.CAST, {
      snapshotOnCommitError: true,
      validate: event => requirePlayer(event.payload.playerId, this),
      commit: event => {
        const action = event.payload.action || {};
        const pid = event.payload.playerId;
        if (action.castOption === 'hideaway') return this._applyHideawayCast(pid, action);
        return this._applyCast(pid, action.cardInstanceId, action.targets || [], action.mode || null, action.castOption || null, action.retraceLandInstanceId || null, action.castFaceIndex ?? null);
      }
    });

    this.events.register(ENGINE_EVENT.ATTACK, {
      validate: event => requirePlayer(event.payload.playerId, this),
      commit: event => this._applyDeclareAttackers(event.payload.playerId, event.payload.attackers || [], event.payload.attackTargets || {}, event.payload.attackPayments || {})
    });

    this.events.register(ENGINE_EVENT.BLOCK, {
      validate: event => requirePlayer(event.payload.playerId, this),
      commit: event => this._applyDeclareBlockers(event.payload.playerId, event.payload.blockers || {})
    });

    this.events.register(ENGINE_EVENT.COPY, {
      validate: event => {
        const originalItem = event.payload.originalItem;
        if (!originalItem || !['spell', 'ability', 'trigger'].includes(originalItem.type)) throw new Error('Copy event requires a spell or ability stack object');
        if (!(Number(event.payload.count ?? 1) > 0)) throw new Error('Copy count must be positive');
      },
      commit: event => this.effects._queueSpellCopiesNow(
        event.payload.originalItem,
        Number(event.payload.count ?? 1),
        event.payload.controller || event.payload.originalItem.controller,
        { retargetAllowed: !!event.payload.retargetAllowed }
      )
    });

    // Search/transform receive canonical event envelopes now; their complete
    // rules-specific mutation services are intentionally deferred to Steps 27
    // and the later mechanic/card migration layers.
    this.events.register(ENGINE_EVENT.SEARCH, {
      validate: event => requirePlayer(event.payload.playerId, this),
      commit: event => {
        const pid = event.payload.playerId;
        if (this.legality && !this.legality.allowsOperation(LEGALITY_OPERATION.SEARCH, pid, { metadata: event.payload })) {
          this.log('RULE_OPERATION_PREVENTED', { operation: LEGALITY_OPERATION.SEARCH, playerId: pid, reason: event.payload.reason || null });
          return false;
        }
        this.legality?.recordOperation(LEGALITY_OPERATION.SEARCH, pid, { metadata: event.payload });
        if (event.payload.returnTransformedRequest) return structuredClone(event.payload);
        return event.payload.result ?? true;
      }
    });
    this.events.register(ENGINE_EVENT.TRANSFORM, {
      validate: event => requirePermanent(event.payload.permanentId || event.payload.permanent, this),
      commit: event => {
        const permanent = requirePermanent(event.payload.permanentId || event.payload.permanent, this);
        const definition = this.copy?.definitionForObject(permanent) || this.db[permanent.cardId] || {};
        const model = createCardFaceModel(definition);
        if (!model.isMultiFace || model.backFaceIndex == null) return false;
        const current = Number(permanent.faceState?.currentFaceIndex || 0);
        const next = current === model.frontFaceIndex ? model.backFaceIndex : model.frontFaceIndex;
        setCurrentFace(permanent, definition, next);
        return permanent;
      }
    });
  }

  static createGame(deckA, deckB, db, options = {}) {
    return new GameEngine(deckA, deckB, db, options);
  }

  getStateSnapshot() {
    return immutableClone(this.state);
  }

  getPlayerStateSnapshot(viewerId) {
    return this.hiddenInformation.stateForViewer(viewerId);
  }

  getKnownInformationSnapshot(viewerId) {
    return this.knownInformation.snapshot(viewerId);
  }

  getLastKnownInformation(ref) {
    return this.lki.get(ref);
  }

  getCostMechanicRegistrySnapshot() {
    return immutableClone(this.costMechanics.snapshot());
  }

  getCastCostSnapshot(playerId, action) {
    const found = action?.cardInstanceId ? this.zones.find(action.cardInstanceId) : null;
    if (!found?.card) return null;
    const info = this._castCostInfo(playerId, found.card, found.zone, action.mode || null, action.targets || [], action.castOption || null, action.castFaceIndex ?? null);
    return immutableClone(info.lockedCost);
  }

  getPaymentPlanSnapshot(playerId, action) {
    const found = action?.cardInstanceId ? this.zones.find(action.cardInstanceId) : null;
    if (!found?.card) return null;
    const lockedCost = this.getCastCostSnapshot(playerId, action);
    const plan = this.payments.planner.plan(playerId, lockedCost, { context: { kind: 'cast', card: found.card } });
    return plan ? immutableClone(plan) : null;
  }

  revealCard(cardRef, { reason = 'reveal', position = null } = {}) {
    const card = this._queryObject(cardRef);
    if (!card) throw new Error('Cannot reveal an unavailable card');
    this.knownInformation.reveal(card, { reason, position });
    return immutableClone(card);
  }

  lookAtCard(viewerId, cardRef, { reason = 'look', position = null } = {}) {
    if (!this.state.players[viewerId]) throw new Error(`Unknown viewer ${viewerId}`);
    const card = this._queryObject(cardRef);
    if (!card) throw new Error('Cannot look at an unavailable card');
    this.knownInformation.look(viewerId, card, { reason, position });
    return immutableClone(card);
  }

  getCardDatabaseSnapshot() {
    if (!this._publicDatabaseSnapshot || this._publicDatabaseSnapshotRevision !== this._databaseRevision) {
      this._publicDatabaseSnapshot = immutableClone(this.db);
      this._publicDatabaseSnapshotRevision = this._databaseRevision;
    }
    return this._publicDatabaseSnapshot;
  }

  getCardDefinition(cardId) {
    return this.getCardDatabaseSnapshot()[cardId] || null;
  }

  getObjectDefinition(ref) {
    const object = this._queryObject(ref);
    if (!object) return null;
    return immutableClone(this.copy?.definitionForObject(object) || getObjectCardDefinition(this.db[object.cardId] || {}, object));
  }

  getCopiableValues(ref) {
    return immutableClone(this.copy.getCopiableValues(ref));
  }

  copyPermanent(targetRef, sourceRef, options = {}) {
    const result = this.copy.applyPermanentCopy(targetRef, sourceRef, options);
    return immutableClone(result);
  }

  createTokenCopy(playerId, sourceRef, options = {}) {
    const result = this.copy.createTokenCopy(playerId, sourceRef, options);
    return immutableClone(result);
  }

  getTokenRegistrySnapshot() { return immutableClone(this.tokens.registrySnapshot()); }

  registerTokenDefinition(definition, options = {}) {
    this.strictRules?.assertDeveloperToolAllowed('registerTokenDefinition', { internal: options.internal === true });
    const registered = options.namespace
      ? this.tokens.registry.registerLocal(options.namespace, definition, options)
      : this.tokens.registry.register(definition, options);
    return immutableClone(registered);
  }

  copyStackObject(originalRef, options = {}) {
    const item = typeof originalRef === 'string' ? this.stack.find(originalRef) : originalRef;
    if (!item) throw new Error('Stack object to copy was not found');
    return immutableClone(this.copy.createStackCopies(item, options));
  }

  serializeState() {
    return serializeGameState(this.state);
  }

  restoreState(serialized, options = {}) {
    this.strictRules?.assertDeveloperToolAllowed('restoreState', { internal: options.internal === true });
    this.state = deserializeGameState(serialized, { db: this.db });
    this.pregameRules = new PregameService(this, this._pregameConfig);
    this.events.syncSequenceFromState();
    this.logger?.clear();
    this.performance?.reset();
    this.turn.ensureState();
    this.knownInformation.ensureState();
    this.lki.ensureState();
    this.commanders.ensureAllPlayers();
    this.legality?.ensureState();
    this.timing?.ensureState();
    return this.getStateSnapshot();
  }

  getLegacyAdapterRegistry() {
    return getLegacyAdapterRegistry();
  }

  _registerRuntimeCardDefinition(cardId, definition, options = {}) {
    this.strictRules?.assertDeveloperToolAllowed('_registerRuntimeCardDefinition', { internal: options.internal === true });
    const raw = { ...structuredClone(definition), id: definition?.id || cardId };
    this.cardSupport.registerRuntimeCard(raw);
    const prepared = this.cardSupport.prepareCard(raw);
    this.db[cardId] = this.cardScripts.compileCard(prepared);
    this.legality?.invalidateSourceRules();
    this._databaseRevision += 1;
    this._publicDatabaseSnapshot = null;
    return this.db[cardId];
  }

  registerCustomCardHook(spec) {
    this.strictRules?.assertDeveloperToolAllowed('registerCustomCardHook');
    return this.cardScripts.registerCustomHook(spec);
  }

  compileCardScript(cardDefinition) {
    return immutableClone(this.cardScripts.compileCard(cardDefinition));
  }

  compileOracleTemplate(cardDefinition) {
    return immutableClone(this.cardScripts.compileOracleText(cardDefinition));
  }

  analyzeOracleTemplate(cardDefinition) {
    return immutableClone(this.cardScripts.analyzeOracleText(cardDefinition));
  }

  getCardScriptCapabilities() {
    return immutableClone(this.cardScripts.snapshot());
  }

  getCardSupportStatus(cardId) {
    return immutableClone(this.cardSupport.getCardStatus(cardId, this.db));
  }

  preflightDeckSupport(decks = null, options = {}) {
    const source = decks || [this.initialDeckA, ...(Array.isArray(this.initialDeckB) ? this.initialDeckB : [this.initialDeckB])].filter(Boolean);
    return immutableClone(this.unsupported.preflightDecks(source, options));
  }

  getUnsupportedInteractionPolicy() {
    return immutableClone(this.unsupported.policySnapshot());
  }

  getUnsupportedDiagnostics() {
    return immutableClone(this.unsupported.diagnosticsSnapshot());
  }

  isSimulationStatisticsEligible() {
    return !!this.unsupported.statisticsEligible;
  }

  getOracleImplementation(cardId) {
    return immutableClone(this.cardSupport.getOracleImplementation(cardId));
  }

  getDeckSupportReadiness(deckOrId) {
    const deck = typeof deckOrId === 'object' ? deckOrId : [this.initialDeckA, ...(Array.isArray(this.initialDeckB) ? this.initialDeckB : [this.initialDeckB])].find(item => item?.id === deckOrId);
    return deck ? immutableClone(this.cardSupport.deckReadiness(deck, this.db)) : null;
  }

  getCardSupportCoverage() {
    return immutableClone(this.cardSupport.coverage());
  }

  _queryObject(ref) {
    if (!ref) return null;
    if (typeof ref === 'object' && ref.instanceId) {
      return ZoneManager.find(this.state, ref.instanceId)?.card
        || this.state.stack.find(item => item?.card?.instanceId === ref.instanceId)?.card
        || ref;
    }
    if (typeof ref === 'string') {
      return ZoneManager.find(this.state, ref)?.card
        || this.state.stack.find(item => item?.card?.instanceId === ref)?.card
        || null;
    }
    return typeof ref === 'object' ? ref : null;
  }

  getPermanentSnapshot(instanceId) {
    const permanent = this.findPermanent(instanceId);
    return permanent ? immutableClone(permanent) : null;
  }

  getDerivedStats(ref) {
    const object = this._queryObject(ref);
    return object ? immutableClone(this.static.derivedStats(object)) : null;
  }

  getEffectiveAbilities(ref) {
    const object = this._queryObject(ref);
    return object ? immutableClone(this.static.effectiveAbilities(object) || []) : Object.freeze([]);
  }

  isObjectType(ref, type) {
    const object = this._queryObject(ref);
    return !!object && this.static.isType(object, type);
  }

  objectHasSubtype(ref, subtype) {
    const object = this._queryObject(ref);
    return !!object && this.static.hasSubtype(object, subtype);
  }


  getDerivedCharacteristics(ref, options = {}) {
    const object = this._queryObject(ref);
    return object ? immutableClone(this.continuous.characteristics(object, options)) : null;
  }

  getCommanderTaxLedgerSnapshot(playerId) {
    return immutableClone(this.commanders.taxLedger(playerId));
  }

  getCommanderDamageMatrixSnapshot() {
    return immutableClone(this.commanders.damageMatrix());
  }

  getMultiplayerRelationSnapshot(relation, actorPlayerId, context = {}) {
    return immutableClone(this.multiplayer.resolve(relation, { actorPlayerId, ...context }));
  }

  getLegalDefendingEntities(playerId) {
    return immutableClone(this.combat.legalDefendingEntities(playerId));
  }

  getLegalBlockers(playerId, attackerRef) {
    const attacker = this._queryObject(attackerRef);
    return attacker ? immutableClone(this.combat.legalBlockers(playerId, attacker.instanceId)) : Object.freeze([]);
  }

  getLegalAttackers(playerId) {
    return immutableClone(this.combat.legalAttackers(playerId));
  }

  canBlock(blockerRef, attackerRef) {
    const blocker = this._queryObject(blockerRef);
    const attacker = this._queryObject(attackerRef);
    return !!blocker && !!attacker && this.combat.canBlock(blocker, attacker);
  }

  validateBlockers(playerId, blockers) {
    try {
      this.combat.validateBlockers(playerId, blockers);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: { code: 'ILLEGAL_BLOCK_DECLARATION', message: error.message } };
    }
  }

  hasTargets(sourceDefinition) {
    return this.targeting.hasTargets(sourceDefinition);
  }

  getTargetingBounds(sourceDefinition) {
    return immutableClone(this.targeting.bounds(sourceDefinition));
  }

  getTargetCandidates(playerId, sourceDefinition, selectedTargets = [], { sourceObject = null } = {}) {
    const authoritativeSource = sourceObject?.instanceId ? this._queryObject(sourceObject.instanceId) : sourceObject;
    return immutableClone(this.targeting.getCandidates(playerId, sourceDefinition, selectedTargets, { sourceObject: authoritativeSource }));
  }

  getPendingChoiceRequest() {
    return this.choices.getSnapshot();
  }

  _requestChoice(request, resolver = null) {
    return this.choices.open(request, resolver);
  }

  getTargetSourceForAction(action, definition) {
    const source = this.targetSourceForAction(action, definition);
    return source ? immutableClone(source) : null;
  }

  getSelectionCandidates(playerId, sourceRef, selection) {
    const source = sourceRef?.instanceId ? this._queryObject(sourceRef.instanceId) : sourceRef;
    return immutableClone(this._selectionCandidates(playerId, source, selection));
  }

  playerIds = () => [...(this.state.playerOrder || Object.keys(this.state.players))];

  livingPlayerIds = () => this.multiplayer.livingPlayerIds();

  opponents = id => this.multiplayer.opponentsOf(id);

  opponent = id => this.opponents(id)[0] || null;

  nextPlayer = id => {
    const order = this.playerIds();
    if (!order.length) return null;
    const start = Math.max(0, order.indexOf(id));
    for (let offset = 1; offset <= order.length; offset++) {
      const candidate = order[(start + offset) % order.length];
      if (this.state.players[candidate] && !this.state.players[candidate].lost) return candidate;
    }
    return null;
  };

  nextPriorityPlayer = id => this.nextPlayer(id);

  start() {
    if (this.state.started) throw new Error('Game already started; use reset() to begin a new match');
    // Step 42 startup gate runs immediately before any pregame mutation/draw.
    this.strictRules?.assertStartupReady();
    this.pregameRules.initialize();
    this.state.started = true;
    for (const id of this.state.playerOrder) this.draw(id, 7);
    this.emit(EVENT.GAME_START, { controller: this.state.activePlayer, turn: this.state.turn, stage: 'pregame' });
    this.loops.reset({ seed: true });
    this.safety.reset();
    return this.getStateSnapshot();
  }

  reset() {
    this.random.reset();
    this.db = structuredClone(this.initialDb);
    this._databaseRevision += 1;
    this._publicDatabaseSnapshot = null;
    this.state = createGameState(this.initialDeckA, this.initialDeckB, this.db, this.rng);
    this.pregameRules = new PregameService(this, this._pregameConfig);
    this.legality?.ensureState();
    this.events.syncSequenceFromState();
    this.logger?.clear();
    this.performance?.reset();
    this.turn.ensureState();
    this._replayActions = [];
    this._actionSequence = 0;
    this._runtimeIdSequence = 0;
    this._aiDecisions = [];
    this._aiDecisionSequence = 0;
    this._activeActionContext = null;
    this.safety.reset();
    this.loops.reset();
    this.choices.sequence = 0;
    this.choices.resolvers.clear();
    this.continuous.runtimeEffects.clear();
    this.continuous.sequence = 0;
    this.sba.sequence = 0;
    this.elimination.sequence = 0;
    this.commanders.ensureAllPlayers();
    return this.start();
  }

  _internalToken() { return INTERNAL; }

  _nextRuntimeId(prefix = 'runtime') {
    this._runtimeIdSequence += 1;
    return `${prefix}-${this._runtimeIdSequence}`;
  }

  validateDeck(deck, options = {}) { return this.pregameRules.validator.validate(deck, options); }

  getPregameSnapshot() { return immutableClone(this.pregameRules.snapshot()); }

  log(type, data = {}) {
    this.state.history.push({ turn: this.state.turn, phase: this.state.phase, type, ...data });
    this.logger?.recordLegacy(type, data);
  }

  emit(event, payload = {}) {
    return this.events.notify(event, payload);
  }

  _withDeferredTriggers(callback) {
    this._triggerDeferral++;
    try {
      return callback();
    } finally {
      this._triggerDeferral--;
      if (this._triggerDeferral === 0 && !this.state.pendingChoice) this.triggers.afterEventBoundary();
    }
  }

  draw(pid, n = 1) {
    let last = null;
    for (let i = 0; i < n; i++) {
      last = this.replacements.dispatchWithChoice(ENGINE_EVENT.DRAW_CARD, { playerId: pid }, { cause: 'draw', stabilize: false, affectedPlayerId: pid });
      if (last?.deferred || this.state.pendingChoice || !last) break;
    }
    return last;
  }

  shuffleLibrary(pid, reason = 'shuffle') {
    return this.events.dispatch(ENGINE_EVENT.SHUFFLE, { playerId: pid, reason }, { cause: reason, stabilize: false });
  }

  noteLibrarySearch(pid, metadata = {}) {
    return this.events.dispatch(ENGINE_EVENT.SEARCH, { playerId: pid, ...structuredClone(metadata) }, { cause: metadata.reason || 'library-search', stabilize: false });
  }

  discardCard(pid, cardInstanceId, reason = 'discard') {
    return this.events.dispatch(ENGINE_EVENT.DISCARD_CARD, { playerId: pid, cardInstanceId, reason }, { cause: reason, stabilize: false });
  }

  mill(pid, count = 1) {
    const milled = [];
    for (let index = 0; index < Math.max(0, Number(count) || 0); index++) {
      const card = this.events.dispatch(ENGINE_EVENT.MILL_CARD, { playerId: pid }, { cause: 'mill', stabilize: false });
      if (!card) break;
      milled.push(card);
    }
    return milled;
  }

  removeCounters(object, counterType, amount = 1, playerId = object?.controller || object?.owner) {
    if (!object || amount <= 0) return 0;
    return this.counters.remove(object, counterType, amount, { playerId, cause: 'remove-counter' });
  }

  addCounters(target, counterType, amount = 1, options = {}) {
    return this.counters.add(target, counterType, amount, options);
  }

  moveCounters(fromTarget, toTarget, counterType, amount = 1, options = {}) {
    return this.counters.move(fromTarget, toTarget, counterType, amount, options);
  }

  doubleCounters(target, counterType, options = {}) {
    return this.counters.double(target, counterType, options);
  }

  getCounterSnapshot(target) {
    return immutableClone(this.counters.snapshot(target));
  }

  getEventLogSnapshot() {
    return immutableClone(this.events.getLogSnapshot());
  }

  getRulesLogSnapshot(options = {}) { return immutableClone(this.logger.snapshot(options)); }

  setVerboseRulesTracing(enabled = true) { return this.logger.setVerbose(enabled); }

  getDiagnosticBundle(options = {}) { return immutableClone(this.logger.diagnosticBundle(options)); }

  traceLegality(operation, playerId, context = {}) { return immutableClone(this.logger.traceLegality(operation, playerId, context)); }

  traceCharacteristics(object) { return immutableClone(this.logger.traceCharacteristics(object)); }

  getReplacementTraceSnapshot() { return immutableClone(this.replacements.getTraceSnapshot()); }

  getPreventionEffectsSnapshot() { return immutableClone(this.prevention.snapshot()); }

  getStackSnapshot() { return immutableClone(this.stack.getSnapshot()); }

  getPrioritySnapshot() { return immutableClone(this.priority.getSnapshot()); }

  getStackPriorityView() { return immutableClone(buildStackPriorityView(this)); }

  getLegalActions(pid) { return immutableClone(this.legal.get(pid)); }

  recordAIDecision(playerId, record = {}) {
    if (!this.state.players[playerId]) throw new Error(`Unknown AI player ${playerId}`);
    const entry = {
      sequence: ++this._aiDecisionSequence,
      actionSequence: this._actionSequence,
      playerId,
      turn: Number(record.turn ?? this.state.turn),
      phase: record.phase || this.state.phase,
      policyVersion: record.policyVersion || 'unknown',
      kind: record.kind || 'action',
      legalActionCount: Number(record.legalActionCount || 0),
      action: record.action ? structuredClone(record.action) : null,
      value: Number.isFinite(record.value) ? Number(record.value) : null,
      threshold: Number.isFinite(record.threshold) ? Number(record.threshold) : null
    };
    this._aiDecisions.push(entry);
    return immutableClone(entry);
  }

  getAIDecisionLogSnapshot() { return immutableClone(this._aiDecisions); }

  getLoopSnapshot() { return immutableClone(this.loops.snapshot()); }

  getSafetyBudgetSnapshot() { return immutableClone(this.safety.snapshot()); }

  getLegalitySnapshot() { return immutableClone(this.legality.snapshot()); }

  getLegalityDiagnostics() { return immutableClone(this.legality.getDiagnostics()); }

  getTimingSnapshot() { return immutableClone(this.timing.snapshot()); }

  getTimingDiagnostics() { return immutableClone(this.timing.getDiagnostics()); }

  getPerformanceSnapshot() { return immutableClone(this.performance.snapshot()); }

  setPerformanceProfiling(enabled = true) { return this.performance.profiler.setEnabled(enabled); }

  getAttachmentSnapshot() { return immutableClone(this.attachments.getSnapshot()); }

  getAttachmentUiMetadata() { return immutableClone(this.attachments.uiMetadata()); }

  attachPermanent(attachedRef, hostRef, options = {}) { return this.attachments.attach(attachedRef, hostRef, options); }

  detachPermanent(attachedRef, options = {}) { return this.attachments.detach(attachedRef, options); }

  registerLegalityRule(rule) {
    this.strictRules?.assertDeveloperToolAllowed('registerLegalityRule');
    return immutableClone(this.legality.register(rule));
  }

  unregisterLegalityRule(ruleId) {
    this.strictRules?.assertDeveloperToolAllowed('unregisterLegalityRule');
    return this.legality.unregister(ruleId);
  }

  getLoopShortcutActions(pid) { return immutableClone(this.loops.legalShortcutActions(pid)); }

  isActionLegal(pid, action) {
    try { this.validateAction(pid, action); return true; }
    catch { return false; }
  }

  validateAction(pid, action) {
    // Step 41: central support check happens before costs or authoritative state
    // mutations. Standard/strict modes halt; sandbox mode records an explicit
    // approximation and marks the run ineligible for official statistics.
    this.unsupported?.assertActionSupported(action);
    const s = this.state;
    if (!s.started) throw new Error('Game has not started');
    if (s.winner) throw new Error('Game is over');
    if (!s.players[pid]) throw new Error('Unknown acting player');
    if (s.players[pid].lost) throw new Error('Eliminated players cannot take actions');
    if (!action?.type) throw new Error('Action type is required');

    if (s.pendingChoice) return this._validateChoiceAction(pid, action);
    if (s.pregame.active) return this._validatePregameAction(pid, action);
    if (!s.gameBegun) throw new Error('Game has not begun');

    // Step 21 gate: all normal player actions consult the same legality service
    // before any cost can be paid or any authoritative state can mutate.
    this.legality.validateAction(pid, action);

    if (s.turnActionPending) {
      if (s.turnActionPending === 'DECLARE_ATTACKERS') return this._validateDeclareAttackers(pid, action);
      if (s.turnActionPending === 'DECLARE_BLOCKERS') return this._validateDeclareBlockers(pid, action);
    }

    // Step 28 gate: priority, default card timing, explicit timing windows,
    // special-action windows and usage limits are all enforced here. The UI
    // and AI receive the same result through getLegalActions().
    try {
      this.timing.validateAction(pid, action);
    } catch (error) {
      // Preserve the established public error vocabulary while Step 28 keeps
      // the detailed denial reason in timing diagnostics for developers.
      if (['CAST_SPELL', 'CAST_COMMANDER'].includes(action.type)) throw new Error('Spell cannot be cast at this time');
      if (action.type === 'PLAY_LAND') throw new Error('Illegal land timing');
      if (action.type === 'FORETELL_CARD') throw new Error('Foretell may only be used during your turn while you have priority');
      if (action.type === 'ENCORE_CARD') throw new Error('Encore may only be activated as a sorcery');
      if (action.type === 'ACTIVATE_ABILITY' && action.ability?.sorcerySpeed) throw new Error('Ability may only be activated at sorcery speed');
      throw error;
    }

    switch (action.type) {
      case 'PASS_PRIORITY': return true;
      case 'LOOP_SHORTCUT': return this.loops.validateShortcut(pid, action);
      case 'PLAY_LAND': return this._validateLand(pid, action);
      case 'CAST_SPELL':
      case 'CAST_COMMANDER': return this._validateCast(pid, action);
      case 'ACTIVATE_MANA': return this._validateAbility(pid, action, true);
      case 'ACTIVATE_ABILITY': return this._validateAbility(pid, action, false);
      case 'FORETELL_CARD': return this._validateForetell(pid, action);
      case 'ENCORE_CARD': return this._validateEncore(pid, action);
      case 'DECLARE_ATTACKERS': throw new Error('Attackers may only be declared during the declare attackers turn-based action');
      case 'DECLARE_BLOCKERS': throw new Error('Blockers may only be declared during the declare blockers turn-based action');
      case 'MULLIGAN':
      case 'KEEP_HAND':
      case 'BOTTOM_CARDS': throw new Error('Mulligan window is closed');
      case 'DISCARD_CARDS': throw new Error('No discard choice is pending');
      default: throw new Error(`Unknown action ${action.type}`);
    }
  }

  _structuredActionError(pid, action, error, code = 'ILLEGAL_ACTION') {
    const unsupported = error?.code === 'UNSUPPORTED_INTERACTION' ? {
      diagnosticId: error.diagnosticId || error.diagnostic?.diagnosticId || null,
      cardId: error.cardId || null,
      cardName: error.cardName || null,
      ability: error.ability || null,
      scriptNode: error.scriptNode ? structuredClone(error.scriptNode) : null,
      detail: error.detail ? structuredClone(error.detail) : null,
      context: error.context ? structuredClone(error.context) : null,
      rulesVersion: error.rulesVersion || this.rulesVersion,
      gameId: error.gameId || this.gameId,
      eventId: error.eventId || null,
      stackObjectId: error.stackObjectId || null,
      supportStatus: error.supportStatus || null,
      suggestedSupportStatus: error.suggestedSupportStatus || null,
      mode: error.mode || this.unsupported?.mode || null,
      rollback: error.rollback || null,
      statisticsEligible: error.statisticsEligible !== false
    } : {};
    return {
      ok: false,
      error: {
        code,
        message: error?.message || String(error),
        playerId: pid,
        actionType: action?.type || null,
        turn: this.state.turn,
        phase: this.state.phase,
        ...unsupported
      }
    };
  }

  _submitValidated(pid, action, kind = 'action') {
    this.logger?.recordActionRequested(pid, action, kind);
    const choiceRequest = kind === 'choice' ? this.getPendingChoiceRequest() : null;
    try {
      this.safety.enterAction({ playerId: pid, actionType: action?.type || null, kind });
    } catch (error) {
      return this._structuredActionError(pid, action, error, error?.code || 'ACTION_SAFETY_LIMIT');
    }

    try {
      try {
        this.invariants?.check({ boundary: `${kind}:before` });
        this.validateAction(pid, action);
        this.logger?.recordActionValidated(pid, action, kind);
      } catch (error) {
        this.logger?.recordActionRejected(pid, action, error, 'validation');
        return this._structuredActionError(pid, action, error, error?.code || 'ILLEGAL_ACTION');
      }

      const pendingSequence = this._actionSequence + 1;
      const legalityRecordContext = this.legality.actionContext(pid, action);
      const timingRecordContext = this.timing.actionContext(pid, action);
      // Step 41 keeps a precise pre-action checkpoint only for unsupported-
      // interaction recovery. ResolutionPipeline already rolls back stack
      // resolution internally; this outer checkpoint also covers unsupported
      // failures raised by action handlers outside stack resolution.
      const unsupportedCheckpoint = this.replay.createCheckpoint(`step41-before-${kind}-${pendingSequence}`);
      this._activeActionContext = { sequence: pendingSequence, kind, playerId: pid, actionType: action.type, choiceRequestId: choiceRequest?.requestId || null };
      try {
        // The shortcut expands a previously observed sequence; resetting pass
        // tracking here would alter the very state that was certified as the
        // loop boundary. Expanded non-pass actions reset priority themselves.
        if (action.type !== 'PASS_PRIORITY' && action.type !== LOOP_SHORTCUT_ACTION) this.priority.resetConsecutivePasses(`action:${action.type}`);
        const result = this._withDeferredTriggers(() => {
          const applied = this._applyValidatedAction(pid, action, INTERNAL);
          this.legality.recordAction(pid, action, legalityRecordContext);
          this.timing.recordAction(pid, action, timingRecordContext);
          if (this.state.gameBegun && !this.state.pendingChoice && !this.state.winner && !this.state.turnActionPending) {
            this.stateBasedActions();
          }
          return applied;
        });
        if (this.state.pendingChoice) {
          this.choices.ensurePendingId();
          this.state.priorityPlayer = this.state.pendingChoice.playerId;
        }
        this.invariants?.check({ boundary: `${kind}:after` });
        this.performance?.markMutation(`${kind}:complete`, { topology: false });
        this._actionSequence = pendingSequence;
        this.loops.observeAction({
          playerId: pid,
          action,
          kind,
          mandatory: false,
          hadChoice: kind === 'choice'
        });
        this._replayActions.push({
          sequence: pendingSequence,
          kind,
          playerId: pid,
          turn: this.state.turn,
          phase: this.state.phase,
          action: structuredClone(action),
          ...(choiceRequest ? { choiceRequest: structuredClone(choiceRequest) } : {}),
          stateHash: this.replay.stateHash(),
          rngCalls: this.random.snapshot().calls
        });
        this.logger?.recordActionCompleted(pid, action, result, kind);
        return { ok: true, result };
      } catch (error) {
        if (error?.code === 'UNSUPPORTED_INTERACTION') {
          // Restore the exact action boundary. The unsupported diagnostic lives
          // outside authoritative GameState so it survives this rollback.
          this.replay.restoreCheckpoint(unsupportedCheckpoint);
          this.unsupported?.annotateRollback(error, 'action-checkpoint-restored');
        }
        this.logger?.recordActionRejected(pid, action, error, 'execution');
        return this._structuredActionError(pid, action, error, error?.code || 'ACTION_EXECUTION_FAILED');
      } finally {
        this._activeActionContext = null;
      }
    } finally {
      this.safety.leaveAction();
    }
  }

  /**
   * Step 19 internal expansion path. A shortcut is one semantic replay action,
   * while each proven loop step still goes through normal validation, priority,
   * trigger and SBA boundaries. Expanded steps are intentionally not appended
   * to the replay action log.
   */
  _executeShortcutStep(pid, action, kind = 'action', context = {}) {
    if (action?.type === LOOP_SHORTCUT_ACTION) throw new Error('Loop shortcuts cannot contain nested shortcuts');
    const previousContext = this._activeActionContext;
    this._activeActionContext = {
      ...previousContext,
      kind: 'shortcut-expanded',
      playerId: pid,
      actionType: action?.type || null,
      loopId: context.loopId || null,
      iteration: context.iteration || null,
      stepIndex: context.stepIndex ?? null
    };
    try {
      this.validateAction(pid, action);
      const legalityRecordContext = this.legality.actionContext(pid, action);
      const timingRecordContext = this.timing.actionContext(pid, action);
      if (action.type !== 'PASS_PRIORITY') this.priority.resetConsecutivePasses(`shortcut:${action.type}`);
      const result = this._withDeferredTriggers(() => {
        const applied = this._applyValidatedAction(pid, action, INTERNAL);
        this.legality.recordAction(pid, action, legalityRecordContext);
        this.timing.recordAction(pid, action, timingRecordContext);
        if (this.state.gameBegun && !this.state.pendingChoice && !this.state.winner && !this.state.turnActionPending) this.stateBasedActions();
        return applied;
      });
      if (this.state.pendingChoice) {
        this.choices.ensurePendingId();
        this.state.priorityPlayer = this.state.pendingChoice.playerId;
      }
      this.invariants?.check({ boundary: 'shortcut:after' });
      this.performance?.markMutation('shortcut:complete', { topology: false });
      return result;
    } finally {
      this._activeActionContext = previousContext;
    }
  }

  submitAction(pid, action) {
    if (action?.type === LOOP_SHORTCUT_ACTION) action = this.loops.normalizeShortcutAction(action);
    if (this.state.pendingChoice) {
      return this._structuredActionError(pid, action, new Error('A choice is pending; use submitChoice()'), 'CHOICE_REQUIRED');
    }
    return this._submitValidated(pid, action, 'action');
  }

  submitChoice(pid, choiceAction) {
    if (!this.state.pendingChoice) {
      return this._structuredActionError(pid, choiceAction, new Error('No choice is pending'), 'NO_PENDING_CHOICE');
    }
    this.choices.ensurePendingId();
    let action = choiceAction;
    try {
      // Step 6 canonical protocol: callers may submit a ChoiceResponse directly.
      // Legacy action-shaped choices remain accepted through compatibility adapters.
      if (choiceAction?.requestId && !choiceAction?.type) action = this.choices.toLegacyAction(this.state.pendingChoice, choiceAction);
      if (choiceAction?.type === 'SUBMIT_CHOICE' && choiceAction.response) action = this.state.pendingChoice.type === 'ENGINE_CHOICE'
        ? choiceAction
        : this.choices.toLegacyAction(this.state.pendingChoice, choiceAction.response);
    } catch (error) {
      return this._structuredActionError(pid, choiceAction, error, 'ILLEGAL_CHOICE');
    }
    return this._submitValidated(pid, action, 'choice');
  }

  passPriority(pid) {
    return this.submitAction(pid, { type: 'PASS_PRIORITY' });
  }

  checkInvariants(options = {}) {
    return immutableClone(this.invariants.check(options));
  }

  setInvariantChecks(enabled = true) {
    if (enabled === false) this.strictRules?.assertDeveloperToolAllowed('disableInvariantChecks');
    return this.invariants.setEnabled(enabled);
  }

  getInvariantReport() {
    return immutableClone(this.invariants.lastReport);
  }

  getInvariantFailureBundle() {
    return immutableClone(this.invariants.lastFailure);
  }

  serializeReplay() {
    return JSON.stringify(this.replay.serialize());
  }

  getReplayStateHash() {
    return this.replay.stateHash();
  }

  createCheckpoint(label = null) {
    return immutableClone(this.replay.createCheckpoint(label));
  }

  loadCheckpoint(checkpoint) {
    this.strictRules?.assertDeveloperToolAllowed('loadCheckpoint');
    return this.replay.restoreCheckpoint(checkpoint);
  }

  getStrictModeConfig() {
    return immutableClone(this.strictRules?.configSnapshot?.() || { enabled: false });
  }

  getStrictPreflightReport() {
    return immutableClone(this.strictRules?.preflightSnapshot?.());
  }

  getSimulationCertification() {
    return immutableClone(this.strictRules?.certificationSnapshot?.() || null);
  }

  getReplayMetadata() {
    return immutableClone(this.replay.metadata());
  }

  static replay(replay, options = {}) {
    return ReplayRunner.run(replay, options);
  }

  // Deprecated compatibility adapter. New production callers must use
  // submitAction(), submitChoice(), or passPriority().
  perform(pid, action) {
    const response = this.state.pendingChoice
      ? this.submitChoice(pid, action)
      : (action?.type === 'PASS_PRIORITY' ? this.passPriority(pid) : this.submitAction(pid, action));
    if (!response.ok) {
      const error = new Error(response.error.message);
      error.code = response.error.code;
      error.details = response.error;
      throw error;
    }
    return response.result;
  }

  _applyValidatedAction(pid, action, token) {
    if (token !== INTERNAL) throw new Error('Internal action dispatcher cannot be called externally');
    switch (action.type) {
      case 'SUBMIT_CHOICE': return this.choices.resolveEngineChoice(pid, action.response);
      case 'MULLIGAN': return this._applyMulligan(pid);
      case 'KEEP_HAND': return this._applyKeepHand(pid);
      case 'BOTTOM_CARDS': return this._applyBottomCards(pid, action.cardInstanceIds);
      case 'DISCARD_CARDS': return this._applyDiscardCards(pid, action.cardInstanceIds);
      case 'ORDER_BLOCKERS': return this._applyOrderBlockers(pid, action.orders || {});
      case 'CHOOSE_LEGEND': return this._applyLegendChoice(pid, action.keepInstanceId);
      case 'CHOOSE_COMMANDER_ZONE': return this._applyCommanderZoneChoice(pid, !!action.moveToCommand);
      case 'CHOOSE_PREGAME_ACTION': return this.pregameRules.resolvePregameActionChoice(pid, action);
      case 'PAY_WARD': return this._applyWardChoice(pid, true);
      case 'DECLINE_WARD': return this._applyWardChoice(pid, false);
      case 'CHOOSE_TRIGGER': return this._applyOptionalTriggerChoice(pid, !!action.accept);
      case 'CHOOSE_OPTIONAL_MANA_PAYMENT': return this._applyOptionalManaPaymentChoice(pid, !!action.pay);
      case 'CHOOSE_TAP_OR_UNTAP': return this._applyTapOrUntapChoice(pid, action.choice);
      case 'CHOOSE_OPTIONAL_EFFECT': return this._applyOptionalEffectChoice(pid, !!action.accept);
      case 'ORDER_TRIGGERS': return this._applyTriggerOrder(pid, action.triggerIds || []);
      case 'CHOOSE_PROLIFERATE': return this._applyProliferateChoice(pid, action.targetIds || []);
      case 'CHOOSE_PHASE_OUT_PROLIFERATED': return this._applyPhaseOutProliferatedChoice(pid, action.permanentIds || []);
      case 'ORDER_REPLACEMENTS': return this._applyReplacementOrder(pid, action.replacementIds || []);
      case 'CHOOSE_EXPLORE': return this._applyExploreChoice(pid, !!action.putInGraveyard);
      case 'ORDER_EXPLORES': return this._applyExploreOrder(pid, action.permanentIds || []);
      case 'CHOOSE_HAKBAL_ATTACK': return this._applyHakbalAttackChoice(pid, action.landInstanceId || null);
      case 'CHOOSE_CULTIVATE': return this._applyCultivateChoice(pid, action.cardInstanceIds || []);
      case 'CHOOSE_SISAY_TUTOR': return this._applySisayTutorChoice(pid, action.cardInstanceId || null);
      case 'CHOOSE_SCRY': return this._applyScryChoice(pid, !!action.putOnBottom);
      case 'CHOOSE_TRIGGER_TARGET': return this._applyTriggerTargetChoice(pid, action.targetIds || []);
      case 'CHOOSE_CREATURE_TYPE': return this._applyCreatureTypeChoice(pid, action.creatureType);
      case 'CHOOSE_EFFECT_CARDS': return this._applyEffectCardChoice(pid, action.cardInstanceIds || []);
      case 'CHOOSE_LIBRARY_SEARCH': return this._applyLibrarySearchChoice(pid, action.cardInstanceIds || []);
      case 'CHOOSE_COPY_TARGETS': return this._applyCopyTargetChoice(pid, action.targetIds || []);
      case 'CHOOSE_PERMANENT_COPY': return this._applyPermanentCopyChoice(pid, action.permanentId || null);
      case 'CHOOSE_ATTACHMENT_HOST': return this._applyAttachmentEntryChoice(pid, action.hostId);
      case 'CHOOSE_ENTRY_LIFE_PAYMENT': return this._applyEntryLifeChoice(pid, !!action.pay);
      case 'CHOOSE_ENTRY_REVEAL': return this._applyEntryRevealChoice(pid, action.cardInstanceId || null);
      case 'CHOOSE_HIDEAWAY': return this._applyHideawayChoice(pid, action.cardInstanceId || null);
      case 'DECLINE_HIDEAWAY_PLAY': return this._applyHideawayDecline(pid);
      case 'PLAY_HIDEAWAY_LAND': return this._applyHideawayLand(pid, action.cardInstanceId);
      case 'PLAY_LAND': return this._applyPlayLand(pid, action.cardInstanceId);
      case 'CAST_SPELL':
      case 'CAST_COMMANDER':
        return this.events.dispatch(ENGINE_EVENT.CAST, { playerId: pid, action: structuredClone(action) }, { cause: `action:${action.type}`, stabilize: false });
      case 'ACTIVATE_MANA': return this._applyActivateMana(pid, action.permanentId, action.ability, action.manaColor); 
      case 'ACTIVATE_ABILITY': return this._applyActivateAbility(pid, action.permanentId, action.ability, action.targets || [], action.selections || []);
      case 'FORETELL_CARD': return this._applyForetell(pid, action.cardInstanceId);
      case 'ENCORE_CARD': return this._applyEncore(pid, action.cardInstanceId);
      case 'PASS_PRIORITY': return this._applyPassPriority(pid);
      case 'LOOP_SHORTCUT': return this.loops.executeShortcut(pid, action);
      case 'DECLARE_ATTACKERS': return this.events.dispatch(ENGINE_EVENT.ATTACK, { playerId: pid, attackers: action.attackers || [], attackTargets: action.attackTargets || {}, attackPayments: action.attackPayments || {} }, { cause: 'action:DECLARE_ATTACKERS', stabilize: false });
      case 'DECLARE_BLOCKERS': return this.events.dispatch(ENGINE_EVENT.BLOCK, { playerId: pid, blockers: action.blockers || {} }, { cause: 'action:DECLARE_BLOCKERS', stabilize: false });
      default: throw new Error(`Unknown action ${action.type}`);
    }
  }

  _validatePregameAction(pid, action) {
    const s = this.state;
    if (s.pregame.currentPlayer !== pid) throw new Error('It is not this player’s mulligan decision');
    if (action.type === 'MULLIGAN' || action.type === 'KEEP_HAND') return true;
    throw new Error('Only mulligan or keep-hand actions are legal during this pregame window');
  }

  _validateChoiceAction(pid, action) {
    const choice = this.state.pendingChoice;
    if (choice.playerId !== pid) throw new Error('This choice belongs to the other player');
    if (choice.type === 'ENGINE_CHOICE') {
      if (action.type !== 'SUBMIT_CHOICE' || !action.response) throw new Error('Submit a ChoiceResponse for the pending ChoiceRequest');
      this.choices.validateResponse(pid, action.response, this.choices.getSnapshot());
      return true;
    }
    if (choice.type === 'COMBAT_DAMAGE_ORDER') {
      if (action.type !== 'ORDER_BLOCKERS') throw new Error('Choose blocker damage assignment order before taking another action');
      return this.combat.validateDamageAssignmentOrder(pid, action.orders || {});
    }
    if (choice.type === 'LEGEND_RULE') {
      if (action.type !== 'CHOOSE_LEGEND') throw new Error('Choose one legendary permanent to keep');
      if (!choice.permanentIds.includes(action.keepInstanceId)) throw new Error('The chosen permanent is not part of this legend-rule choice');
      if (!this.findPermanent(action.keepInstanceId)) throw new Error('The chosen legendary permanent is no longer on the battlefield');
      return true;
    }
    if (choice.type === 'PREGAME_ACTION') return this.pregameRules.actions.validateChoice(pid, action);
    if (choice.type === 'COMMANDER_ZONE') {
      if (action.type !== 'CHOOSE_COMMANDER_ZONE' || typeof action.moveToCommand !== 'boolean') {
        throw new Error('Choose whether to move the commander to the command zone');
      }
      return true;
    }
    if (choice.type === 'WARD_PAYMENT') {
      if (action.type === 'DECLINE_WARD') return true;
      if (action.type !== 'PAY_WARD') throw new Error('Choose whether to pay the ward cost');
      if (!this.canPayWard(choice)) throw new Error('Ward cost cannot be paid');
      return true;
    }
    if (choice.type === 'OPTIONAL_TRIGGER') {
      if (action.type !== 'CHOOSE_TRIGGER' || typeof action.accept !== 'boolean') throw new Error('Choose whether to use the optional trigger');
      if (action.triggerId && action.triggerId !== choice.triggerId) throw new Error('That optional trigger is not the pending choice');
      return true;
    }
    if (choice.type === 'OPTIONAL_MANA_PAYMENT') {
      if (action.type !== 'CHOOSE_OPTIONAL_MANA_PAYMENT' || typeof action.pay !== 'boolean') throw new Error('Choose whether to pay the optional mana cost');
      if (action.pay && !this.mana.canAfford(this.state.players[pid], this.db, choice.mana || '', 0, this, { kind: 'other' })) throw new Error('The optional mana cost cannot be paid');
      return true;
    }
    if (choice.type === 'TAP_OR_UNTAP') {
      if (action.type !== 'CHOOSE_TAP_OR_UNTAP' || !['tap','untap','none'].includes(action.choice)) throw new Error('Choose whether to tap, untap, or leave the target unchanged');
      return true;
    }
    if (choice.type === 'OPTIONAL_EFFECT') {
      if (action.type !== 'CHOOSE_OPTIONAL_EFFECT' || typeof action.accept !== 'boolean') throw new Error('Choose whether to use the optional effect');
      return true;
    }
    if (choice.type === 'TRIGGER_ORDER') {
      if (action.type !== 'ORDER_TRIGGERS') throw new Error('Order the simultaneous triggers before taking another action');
      const ids = action.triggerIds;
      if (!Array.isArray(ids) || ids.length !== choice.triggerIds.length || new Set(ids).size !== ids.length) throw new Error('Order every simultaneous trigger exactly once');
      if (ids.some(id => !choice.triggerIds.includes(id))) throw new Error('Trigger order contains an invalid trigger');
      return true;
    }
    if (choice.type === 'PROLIFERATE') {
      if (action.type !== 'CHOOSE_PROLIFERATE') throw new Error('Choose the permanents and players to proliferate');
      const ids = action.targetIds;
      if (!Array.isArray(ids) || new Set(ids).size !== ids.length) throw new Error('Proliferate choices must be unique');
      if (ids.some(id => !choice.eligibleIds.includes(id))) throw new Error('Proliferate selection contains an ineligible object');
      return true;
    }
    if (choice.type === 'PHASE_OUT_PROLIFERATED') {
      if (action.type !== 'CHOOSE_PHASE_OUT_PROLIFERATED') throw new Error('Choose which proliferated permanents phase out');
      const ids = action.permanentIds;
      if (!Array.isArray(ids) || new Set(ids).size !== ids.length) throw new Error('Phase-out choices must be unique');
      if (ids.some(id => !choice.eligibleIds.includes(id))) throw new Error('Only permanents that received counters from this proliferate may phase out');
      return true;
    }
    if (choice.type === 'REPLACEMENT_ORDER') {
      if (action.type !== 'ORDER_REPLACEMENTS') throw new Error('Choose the order of applicable replacement effects');
      const ids = action.replacementIds;
      if (!Array.isArray(ids) || ids.length !== choice.replacementIds.length || new Set(ids).size !== ids.length) throw new Error('Order every replacement effect exactly once');
      if (ids.some(id => !choice.replacementIds.includes(id))) throw new Error('Replacement order contains an invalid effect');
      return true;
    }
    if (choice.type === 'EXPLORE_NONLAND') {
      if (action.type !== 'CHOOSE_EXPLORE' || typeof action.putInGraveyard !== 'boolean') {
        throw new Error('Choose whether the revealed nonland stays on top or goes to the graveyard');
      }
      const top = this.state.players[pid].library[0];
      if (!top || top.instanceId !== choice.cardInstanceId) throw new Error('The revealed explore card is no longer on top of the library');
      return true;
    }
    if (choice.type === 'EXPLORE_ORDER') {
      if (action.type !== 'ORDER_EXPLORES') throw new Error('Choose the order in which your creatures explore');
      const ids = action.permanentIds;
      if (!Array.isArray(ids) || ids.length !== choice.permanentIds.length || new Set(ids).size !== ids.length) throw new Error('Order every exploring creature exactly once');
      if (ids.some(id => !choice.permanentIds.includes(id))) throw new Error('Explore order contains an invalid creature');
      return true;
    }
    if (choice.type === 'HAKBAL_ATTACK') {
      if (action.type !== 'CHOOSE_HAKBAL_ATTACK') throw new Error('Choose a land to put onto the battlefield or draw a card');
      if (action.landInstanceId != null && !choice.landInstanceIds.includes(action.landInstanceId)) throw new Error('That card is not an eligible land in your hand');
      return true;
    }
    if (choice.type === 'CULTIVATE_SEARCH') {
      if (action.type !== 'CHOOSE_CULTIVATE') throw new Error('Choose up to two basic lands for Cultivate');
      const ids = action.cardInstanceIds;
      if (!Array.isArray(ids) || ids.length > 2 || new Set(ids).size !== ids.length) throw new Error('Cultivate selects up to two distinct basic lands');
      if (ids.some(id => !choice.eligibleIds.includes(id))) throw new Error('Cultivate selection contains a nonbasic or unavailable card');
      return true;
    }
    if (choice.type === 'SISAY_TUTOR') {
      if (action.type !== 'CHOOSE_SISAY_TUTOR') throw new Error('Choose a legal legendary permanent for Sisay');
      if (action.cardInstanceId != null && !choice.eligibleIds.includes(action.cardInstanceId)) throw new Error('That card is not a legal Sisay search result');
      return true;
    }
    if (choice.type === 'SCRY') {
      if (action.type !== 'CHOOSE_SCRY' || typeof action.putOnBottom !== 'boolean') throw new Error('Choose whether to keep the scry card on top or put it on the bottom');
      const top = this.state.players[pid].library[0];
      if (!top || top.instanceId !== choice.cardInstanceId) throw new Error('The scry card is no longer on top of the library');
      return true;
    }
    if (choice.type === 'TRIGGER_TARGET') {
      if (action.type !== 'CHOOSE_TRIGGER_TARGET') throw new Error('Choose targets for the triggered ability');
      const ids = action.targetIds;
      if (!Array.isArray(ids) || ids.length < choice.minTargets || ids.length > choice.maxTargets || new Set(ids).size !== ids.length) throw new Error('Choose a legal number of unique trigger targets');
      if (ids.some(id => !choice.candidateIds.includes(id))) throw new Error('Triggered ability target is not legal');
      if (choice.targetSource) this.targeting.validateTargets(pid, choice.targetSource, ids, { sourceObject: choice.sourceObjectId ? this._queryObject(choice.sourceObjectId) : null });
      return true;
    }
    if (choice.type === 'CREATURE_TYPE') {
      if (action.type !== 'CHOOSE_CREATURE_TYPE' || typeof action.creatureType !== 'string') throw new Error('Choose a creature type');
      if (!choice.options.includes(action.creatureType)) throw new Error('That creature type is not available');
      return true;
    }
    if (choice.type === 'LIBRARY_SEARCH') {
      if (action.type !== 'CHOOSE_LIBRARY_SEARCH') throw new Error('Choose cards for the pending library search');
      this.libraryOps.validateSearchChoice(choice, action.cardInstanceIds || []);
      return true;
    }
    if (choice.type === 'EFFECT_CARD_CHOICE') {
      if (action.type !== 'CHOOSE_EFFECT_CARDS') throw new Error('Choose the requested cards');
      const ids = action.cardInstanceIds;
      if (!Array.isArray(ids) || ids.length < choice.min || ids.length > choice.max || new Set(ids).size !== ids.length) throw new Error(`Choose between ${choice.min} and ${choice.max} cards`);
      if (ids.some(id => !choice.candidateIds.includes(id))) throw new Error('Selected card is not eligible for this effect');
      if (choice.continuation?.type === 'myriadLandscape' && ids.length > 1) {
        const defs = ids.map(id => this.db[ZoneManager.find(this.state, id)?.card?.cardId] || {});
        const basicTypes = ['Plains','Island','Swamp','Mountain','Forest'];
        const shared = basicTypes.some(type => defs.every(def => hasSubtype(def, type)));
        if (!shared) throw new Error('Myriad Landscape requires the chosen basic lands to share a land type');
      }
      return true;
    }
    if (choice.type === 'COPY_TARGETS') {
      if (action.type !== 'CHOOSE_COPY_TARGETS') throw new Error('Choose targets for the spell or ability copy');
      const ids = action.targetIds;
      if (!Array.isArray(ids) || ids.length !== choice.originalTargets.length) throw new Error('A copy keeps the same number of targets');
      this.targeting.validateTargetMultiplicity(choice.targetSource, ids);
      ids.forEach((id, index) => {
        if (id === choice.originalTargets[index]) return; // An unchanged target need not currently be legal.
        this.targeting.validateTarget(pid, id, this.targeting.specFor(choice.targetSource, index), { sourceObject: choice.copyItem.card || choice.copyItem.source, selectedTargets: ids });
      });
      return true;
    }
    if (choice.type === 'COPY_PERMANENT') {
      if (action.type !== 'CHOOSE_PERMANENT_COPY') throw new Error('Choose a permanent to copy');
      if (action.permanentId == null) {
        if (!choice.optional) throw new Error('A permanent must be chosen for this copy effect');
        return true;
      }
      if (!choice.candidateIds.includes(action.permanentId)) throw new Error('That permanent cannot be copied by this effect');
      if (!this.findPermanent(action.permanentId)) throw new Error('The chosen permanent is no longer on the battlefield');
      return true;
    }
    if (choice.type === 'ATTACHMENT_ENTRY') {
      if (action.type !== 'CHOOSE_ATTACHMENT_HOST') throw new Error('Choose a legal object for the Aura to enchant');
      if (!choice.candidateIds.includes(action.hostId)) throw new Error('That object cannot be enchanted by this Aura');
      const card = this.zones.find(choice.sourceId)?.card;
      if (!card || !this.attachments.isLegalHost(card, action.hostId, { targeted: false })) throw new Error('The chosen Aura host is no longer legal');
      return true;
    }
    if (choice.type === 'ENTRY_LIFE_PAYMENT') {
      if (action.type !== 'CHOOSE_ENTRY_LIFE_PAYMENT' || typeof action.pay !== 'boolean') throw new Error('Choose whether to pay life for this land to enter untapped');
      if (action.pay && this.state.players[pid].life < Number(choice.lifeCost || 0)) throw new Error('You do not have enough life to make this payment');
      return true;
    }
    if (choice.type === 'ENTRY_REVEAL') {
      if (action.type !== 'CHOOSE_ENTRY_REVEAL') throw new Error('Choose whether to reveal a qualifying land card');
      if (action.cardInstanceId != null && !choice.candidateIds.includes(action.cardInstanceId)) throw new Error('That card cannot be revealed for this land');
      return true;
    }
    if (choice.type === 'HIDEAWAY') {
      if (action.type !== 'CHOOSE_HIDEAWAY') throw new Error('Choose a card for hideaway');
      if (choice.candidateIds.length && !choice.candidateIds.includes(action.cardInstanceId)) throw new Error('Choose one of the cards looked at with hideaway');
      return true;
    }
    if (choice.type === 'HIDEAWAY_PLAY') {
      if (action.type === 'DECLINE_HIDEAWAY_PLAY') return true;
      if (action.cardInstanceId !== choice.cardInstanceId) throw new Error('Only the card hidden with this permanent may be played');
      if (action.type === 'PLAY_HIDEAWAY_LAND') return this._validateHideawayLand(pid, action);
      if (action.type === 'CAST_SPELL' && action.castOption === 'hideaway') return this._validateCast(pid, action);
      throw new Error('Choose whether to play the hideaway card');
    }
    const expected = choice.type === 'MULLIGAN_BOTTOM' ? 'BOTTOM_CARDS' : 'DISCARD_CARDS';
    if (action.type !== expected) throw new Error(`Must complete ${choice.type} before taking another action`);
    const ids = action.cardInstanceIds;
    if (!Array.isArray(ids) || ids.length !== choice.count) throw new Error(`Select exactly ${choice.count} card(s)`);
    if (new Set(ids).size !== ids.length) throw new Error('A card cannot be selected twice');
    const handIds = new Set(this.state.players[pid].hand.map(c => c.instanceId));
    if (ids.some(id => !handIds.has(id))) throw new Error('All selected cards must be in the acting player’s hand');
    return true;
  }

  _validateLand(pid, action) {
    const s = this.state, p = s.players[pid];
    if (!this.timing.assess(pid, action).allowed) throw new Error('Illegal land timing');
    if (p.landPlaysRemaining + this.legality.additionalLandPlays(pid) < 1) throw new Error('No land plays remaining');
    const f = ZoneManager.find(s, action.cardInstanceId);
    if (!f || f.zone !== 'hand' || f.player?.id !== pid || f.card.owner !== pid) throw new Error('Land must be in the acting player’s hand');
    if (!isType(this.db[f.card.cardId], 'Land')) throw new Error('Selected card is not a land');
    return true;
  }

  _validateHideawayLand(pid, action) {
    const s = this.state, p = s.players[pid], choice = s.pendingChoice;
    if (!choice || choice.type !== 'HIDEAWAY_PLAY' || choice.playerId !== pid) throw new Error('No hideaway play choice is pending');
    if (pid !== s.activePlayer) throw new Error('A land hidden with Mosswort Bridge may only be played on your turn');
    if (p.landPlaysRemaining + this.legality.additionalLandPlays(pid) < 1) throw new Error('No land plays remaining');
    const f = ZoneManager.find(s, action.cardInstanceId);
    if (!f || f.zone !== 'exile' || f.player?.id !== pid || f.card.owner !== pid || f.card.exiledBy !== choice.sourceId) throw new Error('The hidden land is not available to play');
    if (!isType(this.db[f.card.cardId], 'Land')) throw new Error('The hideaway card is not a land');
    return true;
  }

  _modeFor(definition, modeId = null) {
    if (!definition || !modeId) return null;
    const explicit = Array.isArray(definition.modes) ? definition.modes.find(mode => mode.id === modeId) : null;
    if (explicit) return explicit;
    const xMode = definition.xMode;
    if (!xMode?.prefix || !String(modeId).startsWith(xMode.prefix)) return null;
    const raw = String(modeId).slice(String(xMode.prefix).length);
    if (!/^\d+$/.test(raw)) return null;
    const x = Number(raw);
    if (x < Number(xMode.min ?? 0)) return null;
    const mode = {
      id: String(modeId),
      label: String(xMode.label || `${xMode.prefix}X={X}`).replaceAll('{X}', String(x)),
      fromZone: xMode.fromZone || 'hand',
      manaCost: xMode.manaCost ?? definition.manaCost ?? '',
      extraGeneric: xMode.extraGenericFromX === false ? Number(xMode.extraGeneric || 0) : x,
      effects: structuredClone(xMode.effects || definition.spellEffects || []),
      xValue: x
    };
    if (xMode.timing) mode.timing = xMode.timing;
    if (xMode.target) {
      mode.targets = structuredClone(xMode.target);
      if (xMode.targetCountFromX) {
        mode.minTargets = x;
        mode.maxTargets = x;
        if (typeof mode.targets === 'object' && !Array.isArray(mode.targets)) {
          mode.targets.minTargets = x;
          mode.targets.maxTargets = x;
        }
      }
    }
    return mode;
  }

  dynamicXModesFor(pid, card, zone, castOption = null) {
    const definition = this.db[card?.cardId] || {};
    const xMode = definition.xMode;
    if (!xMode?.prefix) return [];
    const out = [];
    const min = Math.max(0, Number(xMode.min ?? 0));
    // Costs only increase as X increases in the supported schema, so the first
    // unaffordable X is a safe stopping point. Free casts can only choose X=0.
    for (let x = min; x <= 1000; x++) {
      if ((card.freeCast || castOption === 'hideaway') && String(xMode.prefix || '').startsWith('x-') && x > 0) break;
      const mode = this._modeFor(definition, `${xMode.prefix}${x}`);
      if (!mode) break;
      if (xMode.targetCountFromX) {
        const candidates = this.targeting.getCandidates(pid, mode, [], { sourceObject: card });
        if (candidates.length < x) break;
      }
      const info = this._castCostInfo(pid, card, zone, mode.id, [], castOption);
      if (!this.payments.canPayLockedCost(pid, info.lockedCost, { context: { kind: 'cast', card } })) break;
      out.push(mode);
    }
    return out;
  }

  _adjustGenericCost(cost = '', adjustment = 0) {
    const symbols = [...String(cost).matchAll(/\{([^}]+)\}/g)].map(match => match[1]);
    let generic = 0;
    const rest = [];
    for (const symbol of symbols) {
      if (/^\d+$/.test(symbol)) generic += Number(symbol);
      else if (!['X','Y','Z'].includes(symbol.toUpperCase())) rest.push(`{${symbol}}`);
    }
    generic = Math.max(0, generic + Number(adjustment || 0));
    return `${generic ? `{${generic}}` : ''}${rest.join('')}`;
  }

  _castDefinition(card, castFaceIndex = null) {
    const root = this.db[card?.cardId] || {};
    if (!Number.isInteger(castFaceIndex)) return root;
    const model = createCardFaceModel(root);
    if (model.layout !== 'modal_dfc') throw new Error('A spell face may only be selected for a modal double-faced card');
    if (castFaceIndex < 0 || castFaceIndex >= model.faces.length) throw new Error('Invalid modal double-faced card face');
    const virtual = { ...card, zone: 'stack', faceState: { ...(card.faceState || {}), castFaceIndex } };
    return getObjectCardDefinition(root, virtual, 'stack');
  }

  _castCostInfo(pid, card, zone, mode, targets = [], castOption = null, castFaceIndex = null) {
    const lockedCost = this.costs.determineSpellCost(pid, card, { zone, mode, targets, castOption, castFaceIndex });
    const d = this._castDefinition(card, castFaceIndex);
    const selectedMode = this._modeFor(d, mode);
    return {
      mode: selectedMode,
      cost: lockedCost.finalManaCost,
      lockedCost,
      commanderTax: Number(lockedCost.stages.commanderTax || 0),
      extraGeneric: Number(lockedCost.stages.modeIncrease || 0),
      targetTax: Number(lockedCost.stages.targetTax || 0),
      reduction: Number(lockedCost.stages.staticReduction || 0)
    };
  }

  _validateCast(pid, action) {
    const s = this.state;
    const f = ZoneManager.find(s, action.cardInstanceId);
    if (!f) throw new Error('Card is not in a castable zone');
    const d = this._castDefinition(f.card, action.castFaceIndex ?? null);
    const mode = this._modeFor(d, action.mode);
    const allowedModeZone = mode?.fromZone || null;
    const retrace = action.castOption === 'retrace';
    const topCast = action.castOption === 'top';
    const hideaway = action.castOption === 'hideaway';
    const foretold = action.castOption === 'foretold' || mode?.foretold;
    const allowed = ['hand','command'].includes(f.zone)
      || (allowedModeZone && f.zone === allowedModeZone)
      || (retrace && f.zone === 'graveyard' && this.static.hasRetrace(pid, f.card))
      || (foretold && f.zone === 'exile' && f.card.foretold)
      || (topCast && f.zone === 'library' && this.canCastTopCard(pid, f.card))
      || (hideaway && f.zone === 'exile' && this.state.pendingChoice?.type === 'HIDEAWAY_PLAY' && this.state.pendingChoice.playerId === pid && this.state.pendingChoice.cardInstanceId === f.card.instanceId && f.card.exiledBy === this.state.pendingChoice.sourceId)
      || this.legality.permitsCastFromZone(pid, f.card, f.zone);
    if (!allowed) throw new Error('Card is not in a castable zone');
    if (f.player?.id !== pid || f.card.owner !== pid) throw new Error('Cannot cast a card owned by another player from their zone');
    if (action.type === 'CAST_COMMANDER' && (f.zone !== 'command' || !f.card.isCommander)) throw new Error('CAST_COMMANDER requires your commander in the command zone');
    if (action.type === 'CAST_SPELL' && f.zone === 'command') throw new Error('Use CAST_COMMANDER for a commander in the command zone');
    if (!d || isType(d, 'Land')) throw new Error('Lands are not cast as spells');
    if (d.castOnlyFromSuspend && !f.card.suspended) throw new Error('This card has no mana cost and must be cast from suspend');
    if (hideaway && mode?.fromZone && mode.fromZone !== 'hand') throw new Error('That face of the card cannot be cast from hideaway');
    if (foretold && Number(f.card.foretoldTurn ?? s.turn) >= Number(s.turn)) throw new Error('A foretold card may only be cast on a later turn');
    if (((Array.isArray(d.modes) && d.modes.length) || d.xMode) && !mode) throw new Error('A valid spell mode is required');
    if (mode?.condition?.descend8) {
      const count = this.state.players[pid].graveyard.filter(card => {
        const def = this.db[card.cardId];
        return def && !isType(def,'Instant') && !isType(def,'Sorcery');
      }).length;
      if (count < 8) throw new Error('Descend 8 is not satisfied');
    }
    if (!hideaway && !this._canCastAtCurrentTiming(pid, f.card, f.zone, action.mode, action.castFaceIndex ?? null)) throw new Error('Spell cannot be cast at this time');
    if (retrace) {
      const discard = ZoneManager.find(s, action.retraceLandInstanceId);
      if (!discard || discard.zone !== 'hand' || discard.player?.id !== pid || !isType(this.db[discard.card.cardId], 'Land')) throw new Error('Retrace requires choosing a land card from your hand to discard');
    }
    const targetSource = this.targetSourceForAction(action, d);
    this._validateTargets(pid, targetSource, action.targets || [], { sourceObject: f.card });
    const info = this._castCostInfo(pid, f.card, f.zone, action.mode, action.targets || [], action.castOption || null, action.castFaceIndex ?? null);
    if (!this.payments.canPayLockedCost(pid, info.lockedCost, { context: { kind: 'cast', card: f.card } })) throw new Error('Insufficient mana');
    return true;
  }

  targetSourceForAction(action, definition = null) {
    const d = definition || (() => {
      const found = action?.cardInstanceId ? ZoneManager.find(this.state, action.cardInstanceId) : null;
      return found?.card ? this.db[found.card.cardId] : null;
    })();
    if (!d) return d;
    if ((Array.isArray(d.modes) && d.modes.length) || d.xMode) {
      const mode = this._modeFor(d, action?.mode);
      if (!mode) throw new Error('A valid spell mode is required');
      return mode;
    }
    if (action?.mode) throw new Error('This spell has no selectable modes');
    // Aura spells target what their Enchant ability permits. Older card data
    // often stores only Oracle `Enchant ...` text, so synthesize the target
    // clause from the same AttachmentService filter used for ongoing legality.
    // Auras put directly onto the battlefield still use the non-targeting
    // ATTACHMENT_ENTRY choice path instead.
    if (!d.targets && !d.target && hasSubtype(d, 'Aura') && action?.cardInstanceId) {
      const found = ZoneManager.find(this.state, action.cardInstanceId);
      if (found?.card) return { ...d, targets: this.attachments.legalHostFilter(found.card) };
    }
    return d;
  }

  _canCastAtCurrentTiming(pid, card, zone, modeId = null, castFaceIndex = null) {
    return this.timing.allowsSpell(pid, card, zone, modeId, castFaceIndex);
  }

  _findDefinedAbility(permanent, supplied) {
    const d = this.db[permanent.cardId];
    if (!supplied || !d) return null;
    const key = JSON.stringify(supplied);
    return this.static.effectiveAbilities(permanent).find(a => JSON.stringify(a) === key) || null;
  }

  _validateAbility(pid, action, manaAbility) {
    const perm = this.findPermanent(action.permanentId);
    if (!perm || perm.controller !== pid || perm.zone !== 'battlefield') throw new Error('Ability source is not a permanent you control');
    const ability = this._findDefinedAbility(perm, action.ability);
    if (!ability) throw new Error('Ability is not printed on the selected permanent');
    if (manaAbility ? ability.type !== 'mana' : ability.type !== 'activated') throw new Error(manaAbility ? 'Not a mana ability' : 'Not an activated ability');
    if (manaAbility && ability.autoOnly) throw new Error('This restricted mana ability is used automatically only for legal payments');
    const requiresTap = manaAbility ? ability.tap !== false : !!ability.tap;
    if (requiresTap && perm.tapped) throw new Error('Permanent is already tapped');
    if (requiresTap && this.static.isType(perm, 'Creature') && perm.summoningSick) {
      if (!this.mechanics.canIgnoreSummoningSickness(perm)) throw new Error('Summoning-sick creature cannot pay a tap cost');
    }
    if (manaAbility && ability.anyColor) {
      const choices = this.mana.anyColorChoices(this.state.players[pid], ability);
      if (!action.manaColor) throw new Error('A mana color choice is required');
      if (!choices.includes(action.manaColor)) throw new Error('Illegal mana color choice');
    } else if (manaAbility && action.manaColor) {
      throw new Error('This mana ability does not require a color choice');
    }
    if (!this.timing.allowsAbility(pid, perm, ability, { manaAbility })) {
      throw new Error(ability.sorcerySpeed ? 'Ability may only be activated at sorcery speed' : 'Ability cannot be activated at this time');
    }
    const lifeCost = ability.cost?.life || 0;
    if (lifeCost > this.state.players[pid].life) throw new Error('Cannot pay life cost');
    if (ability.condition?.noPlusOneCounters && Number(perm.counters?.['+1/+1'] || 0) > 0) throw new Error('Adapt can only be activated if this creature has no +1/+1 counters');
    if (ability.condition?.controlLandsMin != null && this.state.players[pid].battlefield.filter(card => this.static.isType(card, 'Land')).length < Number(ability.condition.controlLandsMin)) throw new Error('Not enough lands to activate this ability');
    if (ability.selection) this._validateAbilitySelections(pid, perm, ability.selection, action.selections || []);
    this._validateTargets(pid, ability, action.targets || [], { sourceObject: perm });
    const lockedAbilityCost = this.costs.determineAbilityCost(pid, perm, ability, {
      targets: action.targets || [], selections: action.selections || [], defaultTap: manaAbility
    });
    if (!this.payments.canPayLockedCost(pid, lockedAbilityCost, { context: { kind: 'ability', source: perm, ability } })) throw new Error('Insufficient resources for ability');
    if (ability.cost?.removeCounterSelf) {
      const spec = ability.cost.removeCounterSelf;
      if (Number(perm.counters?.[spec.counter || '+1/+1'] || 0) < Number(spec.amount || 1)) throw new Error('Not enough counters to pay ability cost');
    }
    if (ability.cost?.removeCounterFromSelection) {
      const spec = ability.cost.removeCounterFromSelection;
      const type = spec.counter || '+1/+1';
      const amount = Number(spec.amount || 1);
      for (const id of action.selections || []) {
        const selected = this.findPermanent(id);
        if (!selected || Number(selected.counters?.[type] || 0) < amount) throw new Error('Selected permanent lacks the required counter');
      }
    }
    return true;
  }

  _selectionCandidates(pid, source, spec = {}) {
    const player = this.state.players[pid];
    return player.battlefield.filter(permanent => {
      if (permanent.phasedOut || (spec.tap !== false && permanent.tapped)) return false;
      if (spec.other && permanent.instanceId === source.instanceId) return false;
      if (spec.type && !this.static.isType(permanent, spec.type)) return false;
      if (spec.subtype && !this.static.hasSubtype(permanent, spec.subtype)) return false;
      if (spec.hasCounter && Number(permanent.counters?.[spec.hasCounter] || 0) <= 0) return false;
      return true;
    });
  }

  _validateAbilitySelections(pid, source, spec, ids = []) {
    const count = Number(spec.count || 0);
    if (!Array.isArray(ids) || ids.length !== count || new Set(ids).size !== ids.length) throw new Error(`Choose exactly ${count} permanent(s) for the ability cost`);
    const legal = new Set(this._selectionCandidates(pid, source, spec).map(card => card.instanceId));
    if (ids.some(id => !legal.has(id))) throw new Error('An illegal permanent was selected for the ability cost');
    return true;
  }

  _validateTargets(pid, source, targets, context = {}) {
    return this.targeting.validateTargets(pid, source, targets, context);
  }

  _validateTarget(pid, targetId, spec, context = {}) {
    return this.targeting.validateTarget(pid, targetId, spec, context);
  }

  _validateDeclareAttackers(pid, action) {
    if (action.type !== 'DECLARE_ATTACKERS') throw new Error('Attackers must be declared before priority is given');
    if (this.state.phase !== 'DECLARE_ATTACKERS' || pid !== this.state.activePlayer) throw new Error('Not time to declare attackers');
    const ids = action.attackers || [];
    if (!Array.isArray(ids) || new Set(ids).size !== ids.length) throw new Error('Invalid attacker list');
    const legal = new Set(this.combat.legalAttackers(pid).map(x => x.instanceId));
    if (ids.some(id => !legal.has(id))) throw new Error('Illegal attacker');
    this.combat.validateAttackers(pid, ids, action.attackTargets || {}, action.attackPayments || {});
    return true;
  }

  _validateDeclareBlockers(pid, action) {
    if (action.type !== 'DECLARE_BLOCKERS') throw new Error('Blockers must be declared before priority is given');
    if (this.state.phase !== 'DECLARE_BLOCKERS' || pid === this.state.activePlayer) throw new Error('Not time to declare blockers');
    if (this.state.combat.currentDefender && pid !== this.state.combat.currentDefender) throw new Error('It is not this defending player’s blocker declaration');
    this.combat.validateBlockers(pid, action.blockers || {});
    return true;
  }

  _applyMulligan(pid) {
    const p = this.state.players[pid];
    for (const card of [...p.hand]) this._moveZoneNow(card, 'library', pid);
    this.shuffleLibrary(pid, 'mulligan');
    p.mulligans++;
    this.draw(pid, 7);
    this.state.priorityPlayer = pid;
    return p.hand;
  }

  _applyKeepHand(pid) {
    const p = this.state.players[pid];
    const bottoms = this.pregameRules.bottomCount(pid);
    if (bottoms > 0) {
      this.state.pendingChoice = { type: 'MULLIGAN_BOTTOM', playerId: pid, count: bottoms };
      this.state.priorityPlayer = pid;
      return this.state.pendingChoice;
    }
    this._markPregameKept(pid, INTERNAL);
    return true;
  }

  _applyBottomCards(pid, ids) {
    for (const id of ids) {
      const found = ZoneManager.find(this.state, id);
      this._moveZoneNow(found.card, 'library', pid);
    }
    this.state.pendingChoice = null;
    this._markPregameKept(pid, INTERNAL);
    return ids;
  }

  _markPregameKept(pid, token) {
    if (token !== INTERNAL) throw new Error('Pregame transition is internal');
    const s = this.state;
    s.pregame.kept[pid] = true;
    const next = s.playerOrder.find(id => !s.pregame.kept[id]);
    if (next) {
      s.pregame.currentPlayer = next;
      s.priorityPlayer = next;
      return;
    }
    this.pregameRules.completeMulligans();
  }

  _applyDiscardCards(pid, ids) {
    for (const id of ids) this.discardCard(pid, id, 'cleanup-discard');
    this.state.pendingChoice = null;
    this._completeCleanupTurnBased(INTERNAL);
    return ids;
  }

  _beginPhase(token) {
    if (token !== INTERNAL) throw new Error('Phase transitions are internal; pass priority instead');
    return this.turn.beginCurrentStep(token);
  }

  _advancePhase(token) {
    if (token !== INTERNAL) throw new Error('Phase transitions are internal; pass priority instead');
    return this.turn.advance(token);
  }

  _finishTurn(token) {
    if (token !== INTERNAL) throw new Error('Turn transition is internal');
    return this.turn.finishTurn(token);
  }

  _castSuspendedCard(card, controller) {
    const found = ZoneManager.find(this.state, card?.instanceId);
    if (!found || found.zone !== 'exile' || !card.suspended) return false;
    this.zones.detach(card.instanceId);
    ZoneManager.prepareForZone(card, 'stack', controller, this.db[card.cardId] || {});
    card.suspended = false;
    if (this.counters.count(card, 'time') > 0) this.counters.removeWithoutChoice(card, 'time', this.counters.count(card, 'time'), { cause: 'suspend-cast-clear-time', skipReplacements: true });
    const item = this.stack.push({ id: `suspend-${card.instanceId}`, type: 'spell', controller, card, targets: [], mode: null, castOption: 'suspend' });
    this.emit(EVENT.SPELL_CAST, { controller, card, targets: [], castOption: 'suspend' });
    this.log('SUSPEND_CAST', { controller, card: card.cardId, instanceId: card.instanceId });
    return true;
  }

  _processSuspendUpkeep(playerId) {
    const player = this.state.players[playerId];
    for (const card of [...(player?.exile || [])]) {
      if (!card.suspended || Number(card.counters?.time || 0) <= 0) continue;
      this.removeCounters(card, 'time', 1, playerId);
      this.log('TIME_COUNTER_REMOVED', { controller: playerId, card: card.cardId, remaining: Number(card.counters?.time || 0) });
      if (Number(card.counters?.time || 0) <= 0) this._castSuspendedCard(card, playerId);
    }
  }

  _advanceSagas(playerId) {
    const sagas = [...(this.state.players[playerId]?.battlefield || [])].filter(card => this.static.hasSubtype(card, 'Saga'));
    for (const saga of sagas) this.effects.addCounters(playerId, saga, 'lore', 1);
  }

  _queueSagaChapters(saga, fromChapter, throughChapter) {
    const definition = this.db[saga?.cardId] || {};
    const chapters = definition.sagaChapters || [];
    for (const chapter of chapters.filter(item => item.number >= fromChapter && item.number <= throughChapter)) {
      this.stack.push({
        id: this._nextRuntimeId(`saga-${saga.instanceId}-${chapter.number}`),
        type: 'trigger', controller: saga.controller, source: structuredClone(saga),
        ability: { type: 'triggered', event: 'LORE_COUNTER_ADDED' },
        effect: { type: 'resolveSagaChapter', chapter: structuredClone(chapter) }, targets: []
      });
      this.log('SAGA_CHAPTER_TRIGGERED', { controller: saga.controller, card: saga.cardId, chapter: chapter.number });
    }
  }

  _beginCleanup(token) {
    if (token !== INTERNAL) throw new Error('Cleanup transition is internal');
    const s = this.state, p = s.players[s.activePlayer];
    s.priorityPlayer = null;
    s.passes = 0;
    s.cleanupPriority = false;
    const maxHand = this.static.maximumHandSize(s.activePlayer);
    const excess = Number.isFinite(maxHand) ? Math.max(0, p.hand.length - maxHand) : 0;
    if (excess > 0) {
      s.pendingChoice = { type: 'CLEANUP_DISCARD', playerId: s.activePlayer, count: excess };
      s.priorityPlayer = s.activePlayer;
      return;
    }
    this._completeCleanupTurnBased(INTERNAL);
  }

  _completeCleanupTurnBased(token) {
    if (token !== INTERNAL) throw new Error('Cleanup transition is internal');
    const s = this.state;
    for (const pp of Object.values(s.players)) {
      pp.damagePrevention = 0;
      for (const c of pp.battlefield) {
        c.damagePrevention = 0;
        c.damageMarked = 0;
        c.deathtouchMarked = false;
        c.modifiers = { power: 0, toughness: 0, keywords: [] };
      }
    }
    this.stateBasedActions();
    // Cleanup is a special rules boundary: if cleanup generated triggered
    // abilities, put them on the stack before deciding whether cleanup can end.
    // This explicit flush is correct even while an outer action is deferring
    // ordinary trigger placement, because cleanup priority exists only for this
    // rules activity and must be followed by another cleanup step.
    if (!s.pendingChoice && s.pendingTriggers.length) this.triggers.flush();
    if (s.pendingChoice) {
      s.pendingChoice.resume = 'CLEANUP';
      s.priorityPlayer = s.pendingChoice.playerId;
      return;
    }
    if (s.winner) { s.priorityPlayer = null; return; }
    if (s.stack.length) {
      s.cleanupPriority = true;
      s.priorityPlayer = s.activePlayer;
      s.passes = 0;
      return;
    }
    this._finishTurn(INTERNAL);
  }

  _applyPassPriority(pid) {
    return this.priority.pass(pid);
  }

  _resolveTop(token) {
    if (token !== INTERNAL) throw new Error('Stack resolution is internal and occurs after all players pass');
    return this.resolution.resolveTop();
  }

  creatureTypeOptions(pid) {
    const seen = new Set(['Merfolk','Wizard','Druid','Scout','Shaman','Warrior','Rogue','Noble','Soldier','Mutant']);
    const p = this.state.players[pid];
    for (const zone of ['library','hand','battlefield','graveyard','exile','command']) {
      for (const card of p?.[zone] || []) for (const subtype of this.db[card.cardId]?.subtypes || []) seen.add(subtype);
    }
    return [...seen].filter(Boolean).sort((a,b) => (a === 'Merfolk' ? -1 : b === 'Merfolk' ? 1 : a.localeCompare(b)));
  }

  _entryLifeCost(definition) {
    if (Number(definition?.entryLifePayment?.life || 0) > 0) return Number(definition.entryLifePayment.life);
    const text = String(definition?.oracleText || '');
    const match = text.match(/As [^\n.]+ enters(?: the battlefield)?,?\s*you may pay (\d+) life\.\s*If you (?:don['’]t|do not), (?:this land|it|[^.]+) enters tapped/i);
    return match ? Number(match[1]) : 0;
  }

  _entryRevealLandSubtypes(definition) {
    const explicit = definition?.entersTappedUnless?.revealLandSubtypes || [];
    if (explicit.length) return [...explicit];
    const text = String(definition?.oracleText || '');
    const match = text.match(/As [^\n.]+ enters(?: the battlefield)?,?\s*you may reveal ([^.]+?) card from your hand\.\s*If you (?:don['’]t|do not), (?:this land|it|[^.]+) enters tapped/i);
    if (!match) return [];
    const basics = ['Plains','Island','Swamp','Mountain','Forest'];
    return basics.filter(type => new RegExp(`\\b${type}\\b`, 'i').test(match[1]));
  }

  _conditionalLandEntrySatisfied(definition, controller) {
    const player = this.state.players[controller];
    const text = String(definition?.oracleText || '');
    const rule = definition?.entersTappedUnless || {};
    if (rule.controlLandSubtypes?.length) {
      return player.battlefield.some(land => this.static.isType(land, 'Land') && rule.controlLandSubtypes.some(type => this.static.hasSubtype(land, type)));
    }
    if (/enters tapped unless you control two or more other lands/i.test(text)) {
      return player.battlefield.filter(card => this.static.isType(card, 'Land')).length >= 2;
    }
    if (/enters tapped unless you control two or more basic lands/i.test(text)) {
      return player.battlefield.filter(card => /\bBasic Land\b/i.test(this.db[card.cardId]?.typeLine || '')).length >= 2;
    }
    if (/enters tapped unless you control two or fewer other lands/i.test(text)) {
      return player.battlefield.filter(card => this.static.isType(card, 'Land')).length <= 2;
    }
    if (/enters tapped unless you have two or more opponents/i.test(text)) return this.opponents(controller).length >= 2;
    if (/enters tapped unless you control (?:a )?legendary creature/i.test(text)) {
      return player.battlefield.some(card => /\bLegendary\b/i.test(this.db[card.cardId]?.typeLine || '') && this.static.isType(card, 'Creature'));
    }
    const subtypeMatch = text.match(/enters tapped unless you control (?:an? )?(Plains|Island|Swamp|Mountain|Forest)(?: or (?:an? )?(Plains|Island|Swamp|Mountain|Forest))?/i);
    if (subtypeMatch) {
      const subtypes = subtypeMatch.slice(1).filter(Boolean);
      return player.battlefield.some(land => this.static.isType(land, 'Land') && subtypes.some(type => this.static.hasSubtype(land, type)));
    }
    return null;
  }

  _permanentEntersTapped(card, controller) {
    const d = this.db[card.cardId] || {};
    const lifeCost = this._entryLifeCost(d);
    if (lifeCost > 0) return card.entryLifePaid !== true;
    const revealSubtypes = this._entryRevealLandSubtypes(d);
    if (revealSubtypes.length) return card.entryRevealSucceeded !== true;
    const conditionSatisfied = this._conditionalLandEntrySatisfied(d, controller);
    if (conditionSatisfied != null) return !conditionSatisfied;
    if (d.entersTapped) return true;
    return false;
  }

  _applyEntryCounters(card, controller) {
    const d = this.copy?.definitionForObject(card) || this.db[card.cardId] || {};
    if (d.entersWithCounters) {
      const rule = d.entersWithCounters;
      let amount = Number(rule.amount || 0);
      if (rule.amount === 'greatestPowerOther') {
        amount = Math.max(0, ...this.state.players[controller].battlefield.filter(p => p.instanceId !== card.instanceId && this.static.isType(p, 'Creature')).map(p => this.static.derivedStats(p).power));
      }
      if (amount > 0) this.effects.addCounters(controller, card, rule.counter || '+1/+1', amount);
    }
    for (const source of this.state.players[controller].battlefield) {
      if (source.instanceId === card.instanceId || source.phasedOut) continue;
      const sourceDef = this.copy?.definitionForObject(source) || this.db[source.cardId] || {};
      for (const ability of sourceDef.abilities || []) {
        if (ability.type !== 'static' || !ability.effect?.entersWithCounter) continue;
        const filter = ability.filter || {};
        if (filter.subtype && !hasSubtype(d, filter.subtype)) continue;
        if (filter.chosenTypeOfSource && (!source.chosenType || !hasSubtype(d, source.chosenType))) continue;
        if (filter.other && source.instanceId === card.instanceId) continue;
        this.effects.addCounters(controller, card, ability.effect.entersWithCounter, Number(ability.effect.amount || 1));
      }
    }
  }

  _finishPermanentResolution(item, resolutionTargets = []) {
    const card = item.card, d = this.copy?.definitionForObject(card) || this.db[card.cardId] || {};
    const chosenType = card.chosenType || null;
    const castMode = item.mode || item.castOption || card.castMode || null;
    this._moveZoneNow(card, 'battlefield', item.controller, {
      ...(this.static.hasSubtype(card, 'Aura') && resolutionTargets[0] ? { attachmentTargetId: resolutionTargets[0], attachmentReason: 'aura-spell' } : {})
    });
    card.chosenType = chosenType;
    card.castMode = castMode;
    card.summoningSick = isType(d, 'Creature') && !this.mechanics.canIgnoreSummoningSickness(d);
    card.createdTurn = this.state.turn;
    card.controlledSinceTurn = this.state.turn;
    card.tapped = this._permanentEntersTapped(card, item.controller);
    this._applyEntryCounters(card, item.controller);
    this.emit(EVENT.ENTER_BATTLEFIELD, { controller: item.controller, target: card, castMode: card.castMode });
    for (const eff of d.onEnterEffects || []) {
      this.effects.resolve(eff, { controller: item.controller, source: card, targets: resolutionTargets, mode: item.mode, castOption: item.castOption });
      if (this.state.pendingChoice) break;
    }
    return card;
  }

  _resumePendingResolution() {
    const pending = this.state.pendingResolution;
    if (!pending || this.state.pendingChoice) return false;
    this.state.pendingResolution = null;
    if (pending.kind === 'permanent') {
      const item = pending.item;
      this._finishPermanentResolution(item, pending.resolutionTargets || []);
      this.emit(EVENT.SPELL_RESOLVED, { controller: item.controller, card: item.card, targets: pending.resolutionTargets || [] });
      this.stateBasedActions();
      return true;
    }
    if (pending.kind === 'finishSpell') {
      const item = pending.item, card = item.card, d = this.copy?.definitionForObject(card) || this.db[card.cardId] || {};
      const selectedMode = item.mode ? this._modeFor(d, item.mode) : null;
      if (!item.isCopy) this._moveZoneNow(card, selectedMode?.afterResolutionZone || d.afterResolutionZone || 'graveyard', card.owner);
      this.emit(EVENT.SPELL_RESOLVED, { controller: item.controller, card, targets: pending.resolutionTargets || [], copy: !!item.isCopy });
      this.stateBasedActions();
      return true;
    }
    if (pending.kind === 'land') {
      this._beginLandPlayEntry(pending.playerId, pending.cardInstanceId, 'hand', 'land');
      return true;
    }
    if (pending.kind === 'hideawayLand') {
      this._beginLandPlayEntry(pending.playerId, pending.cardInstanceId, 'exile', 'hideawayLand');
      return true;
    }
    return false;
  }

  canCastTopCard(pid, card) {
    const p = this.state.players[pid];
    if (!p || p.library[0]?.instanceId !== card?.instanceId) return false;
    const def = this.db[card.cardId] || {};
    for (const source of p.battlefield) {
      const sourceDef = this.copy?.definitionForObject(source) || this.db[source.cardId] || {};
      for (const ability of sourceDef.abilities || []) {
        if (ability.type !== 'static' || !ability.effect?.castFromTop) continue;
        if (ability.filter?.chosenTypeOfSource && (!source.chosenType || !hasSubtype(def, source.chosenType))) continue;
        if (ability.filter?.subtype && !hasSubtype(def, ability.filter.subtype)) continue;
        if (ability.filter?.type && !isType(def, ability.filter.type)) continue;
        return true;
      }
    }
    return false;
  }

  _validateEncore(pid, action) {
    const found = ZoneManager.find(this.state, action.cardInstanceId);
    if (!found || found.zone !== 'graveyard' || found.player?.id !== pid || found.card.owner !== pid) throw new Error('Encore card must be in your graveyard');
    const definition = this.db[found.card.cardId] || {};
    if (!definition.encoreCost) throw new Error('This card does not have encore');
    if (!this.timing.assess(pid, action).allowed) throw new Error('Encore may only be activated as a sorcery');
    if (!this.mana.canAfford(this.state.players[pid], this.db, definition.encoreCost, 0, this, { kind: 'ability', source: found.card })) throw new Error('Insufficient mana for encore');
    return true;
  }

  _applyEncore(pid, instanceId) {
    const player = this.state.players[pid];
    const found = ZoneManager.find(this.state, instanceId);
    const definition = this.db[found.card.cardId] || {};
    if (!this.mana.autoTapAndPay(player, this.db, definition.encoreCost, 0, this, { kind: 'ability', source: found.card })) throw new Error('Insufficient mana for encore');
    const source = structuredClone(found.card);
    this._moveZoneNow(found.card, 'exile', found.card.owner);
    this.stack.push({
      id: this._nextRuntimeId(`encore-${instanceId}`),
      type: 'ability',
      controller: pid,
      source,
      ability: { type: 'activated', effect: { type: 'encore', cardId: source.cardId } },
      effect: { type: 'encore', cardId: source.cardId },
      targets: []
    });
    this.state.priorityPlayer = pid;
    this.state.passes = 0;
    return true;
  }

  _validateForetell(pid, action) {
    const f = ZoneManager.find(this.state, action.cardInstanceId);
    if (!f || f.zone !== 'hand' || f.player?.id !== pid) throw new Error('Foretell card must be in your hand');
    const d = this.db[f.card.cardId];
    if (!d?.foretellCost) throw new Error('This card does not have foretell');
    if (!this.timing.assess(pid, action).allowed) throw new Error('Foretell may only be used during your turn while you have priority');
    if (!this.mana.canAfford(this.state.players[pid], this.db, '{2}', 0, this, { kind: 'other' })) throw new Error('Insufficient mana to foretell');
    return true;
  }

  _applyForetell(pid, instanceId) {
    const p = this.state.players[pid];
    if (!this.mana.autoTapAndPay(p, this.db, '{2}', 0, this, { kind: 'other' })) throw new Error('Insufficient mana to foretell');
    const found = ZoneManager.find(this.state, instanceId);
    const card = this._moveZoneNow(found.card, 'exile', pid);
    card.foretold = true;
    card.faceDown = true;
    card.foretoldTurn = this.state.turn;
    this.state.priorityPlayer = pid;
    this.state.passes = 0;
    return card;
  }

  canCast(pid, card, zone = null, { mode = null, targets = [], castOption = null, castFaceIndex = null } = {}) {
    if (!card || !this.db[card.cardId] || !this.state.players[pid]) return false;
    const actualZone = zone || ZoneManager.find(this.state, card.instanceId)?.zone || card.zone;
    const info = this._castCostInfo(pid, card, actualZone, mode, targets, castOption, castFaceIndex);
    return this.payments.canPayLockedCost(pid, info.lockedCost, { context: { kind: 'cast', card } });
  }

  _applyCast(pid, instanceId, targets, mode = null, castOption = null, retraceLandInstanceId = null, castFaceIndex = null) {
    const p = this.state.players[pid], loc = ZoneManager.find(this.state, instanceId), c = loc.card, rootDefinition = this.db[c.cardId];
    const d = this._castDefinition(c, castFaceIndex);
    const info = this._castCostInfo(pid, c, loc.zone, mode, targets, castOption, castFaceIndex);
    let lockedCost = structuredClone(info.lockedCost);
    if (castOption === 'retrace') {
      const land = p.hand.find(card => card.instanceId === retraceLandInstanceId && isType(this.db[card.cardId], 'Land'));
      if (!land) throw new Error('Retrace requires the chosen land card to remain in your hand');
      lockedCost.nonManaCosts = [...(lockedCost.nonManaCosts || []), { type: 'discard', cardInstanceId: land.instanceId }];
    }
    const paymentPlan = this.payments.payLockedCost(pid, lockedCost, { context: { kind: 'cast', card: c } });
    if (!paymentPlan) throw new Error('Insufficient mana');
    this._lastPaymentPlan = (paymentPlan.activations || []).map(item => item.permanentId);
    if (c.freeCast) delete c.freeCast;
    if (castOption === 'hideaway') { delete c.faceDown; delete c.exiledBy; }
    if (castOption === 'foretold') delete c.faceDown;
    if (loc.zone === 'stack') throw new Error('Cannot cast a spell already on the stack');
    if (Number.isInteger(castFaceIndex)) setCastFace(c, rootDefinition, castFaceIndex);
    this.zones.detach(c.instanceId);
    ZoneManager.prepareForZone(c, 'stack', pid, rootDefinition);
    if (castOption === 'hideaway' || castOption === 'foretold') {
      delete c.faceDown;
      if (c.faceState) c.faceState.faceUp = true;
    }
    c.castMode = mode || castOption || null;
    c.foretold = false;
    delete c.foretoldTurn;
    const item = this.stack.push({
      id: `spell-${c.instanceId}`, type: 'spell', controller: pid, card: c,
      targets: [...targets], mode, castOption, castFaceIndex: Number.isInteger(castFaceIndex) ? castFaceIndex : null,
      lockedCost: structuredClone(lockedCost),
      paymentPlan: structuredClone(paymentPlan),
      additionalCosts: structuredClone(lockedCost.nonManaCosts || []),
      alternativeCost: lockedCost.alternativeManaCost || null
    });
    if (c.isCommander && loc.zone === 'command') this.commanders.recordCast(pid, c, { fromZone: loc.zone });
    this.emit(EVENT.SPELL_CAST, { controller: pid, card: c, targets: [...targets], mode, castOption, castFaceIndex: Number.isInteger(castFaceIndex) ? castFaceIndex : null });
    if (this._lastPaymentPlan?.length) this.emit(EVENT.MANA_SPENT_TO_CAST, { controller: pid, card: c, manaSourceIds: [...this._lastPaymentPlan] });
    this._queueWardTriggers(item, pid, targets);
    this.state.priorityPlayer = pid;
    this.state.passes = 0;
    return c;
  }

  _revealEntryCandidates(pid, definition, excludeInstanceId = null) {
    const subtypes = this._entryRevealLandSubtypes(definition);
    if (!subtypes.length) return [];
    return this.state.players[pid].hand.filter(card => card.instanceId !== excludeInstanceId && isType(this.db[card.cardId], 'Land') && subtypes.some(type => hasSubtype(this.db[card.cardId], type)));
  }

  _openEntryLifeChoice(pid, card, definition, extra = {}) {
    const lifeCost = this._entryLifeCost(definition);
    if (lifeCost <= 0 || card.entryLifeResolved) return false;
    if (this.state.players[pid].life < lifeCost) {
      card.entryLifeResolved = true;
      card.entryLifePaid = false;
      return false;
    }
    this.state.pendingChoice = {
      type: 'ENTRY_LIFE_PAYMENT',
      playerId: pid,
      cardInstanceId: card.instanceId,
      cardName: definition.name,
      lifeCost,
      ...extra,
      resume: extra.resume || (this.state.phase === 'CLEANUP' ? 'CLEANUP' : 'PRIORITY')
    };
    this.state.priorityPlayer = pid;
    this.state.passes = 0;
    return true;
  }

  _openEntryRevealChoice(pid, card, definition, extra = {}) {
    const subtypes = this._entryRevealLandSubtypes(definition);
    const candidates = this._revealEntryCandidates(pid, definition, card.instanceId);
    if (!subtypes.length || !candidates.length || card.entryRevealResolved) return false;
    this.state.pendingChoice = {
      type: 'ENTRY_REVEAL',
      playerId: pid,
      cardInstanceId: card.instanceId,
      cardName: definition.name,
      candidateIds: candidates.map(candidate => candidate.instanceId),
      revealLandSubtypes: subtypes,
      ...extra,
      resume: extra.resume || (this.state.phase === 'CLEANUP' ? 'CLEANUP' : 'PRIORITY')
    };
    this.state.priorityPlayer = pid;
    this.state.passes = 0;
    return true;
  }

  _applyCopyTargetChoice(pid, targetIds) {
    const choice = this.state.pendingChoice;
    if (!choice || choice.type !== 'COPY_TARGETS' || choice.playerId !== pid) throw new Error('No copy-target choice is pending');
    this.state.pendingChoice = null;
    const result = this.effects.resolveCopyTargetChoice(choice, targetIds);
    if (!this.state.pendingChoice) this._resumeAfterRulesChoice(choice);
    return result;
  }

  _applyPermanentCopyChoice(pid, permanentId) {
    const choice = this.state.pendingChoice;
    if (!choice || choice.type !== 'COPY_PERMANENT' || choice.playerId !== pid) throw new Error('No permanent-copy choice is pending');
    this.state.pendingChoice = null;
    const result = this.copy.resolvePermanentCopyChoice(choice, permanentId);
    if (!this.state.pendingChoice) this._resumePendingResolution();
    if (!this.state.pendingChoice) this._resumeAfterRulesChoice(choice);
    return result;
  }

  _applyEntryLifeChoice(pid, pay) {
    const choice = this.state.pendingChoice;
    if (!choice || choice.type !== 'ENTRY_LIFE_PAYMENT' || choice.playerId !== pid) throw new Error('No land-entry life payment is pending');
    this.state.pendingChoice = null;
    const found = ZoneManager.find(this.state, choice.cardInstanceId);
    if (!found?.card) throw new Error('The entering land is no longer available');
    const lifeCost = Number(choice.lifeCost || 0);
    if (pay) this.changeLife(pid, -lifeCost);
    found.card.entryLifeResolved = true;
    found.card.entryLifePaid = !!pay;
    this.log('ENTRY_LIFE_PAYMENT', { controller: pid, cardInstanceId: choice.cardInstanceId, lifeCost, paid: !!pay });
    if (choice.landEffect) this._beginPutLandEffect(pid, choice.cardInstanceId, { ...choice.landEffect, resume: choice.resume });
    else this._resumePendingResolution();
    if (!this.state.pendingChoice) this._resumeAfterRulesChoice(choice);
    return !!pay;
  }

  _applyEntryRevealChoice(pid, revealedCardInstanceId) {
    const choice = this.state.pendingChoice;
    if (!choice || choice.type !== 'ENTRY_REVEAL' || choice.playerId !== pid) throw new Error('No entry reveal choice is pending');
    this.state.pendingChoice = null;
    const found = ZoneManager.find(this.state, choice.cardInstanceId);
    if (!found?.card) throw new Error('The entering land is no longer available');
    found.card.entryRevealResolved = true;
    found.card.entryRevealSucceeded = revealedCardInstanceId != null;
    this.log('ENTRY_REVEAL_CHOICE', { controller: pid, cardInstanceId: choice.cardInstanceId, revealedCardInstanceId: revealedCardInstanceId || null });
    if (choice.landEffect) this._beginPutLandEffect(pid, choice.cardInstanceId, { ...choice.landEffect, resume: choice.resume });
    else this._resumePendingResolution();
    if (!this.state.pendingChoice) this._resumeAfterRulesChoice(choice);
    return revealedCardInstanceId;
  }

  _finishPutLandEffect(pid, instanceId, { tapped = false, sourceZone = 'hand', shuffleAfter = false } = {}) {
    const found = ZoneManager.find(this.state, instanceId);
    if (!found || found.zone !== sourceZone || found.player?.id !== pid || !isType(this.db[found.card.cardId], 'Land')) return null;
    const definition = this.db[found.card.cardId] || {};
    const chosenType = found.card.chosenType || null;
    const naturalTapped = this._permanentEntersTapped(found.card, pid);
    const card = this._moveZoneNow(found.card, 'battlefield', pid);
    card.chosenType = chosenType;
    card.createdTurn = this.state.turn;
    card.controlledSinceTurn = this.state.turn;
    card.tapped = !!tapped || naturalTapped;
    this._applyEntryCounters(card, pid);
    if (shuffleAfter) this.shuffleLibrary(pid, 'search');
    this.emit(EVENT.ENTER_BATTLEFIELD, { controller: pid, target: card });
    for (const effect of definition.onEnterEffects || []) {
      this.effects.resolve(effect, { controller: pid, source: card });
      if (this.state.pendingChoice) break;
    }
    return card;
  }

  _beginPutLandEffect(pid, instanceId, { tapped = false, resume = null, sourceZone = 'hand', shuffleAfter = false } = {}) {
    const found = ZoneManager.find(this.state, instanceId);
    if (!found || found.zone !== sourceZone || found.player?.id !== pid || !isType(this.db[found.card.cardId], 'Land')) {
      throw new Error(`The selected land is no longer available in your ${sourceZone}`);
    }
    const definition = this.db[found.card.cardId] || {};
    const resumeMode = resume || (this.state.phase === 'CLEANUP' ? 'CLEANUP' : 'PRIORITY');
    const landEffect = { tapped: !!tapped, sourceZone, shuffleAfter: !!shuffleAfter };

    if (definition.asEntersChooseType && !found.card.chosenType) {
      this.state.pendingChoice = {
        type: 'CREATURE_TYPE', playerId: pid, cardInstanceId: instanceId, cardName: definition.name,
        options: this.creatureTypeOptions(pid), landEffect, resume: resumeMode
      };
      this.state.priorityPlayer = pid;
      this.state.passes = 0;
      return found.card;
    }
    if (this._openEntryLifeChoice(pid, found.card, definition, { landEffect, resume: resumeMode })) return found.card;
    if (this._entryRevealLandSubtypes(definition).length && !found.card.entryRevealResolved) {
      const candidates = this._revealEntryCandidates(pid, definition, found.card.instanceId);
      if (candidates.length) {
        this._openEntryRevealChoice(pid, found.card, definition, { landEffect, resume: resumeMode });
        return found.card;
      }
      found.card.entryRevealResolved = true;
      found.card.entryRevealSucceeded = false;
    }
    return this._finishPutLandEffect(pid, instanceId, landEffect);
  }

  _beginLandPlayEntry(pid, instanceId, fromZone = 'hand', pendingKind = 'land') {
    const found = ZoneManager.find(this.state, instanceId);
    if (!found || found.zone !== fromZone || found.player?.id !== pid || !isType(this.db[found.card.cardId], 'Land')) throw new Error('Land is no longer available to play');
    const definition = this.db[found.card.cardId] || {};
    const resume = this.state.phase === 'CLEANUP' ? 'CLEANUP' : 'PRIORITY';
    const setPendingResolution = () => { this.state.pendingResolution = { kind: pendingKind, playerId: pid, cardInstanceId: instanceId }; };

    if (definition.asEntersChooseType && !found.card.chosenType) {
      setPendingResolution();
      this.state.pendingChoice = {
        type: 'CREATURE_TYPE', playerId: pid, cardInstanceId: instanceId, cardName: definition.name,
        options: this.creatureTypeOptions(pid), resume
      };
      this.state.priorityPlayer = pid;
      this.state.passes = 0;
      return found.card;
    }
    if (!found.card.entryLifeResolved && this._entryLifeCost(definition) > 0) {
      setPendingResolution();
      if (this._openEntryLifeChoice(pid, found.card, definition, { resume })) return found.card;
      this.state.pendingResolution = null;
    }
    if (this._entryRevealLandSubtypes(definition).length && !found.card.entryRevealResolved) {
      const candidates = this._revealEntryCandidates(pid, definition, found.card.instanceId);
      if (candidates.length) {
        setPendingResolution();
        this._openEntryRevealChoice(pid, found.card, definition, { resume });
        return found.card;
      }
      found.card.entryRevealResolved = true;
      found.card.entryRevealSucceeded = false;
    }
    return this._finishLandPlay(pid, instanceId, fromZone);
  }

  _applyPlayLand(pid, instanceId) {
    return this._beginLandPlayEntry(pid, instanceId, 'hand', 'land');
  }

  _finishLandPlay(pid, instanceId, fromZone = 'hand') {
    return this._withDeferredTriggers(() => {
      const p = this.state.players[pid];
      const found = ZoneManager.find(this.state, instanceId);
      if (!found || found.zone !== fromZone || found.player?.id !== pid) throw new Error('Land is no longer available to play');
      const definition = this.db[found.card.cardId] || {};
      if (fromZone === 'exile') { delete found.card.faceDown; delete found.card.exiledBy; }
      const chosenType = found.card.chosenType || null;
      const entersTapped = this._permanentEntersTapped(found.card, pid);
      const c = this._moveZoneNow(found.card, 'battlefield', pid);
      c.chosenType = chosenType;
      c.createdTurn = this.state.turn;
      c.controlledSinceTurn = this.state.turn;
      c.tapped = entersTapped;
      this._applyEntryCounters(c, pid);
      p.landPlaysRemaining--;
      this.emit(EVENT.LAND_PLAYED, { controller: pid, target: c, manaSpent: 0 });
      this.emit(EVENT.ENTER_BATTLEFIELD, { controller: pid, target: c });
      for (const eff of definition.onEnterEffects || []) {
        this.effects.resolve(eff, { controller: pid, source: c });
        if (this.state.pendingChoice) break;
      }
      this.stateBasedActions();
      this.state.priorityPlayer = this.state.pendingChoice?.playerId || pid;
      this.state.passes = 0;
      return c;
    });
  }

  _payAbilityCosts(pid, perm, ability, { defaultTap = false, selections = [], targets = [] } = {}) {
    const lockedCost = this.costs.determineAbilityCost(pid, perm, ability, { targets, selections, defaultTap });
    const paymentPlan = this.payments.payLockedCost(pid, lockedCost, { context: { kind: 'ability', source: perm, ability } });
    if (!paymentPlan) throw new Error('Insufficient resources for ability');
    return { lockedCost, paymentPlan };
  }

  _applyActivateMana(pid, permanentId, ability, manaColor = null) {
    return this._withDeferredTriggers(() => {
      const perm = this.findPermanent(permanentId);
      this._payAbilityCosts(pid, perm, ability, { defaultTap: true });
      const player = this.state.players[pid];
      const mana = ability.anyColor ? { [manaColor]: ability.amount || 1 } : (ability.mana || {});
      this.mana.add(player, mana);
      this.stateBasedActions();
      this.state.priorityPlayer = this.state.pendingChoice?.playerId || pid;
      this.state.passes = 0;
      return true;
    });
  }

  _applyActivateAbility(pid, permanentId, ability, targets, selections = []) {
    return this._withDeferredTriggers(() => {
      const perm = this.findPermanent(permanentId);
      const sourceSnapshot = structuredClone(perm);
      const sourcePowerAtActivation = this.static.derivedStats(perm).power;
      const paid = this._payAbilityCosts(pid, perm, ability, { selections, targets });
      const item = this.stack.push({
        id: this._nextRuntimeId('ability'),
        type: 'ability',
        controller: pid,
        source: ability.cost?.sacrificeSelf ? sourceSnapshot : perm,
        ability: structuredClone(ability),
        effect: ability.effect,
        sourcePowerAtActivation,
        targets: [...targets],
        selections: [...selections],
        lockedCost: structuredClone(paid.lockedCost),
        paymentPlan: structuredClone(paid.paymentPlan),
        additionalCosts: structuredClone(paid.lockedCost.nonManaCosts || [])
      });
      this._queueWardTriggers(item, pid, targets);
      this.stateBasedActions();
      this.state.priorityPlayer = this.state.pendingChoice?.playerId || pid;
      this.state.passes = 0;
      return true;
    });
  }

  _queueWardTriggers(targetStackItem, actorPid, targets) {
    for (const trigger of this.targeting.wardTriggersForTargets(actorPid, targetStackItem.id, targets)) {
      const wardItem = this.stack.push({ id: this._nextRuntimeId('ward'), ...trigger });
      this.log('WARD_TRIGGERED', {
        controller: wardItem.controller,
        payingPlayer: wardItem.payingPlayer,
        protectedPermanentId: wardItem.protectedPermanentId,
        targetStackItemId: wardItem.targetStackItemId,
        cost: { ...wardItem.cost }
      });
    }
  }

  canPayWard(choice = this.state.pendingChoice) {
    if (!choice || choice.type !== 'WARD_PAYMENT') return false;
    const p = this.state.players[choice.playerId];
    if (!p) return false;
    const mana = choice.cost?.mana || '';
    const life = Number(choice.cost?.life || 0);
    if (life > p.life) return false;
    return !mana || this.mana.canAfford(p, this.db, mana, 0, this, { kind: 'other' });
  }

  _applyWardChoice(pid, pay) {
    const choice = this.state.pendingChoice;
    if (!choice || choice.type !== 'WARD_PAYMENT' || choice.playerId !== pid) throw new Error('No ward payment choice is pending');
    const p = this.state.players[pid];
    this.state.pendingChoice = null;

    if (pay) {
      const mana = choice.cost?.mana || '';
      if (mana && !this.mana.autoTapAndPay(p, this.db, mana, 0, this, { kind: 'other' })) throw new Error('Ward mana payment failed');
      const life = Number(choice.cost?.life || 0);
      if (life) this.changeLife(pid, -life);
      this.log('WARD_PAID', { playerId: pid, targetStackItemId: choice.targetStackItemId, cost: { ...choice.cost } });
    } else {
      this._counterStackItem(choice.targetStackItemId, 'ward');
      this.log('WARD_NOT_PAID', { playerId: pid, targetStackItemId: choice.targetStackItemId });
    }

    this.stateBasedActions();
    if (this.state.pendingChoice) this.state.priorityPlayer = this.state.pendingChoice.playerId;
    else if (this.state.winner) this.state.priorityPlayer = null;
    else this.state.priorityPlayer = this.state.activePlayer;
    this.state.passes = 0;
    return pay;
  }

  _counterStackItem(stackItemId, reason = 'countered') {
    const item = this.stack.remove(stackItemId);
    if (!item) return null;
    if (item.type === 'spell' && item.card && !item.isCopy) this._moveZoneNow(item.card, 'graveyard', item.card.owner);
    this.log('STACK_ITEM_COUNTERED', { stackItemId, controller: item.controller, reason, cardId: item.card?.cardId || null });
    return item;
  }

  _applyOptionalTriggerChoice(pid, accept) {
    const choice = this.state.pendingChoice;
    this.triggers.chooseOptional(choice.triggerId, accept);
    this._resumeAfterRulesChoice(choice);
    return accept;
  }

  _applyOptionalManaPaymentChoice(pid, pay) {
    const choice = this.state.pendingChoice;
    if (!choice || choice.type !== 'OPTIONAL_MANA_PAYMENT' || choice.playerId !== pid) throw new Error('No optional mana payment is pending');
    this.state.pendingChoice = null;
    if (pay) {
      if (!this.mana.autoTapAndPay(this.state.players[pid], this.db, choice.mana || '', 0, this, { kind: 'other' })) throw new Error('Optional mana payment failed');
      if (choice.then) this.effects.resolve(choice.then, { ...(choice.context || {}), controller: pid });
    }
    if (!this.state.pendingChoice) this._resumePendingResolution();
    if (!this.state.pendingChoice) this._resumeAfterRulesChoice(choice);
    return pay;
  }

  _applyTapOrUntapChoice(pid, result) {
    const choice = this.state.pendingChoice;
    if (!choice || choice.type !== 'TAP_OR_UNTAP' || choice.playerId !== pid) throw new Error('No tap-or-untap choice is pending');
    this.state.pendingChoice = null;
    const target = this.findPermanent(choice.targetId);
    if (target && result === 'tap') this.tapPermanent(target);
    else if (target && result === 'untap') this.untapPermanent(target);
    if (!this.state.pendingChoice) this._resumePendingResolution();
    if (!this.state.pendingChoice) this._resumeAfterRulesChoice(choice);
    return result;
  }

  _applyOptionalEffectChoice(pid, accept) {
    const choice = this.state.pendingChoice;
    if (!choice || choice.type !== 'OPTIONAL_EFFECT' || choice.playerId !== pid) throw new Error('No optional effect choice is pending');
    this.state.pendingChoice = null;
    if (accept && choice.then) this.effects.resolve(choice.then, { ...(choice.context || {}), controller: pid });
    if (!this.state.pendingChoice) this._resumePendingResolution();
    if (!this.state.pendingChoice) this._resumeAfterRulesChoice(choice);
    return accept;
  }

  _applyTriggerOrder(pid, triggerIds) {
    const choice = this.state.pendingChoice;
    this.triggers.orderTriggers(triggerIds);
    this._resumeAfterRulesChoice(choice);
    return triggerIds;
  }

  _applyProliferateChoice(pid, targetIds) {
    const choice = this.state.pendingChoice;
    this.effects.chooseProliferate(pid, targetIds);
    if (!this.state.pendingChoice) this._resumePendingResolution();
    if (!this.state.pendingChoice) this._resumeAfterRulesChoice(choice);
    return targetIds;
  }

  _applyPhaseOutProliferatedChoice(pid, permanentIds) {
    const choice = this.state.pendingChoice;
    if (!choice || choice.type !== 'PHASE_OUT_PROLIFERATED' || choice.playerId !== pid) throw new Error('No Ripples of Potential phase-out choice is pending');
    this.state.pendingChoice = null;
    for (const id of permanentIds) {
      const permanent = this.findPermanent(id);
      if (permanent?.controller === pid && choice.eligibleIds.includes(id)) permanent.phasedOut = true;
    }
    this._resumePendingResolution();
    if (!this.state.pendingChoice) this._resumeAfterRulesChoice(choice);
    return permanentIds;
  }

  _applyReplacementOrder(pid, replacementIds) {
    const choice = this.state.pendingChoice;
    if (!choice || choice.type !== 'REPLACEMENT_ORDER' || choice.playerId !== pid) throw new Error('No replacement-order choice is pending');
    let replacementResult = null;
    if (choice.replacementEvent) replacementResult = this.replacements.resolveOrderChoice(choice, replacementIds);
    else replacementResult = this.effects.resolveCounterReplacementChoice(choice, replacementIds); // compatibility with pre-Step-10 saves
    if (!this.state.pendingChoice && this.damage?.hasPendingBatch()) this.damage.resumePendingBatch(replacementResult);
    if (!this.state.pendingChoice) this._resumePendingResolution();
    if (!this.state.pendingChoice) this._resumeAfterRulesChoice(choice);
    return replacementIds;
  }

  _applyExploreChoice(pid, putInGraveyard) {
    const choice = this.state.pendingChoice;
    const result = this.effects.chooseExplore(pid, putInGraveyard);
    this._resumeAfterRulesChoice(choice);
    return result;
  }

  _applyExploreOrder(pid, permanentIds) {
    const choice = this.state.pendingChoice;
    this.state.pendingChoice = null;
    this.state.pendingExploreQueue = [...permanentIds];
    this.effects.resumeDeferred();
    this._resumeAfterRulesChoice(choice);
    return permanentIds;
  }

  _applyHakbalAttackChoice(pid, landInstanceId) {
    const choice = this.state.pendingChoice;
    this.state.pendingChoice = null;
    if (landInstanceId) {
      this._beginPutLandEffect(pid, landInstanceId, { tapped: false, resume: choice.resume });
    } else {
      this.draw(pid, 1);
    }
    if (!this.state.pendingChoice) this._resumeAfterRulesChoice(choice);
    return landInstanceId;
  }

  _applyCultivateChoice(pid, cardInstanceIds) {
    const choice = this.state.pendingChoice;
    this.state.pendingChoice = null;
    if (choice.librarySearchRequest) this.libraryOps.finishPreparedSearch(choice.librarySearchRequest, cardInstanceIds);
    else {
      const [battlefieldId, handId] = cardInstanceIds;
      if (battlefieldId) {
        const found = ZoneManager.find(this.state, battlefieldId);
        const card = this._moveZoneNow(found.card, 'battlefield', pid);
        card.tapped = true;
        card.createdTurn = this.state.turn;
        card.controlledSinceTurn = this.state.turn;
        this.emit(EVENT.ENTER_BATTLEFIELD, { controller: pid, target: card });
      }
      if (handId) {
        const found = ZoneManager.find(this.state, handId);
        if (found) this._moveZoneNow(found.card, 'hand', pid);
      }
      this.shuffleLibrary(pid, 'cultivate');
    }
    if (!this.state.pendingChoice) this._resumePendingResolution();
    if (!this.state.pendingChoice) this._resumeAfterRulesChoice(choice);
    return cardInstanceIds;
  }

  _applySisayTutorChoice(pid, cardInstanceId) {
    const choice = this.state.pendingChoice;
    const player = this.state.players[pid];
    this.state.pendingChoice = null;
    if (cardInstanceId) {
      const found = ZoneManager.find(this.state, cardInstanceId);
      if (found) {
        const definition = this.db[found.card.cardId] || {};
        if (isType(definition, 'Land')) {
          this._beginPutLandEffect(pid, cardInstanceId, { sourceZone: 'library', shuffleAfter: true, resume: choice.resume });
          if (!this.state.pendingChoice) this._resumeAfterRulesChoice(choice);
          return cardInstanceId;
        }
        const card = this._moveZoneNow(found.card, 'battlefield', pid);
        card.summoningSick = isType(definition, 'Creature') && !this.mechanics.canIgnoreSummoningSickness(definition);
        card.createdTurn = this.state.turn;
        card.controlledSinceTurn = this.state.turn;
        this.emit(EVENT.ENTER_BATTLEFIELD, { controller: pid, target: card });
      }
    }
    this.shuffleLibrary(pid, 'sisay-tutor');
    this._resumeAfterRulesChoice(choice);
    return cardInstanceId;
  }

  _applyScryChoice(pid, putOnBottom) {
    const choice = this.state.pendingChoice;
    const player = this.state.players[pid];
    this.state.pendingChoice = null;
    if (player.library[0]?.instanceId === choice.cardInstanceId) {
      this.libraryOps.scry(pid, 1, { bottomIds: putOnBottom ? [choice.cardInstanceId] : [], reason: 'scry' });
    }
    this._resumeAfterRulesChoice(choice);
    return putOnBottom;
  }

  _applyLibrarySearchChoice(pid, cardInstanceIds) {
    const choice = this.state.pendingChoice;
    const result = this.libraryOps.resolveSearchChoice(pid, cardInstanceIds);
    if (!this.state.pendingChoice) this._resumeAfterRulesChoice(choice);
    return result;
  }

  _applyTriggerTargetChoice(pid, targetIds) {
    const choice = this.state.pendingChoice;
    this.triggers.chooseTargets(choice.triggerId, targetIds);
    this._resumeAfterRulesChoice(choice);
    return targetIds;
  }

  _applyCreatureTypeChoice(pid, creatureType) {
    const choice = this.state.pendingChoice;
    this.state.pendingChoice = null;
    const pending = this.state.pendingResolution;
    if (pending?.item?.card?.instanceId === choice.cardInstanceId) pending.item.card.chosenType = creatureType;
    const zoned = ZoneManager.find(this.state, choice.cardInstanceId);
    if (zoned?.card) zoned.card.chosenType = creatureType;
    const permanent = this.findPermanent(choice.cardInstanceId);
    if (permanent) permanent.chosenType = creatureType;
    this.log('CREATURE_TYPE_CHOSEN', { controller: pid, cardInstanceId: choice.cardInstanceId, creatureType });
    if (choice.landEffect) this._beginPutLandEffect(pid, choice.cardInstanceId, { ...choice.landEffect, resume: choice.resume });
    else this._resumePendingResolution();
    if (!this.state.pendingChoice) this._resumeAfterRulesChoice(choice);
    return creatureType;
  }

  _applyEffectCardChoice(pid, cardInstanceIds) {
    const choice = this.state.pendingChoice;
    this.state.pendingChoice = null;
    this.effects.resolveEffectCardChoice(choice, cardInstanceIds);
    this._resumePendingResolution();
    if (!this.state.pendingChoice) this._resumeAfterRulesChoice(choice);
    return cardInstanceIds;
  }

  _applyHideawayChoice(pid, cardInstanceId) {
    const choice = this.state.pendingChoice;
    this.state.pendingChoice = null;
    this.effects.resolveHideawayChoice(choice, cardInstanceId);
    this._resumePendingResolution();
    if (!this.state.pendingChoice) this._resumeAfterRulesChoice(choice);
    return cardInstanceId;
  }

  _applyHideawayDecline(pid) {
    const choice = this.state.pendingChoice;
    if (!choice || choice.type !== 'HIDEAWAY_PLAY' || choice.playerId !== pid) throw new Error('No hideaway play choice is pending');
    this.state.pendingChoice = null;
    this._resumeAfterRulesChoice(choice);
    return false;
  }

  _applyHideawayCast(pid, action) {
    const choice = this.state.pendingChoice;
    if (!choice || choice.type !== 'HIDEAWAY_PLAY' || choice.playerId !== pid || action.cardInstanceId !== choice.cardInstanceId) throw new Error('No matching hideaway spell choice is pending');
    this.state.pendingChoice = null;
    const result = this._applyCast(pid, action.cardInstanceId, action.targets || [], action.mode || null, 'hideaway', null);
    if (!this.state.pendingChoice) this._resumeAfterRulesChoice(choice);
    return result;
  }

  _applyHideawayLand(pid, cardInstanceId) {
    const choice = this.state.pendingChoice;
    if (!choice || choice.type !== 'HIDEAWAY_PLAY' || choice.playerId !== pid || cardInstanceId !== choice.cardInstanceId) throw new Error('No matching hideaway land choice is pending');
    this.state.pendingChoice = null;
    const found = ZoneManager.find(this.state, cardInstanceId);
    if (!found?.card) throw new Error('The hidden land is no longer available');
    const result = this._beginLandPlayEntry(pid, cardInstanceId, 'exile', 'hideawayLand');
    if (!this.state.pendingChoice) this._resumeAfterRulesChoice(choice);
    return result;
  }

  _applyDeclareAttackers(pid, ids, attackTargets = {}, attackPayments = {}) {
    this.legality.payActionAdditionalCost(pid, { type: 'DECLARE_ATTACKERS', attackers: ids, attackTargets, attackPayments });
    const result = this.combat.declareAttackers(pid, ids, attackTargets, attackPayments, INTERNAL);
    this.state.turnActionPending = null;
    this.state.priorityPlayer = this.state.activePlayer;
    this.state.passes = 0;
    return result;
  }

  _applyDeclareBlockers(pid, map) {
    const result = this.combat.declareBlockers(pid, map, INTERNAL);
    this.state.passes = 0;
    const queue = this.state.combat.blockerQueue || [];
    if (queue[0] === pid) queue.shift();
    else {
      const index = queue.indexOf(pid);
      if (index >= 0) queue.splice(index, 1);
    }
    this.state.combat.currentDefender = queue[0] || null;
    if (this.state.combat.currentDefender) {
      this.state.turnActionPending = 'DECLARE_BLOCKERS';
      this.state.priorityPlayer = this.state.combat.currentDefender;
      return result;
    }

    this.state.turnActionPending = null;
    const requiredOrders = this.combat.requiredDamageAssignmentOrders();
    if (Object.keys(requiredOrders).length) {
      this.state.pendingChoice = {
        type: 'COMBAT_DAMAGE_ORDER',
        playerId: this.state.activePlayer,
        attackers: requiredOrders
      };
    }
    this.state.priorityPlayer = this.state.activePlayer;
    return result;
  }

  _applyOrderBlockers(pid, orders) {
    const result = this.combat.setDamageAssignmentOrder(pid, orders, INTERNAL);
    this.state.pendingChoice = null;
    this.state.priorityPlayer = this.state.activePlayer;
    this.state.passes = 0;
    return result;
  }

  _applyLegendChoice(pid, keepInstanceId) {
    return this._withDeferredTriggers(() => {
      const choice = this.state.pendingChoice;
      const permanents = choice.permanentIds.map(id => this.findPermanent(id)).filter(Boolean);
      this.state.pendingChoice = null;
      for (const permanent of permanents) {
        if (permanent.instanceId !== keepInstanceId) this.toGraveyard(permanent, true);
      }
      this._resumeAfterRulesChoice(choice);
      return keepInstanceId;
    });
  }

  _applyCommanderZoneChoice(pid, moveToCommand) {
    return this._withDeferredTriggers(() => {
      const choice = this.state.pendingChoice;
      const found = ZoneManager.find(this.state, choice.commanderId);
      this.state.pendingChoice = null;

      if (choice.replacement) {
        if (found) this._moveZoneNow(
          found.card,
          moveToCommand ? 'command' : choice.destination,
          moveToCommand ? found.card.owner : (choice.destinationPlayerId || found.card.owner),
          moveToCommand ? { reason: 'commander-replacement' } : (choice.zoneMoveOptions || {})
        );
      } else if (found) {
        delete found.card.commanderZoneChoicePending;
        if (moveToCommand) this._moveZoneNow(found.card, 'command', found.card.owner);
      }

      this._resumeAfterRulesChoice(choice);
      return moveToCommand;
    });
  }

  _applyAttachmentEntryChoice(pid, hostId) {
    return this._withDeferredTriggers(() => {
      const choice = this.state.pendingChoice;
      if (!choice || choice.type !== 'ATTACHMENT_ENTRY' || choice.playerId !== pid) throw new Error('No Aura attachment choice is pending');
      const found = this.zones.find(choice.sourceId);
      if (!found) throw new Error('Aura is no longer available to enter');
      this.state.pendingChoice = null;
      const moved = this._moveZoneNow(found.card, 'battlefield', choice.destinationPlayerId || pid, {
        reason: choice.reason || 'aura-entry', attachmentTargetId: hostId, attachmentReason: choice.reason || 'aura-entry', skipAttachmentChoice: true
      });
      this._resumeAfterRulesChoice(choice);
      return moved;
    });
  }

  _resumeAfterRulesChoice(choice) {
    this.stateBasedActions();
    if (!this.state.pendingChoice && !this.state.winner) {
      this.effects.resumeDeferred();
      if (!this.state.pendingChoice) this.stateBasedActions();
    }
    if (this.state.winner) {
      this.state.priorityPlayer = null;
      return;
    }
    if (this.state.pendingChoice) {
      this.state.priorityPlayer = this.state.pendingChoice.playerId;
      return;
    }
    if (choice.resume === 'CLEANUP') {
      this._completeCleanupTurnBased(INTERNAL);
      return;
    }
    this.state.priorityPlayer = this.state.activePlayer;
    this.state.passes = 0;
  }

  // Compatibility helpers intentionally route back through the authoritative gateway.
  mulligan(pid) { return this.perform(pid, { type: 'MULLIGAN' }); }
  keepHand(pid) { return this.perform(pid, { type: 'KEEP_HAND' }); }
  bottomCards(pid, cardInstanceIds) { return this.perform(pid, { type: 'BOTTOM_CARDS', cardInstanceIds }); }
  discardCards(pid, cardInstanceIds) { return this.perform(pid, { type: 'DISCARD_CARDS', cardInstanceIds }); }
  cast(pid, instanceId, targets = []) {
    const f = ZoneManager.find(this.state, instanceId);
    return this.perform(pid, { type: f?.zone === 'command' ? 'CAST_COMMANDER' : 'CAST_SPELL', cardInstanceId: instanceId, targets });
  }
  playLand(pid, instanceId) { return this.perform(pid, { type: 'PLAY_LAND', cardInstanceId: instanceId }); }
  activateMana(pid, permanentId, ability, manaColor = null) { return this.perform(pid, { type: 'ACTIVATE_MANA', permanentId, ability, ...(manaColor ? { manaColor } : {}) }); }
  activateAbility(pid, permanentId, ability, targets = []) { return this.perform(pid, { type: 'ACTIVATE_ABILITY', permanentId, ability, targets }); }
  chooseExplore(pid, putInGraveyard) { return this.perform(pid, { type: 'CHOOSE_EXPLORE', putInGraveyard }); }

  changeController(permanentId, newController) {
    return this.events.dispatch(ENGINE_EVENT.CONTROL_CHANGE, { permanentId, newController }, { cause: 'control-change', stabilize: false });
  }

  findPermanent(id) {
    for (const p of Object.values(this.state.players)) {
      const x = p.battlefield.find(c => c.instanceId === id || c.gameObjectId === id);
      if (x) return x;
    }
    return null;
  }

  selectPermanents(pid, filter = {}) {
    return this.state.players[pid].battlefield.filter(p => {
      if (p.phasedOut) return false;
      if (filter.type && !this.static.isType(p, filter.type)) return false;
      if (filter.subtype && !this.static.hasSubtype(p, filter.subtype)) return false;
      if (Array.isArray(filter.subtypes) && filter.subtypes.length && !filter.subtypes.some(type => this.static.hasSubtype(p, type))) return false;
      if (filter.hasCounter && Number(p.counters?.[filter.hasCounter] || 0) <= 0) return false;
      if (filter.withoutCounter && Number(p.counters?.[filter.withoutCounter] || 0) > 0) return false;
      if (filter.notSelf && p.instanceId === filter.notSelf) return false;
      return true;
    });
  }

  tapPermanent(permanent) {
    if (!permanent || permanent.tapped) return false;
    return this.events.dispatch(ENGINE_EVENT.TAP, { permanentId: permanent.instanceId }, { cause: 'tap', stabilize: false });
  }

  untapPermanent(permanent) {
    if (!permanent || !permanent.tapped) return false;
    return this.events.dispatch(ENGINE_EVENT.UNTAP, { permanentId: permanent.instanceId }, { cause: 'untap', stabilize: false });
  }

  changeLife(pid, delta) {
    if (delta === 0) return 0;
    const type = delta > 0 ? ENGINE_EVENT.GAIN_LIFE : ENGINE_EVENT.LOSE_LIFE;
    return this.replacements.dispatchWithChoice(type, {
      playerId: pid,
      amount: Math.abs(delta)
    }, { cause: 'life-change', stabilize: false, affectedPlayerId: pid });
  }

  _preventDamage(target, amount) {
    const available = Math.max(0, Number(target?.damagePrevention || 0));
    const prevented = Math.min(Math.max(0, amount), available);
    if (prevented > 0) target.damagePrevention -= prevented;
    return { dealt: Math.max(0, amount - prevented), prevented };
  }

  dealDamageToPlayer(pid, amount, source, { combat = false, preventable = true, damageType = null, damageProperties = null } = {}) {
    return this.damage.deal({ targetPlayer: pid, amount, source, combat, preventable, damageType, damageProperties });
  }

  dealDamageToPermanent(target, amount, source, { combat = false, preventable = true, damageType = null, damageProperties = null } = {}) {
    if (!target) return null;
    return this.damage.deal({ targetId: target.instanceId || target, amount, source, combat, preventable, damageType, damageProperties });
  }

  dealDamageBatch(events, options = {}) {
    return this.damage.resolveBatch(events, options);
  }

  getDamageBatchSnapshot() { return immutableClone(this.damage.snapshot()); }

  destroy(p) {
    if (!p) return false;
    return this.events.dispatch(ENGINE_EVENT.DESTROY, { permanentId: p.instanceId }, { cause: 'destroy', stabilize: false });
  }

  sacrifice(p) {
    if (!p) return false;
    return this.events.dispatch(ENGINE_EVENT.SACRIFICE, { permanentId: p.instanceId }, { cause: 'sacrifice', stabilize: false });
  }

  exile(p) {
    if (!p) return false;
    return this.events.dispatch(ENGINE_EVENT.EXILE, { permanentId: p.instanceId }, { cause: 'exile', stabilize: false });
  }

  toGraveyard(p, died = false) {
    const wasCreature = this.static.isType(p, 'Creature');
    const oldController = p.controller;
    const oldOwner = p.owner;
    const oldGameObjectId = p.gameObjectId;
    const moved = this._moveZoneNow(p, 'graveyard', p.owner, { reason: died ? 'dies' : 'graveyard' });
    if (moved && died && wasCreature) {
      const lki = this.lki.get(oldGameObjectId || p.instanceId);
      this.emit(EVENT.CREATURE_DIED, {
        controller: oldController,
        owner: oldOwner,
        target: moved,
        object: structuredClone(lki?.object || null),
        lkiId: lki?.lkiId || null,
        fromZone: 'battlefield',
        toZone: 'graveyard'
      });
    }
    return moved;
  }

  moveToZone(card, toZone, toPlayerId = null, options = {}) {
    const found = this.zones.find(card?.instanceId || card?.gameObjectId || card);
    if (!found) return null;
    if (this.state.pendingChoice) throw new Error('Complete the current choice before changing another zone');
    if (found.card.isCommander && ['hand', 'library'].includes(toZone)) {
      this.state.pendingChoice = {
        type: 'COMMANDER_ZONE',
        playerId: found.card.owner,
        commanderId: found.card.instanceId,
        fromZone: found.zone,
        destination: toZone,
        destinationPlayerId: toPlayerId || found.card.owner,
        zoneMoveOptions: structuredClone(options),
        replacement: true,
        resume: this.state.phase === 'CLEANUP' ? 'CLEANUP' : 'PRIORITY'
      };
      this.state.priorityPlayer = found.card.owner;
      return found.card;
    }
    return this._moveZoneNow(card, toZone, toPlayerId, options);
  }

  _moveZoneNow(card, toZone, toPlayerId = null, options = {}) {
    const found = this.zones.find(card?.instanceId || card?.gameObjectId || card);
    const source = found?.card || card;
    if (!source) return null;
    const reason = options.reason || 'zone-change';
    // Auras put onto the battlefield without being cast choose a legal host as
    // they enter. Defer the move until that non-targeting choice is answered.
    if (toZone === 'battlefield' && found?.zone !== 'stack' && this.attachments?.kind(source) === 'aura' && !options.attachmentTargetId && !options.skipAttachmentChoice) {
      const choice = this.attachments.requestAuraEntryChoice(source, { toPlayerId: toPlayerId || source.controller || source.owner, reason });
      if (choice?.impossible) {
        this.log('AURA_ENTRY_IMPOSSIBLE', { cardInstanceId: source.instanceId, fromZone: found?.zone || source.zone || null, reason });
        return source;
      }
      if (choice) {
        choice.fromZone = found?.zone || source.zone || null;
        choice.destinationPlayerId = toPlayerId || source.controller || source.owner;
        return source;
      }
    }
    return this.events.dispatch(ENGINE_EVENT.MOVE_ZONE, {
      ...(found ? { cardInstanceId: found.card.instanceId } : { cardRef: source, detached: true, fromZone: source.zone || 'stack' }),
      toZone,
      toPlayerId: toPlayerId || source.owner,
      reason,
      ...(options.destinationIndex != null ? { destinationIndex: options.destinationIndex } : {}),
      ...(options.knownTo ? { knownTo: [...options.knownTo] } : {}),
      ...(options.publicReveal ? { publicReveal: true } : {}),
      ...(options.position ? { position: options.position } : {}),
      ...(options.attachmentTargetId ? { attachmentTargetId: options.attachmentTargetId } : {}),
      ...(options.attachmentReason ? { attachmentReason: options.attachmentReason } : {})
    }, { cause: reason, stabilize: false });
  }

  stateBasedActions() {
    return this._withDeferredTriggers(() => this.sba.stabilize());
  }

  _runStateBasedActionLoop() {
    return this.sba.stabilize();
  }

  _cleanupEliminatedPlayers() {
    return this.elimination.cleanup();
  }

  checkWinner() {
    const state = this.state;
    let newlyLost = false;
    for (const [id, p] of Object.entries(state.players)) {
      if (p.lost) continue;
      const lethalCommander = Object.entries(p.commanderDamage || {}).find(([, amount]) => Number(amount) >= 21);
      if (p.life <= 0 || lethalCommander) {
        newlyLost = this.elimination.markLost(id, { reason: p.life <= 0 ? 'life' : 'commander-damage', commanderId: lethalCommander?.[0] || null }) || newlyLost;
      }
    }
    if (newlyLost) this.elimination.cleanup();

    const alive = this.livingPlayerIds();
    if (alive.length === 1 && this.playerIds().length > 1) {
      state.winner = alive[0];
      state.priorityPlayer = null;
      return state.winner;
    }
    if (alive.length === 0) {
      state.winner = 'draw';
      state.priorityPlayer = null;
      return state.winner;
    }

    if (state.priorityPlayer && state.players[state.priorityPlayer]?.lost) state.priorityPlayer = this.nextPriorityPlayer(state.priorityPlayer);
    return null;
  }
}

export function createGame(deckA, deckB, db, options = {}) {
  return GameEngine.createGame(deckA, deckB, db, options);
}
