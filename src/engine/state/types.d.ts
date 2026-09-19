export type PlayerId = string;
export type ZoneName = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'command' | 'stack';
export type GameObjectKind = 'card' | 'spell' | 'permanent' | 'ability-on-stack' | 'token' | 'emblem' | 'card-face' | 'player';

export interface CardIdentity {
  readonly rulesCardId: string;
  readonly oracleId: string | null;
  readonly printingId: string | null;
}

export interface BaseCharacteristics {
  readonly cardId: string | null;
  readonly name: string;
  readonly manaCost: string;
  readonly manaValue: number;
  readonly typeLine: string;
  readonly oracleText: string;
  readonly colors: readonly string[];
  readonly colorIdentity: readonly string[];
  readonly subtypes: readonly string[];
  readonly keywords: readonly string[];
  readonly power: string | number | null;
  readonly toughness: string | number | null;
  readonly loyalty: string | number | null;
  readonly defense: string | number | null;
  readonly layout: string;
  readonly faceCount: number;
}


export interface CopiableValues {
  schemaVersion: 1;
  sourceCardId: string | null;
  sourceGameObjectId: string | null;
  name: string;
  manaCost: string;
  manaValue: number;
  colorIndicator: readonly string[];
  colors: readonly string[];
  colorIdentity: readonly string[];
  supertypes: readonly string[];
  types: readonly string[];
  subtypes: readonly string[];
  typeLine: string;
  oracleText: string;
  power: string | number | null;
  toughness: string | number | null;
  loyalty: string | number | null;
  defense: string | number | null;
  keywords: readonly string[];
  abilities: readonly Record<string, unknown>[];
  spellEffects: readonly Record<string, unknown>[];
  layout: string;
  rulesData: Record<string, unknown>;
  copyModifications: readonly Record<string, unknown>[];
}

export interface PermanentCopyState {
  schemaVersion: 1;
  kind: string;
  copiedFromInstanceId: string | null;
  copiedFromGameObjectId: string | null;
  copiedAtTurn: number;
  createdTurn: number;
  timestamp: number;
  duration: string;
  effectSourceInstanceId: string | null;
  expiresAtTurn: number | null;
  copiableValues: CopiableValues;
}

export interface FaceState {
  currentFaceIndex: number;
  castFaceIndex: number | null;
  transformed: boolean;
  faceUp: boolean;
}

export interface CardGameObject {
  readonly instanceId: string;          // stable physical-card/token identity used by compatibility APIs
  gameObjectId: string;                 // identity of this rules object incarnation
  previousGameObjectId?: string;
  zoneChangeId: number;
  objectKind: GameObjectKind;
  readonly cardId: string;
  readonly cardIdentity: CardIdentity;
  readonly baseCharacteristics: BaseCharacteristics;
  owner: PlayerId;
  controller: PlayerId;
  zone: ZoneName;
  faceState: FaceState;
  tapped: boolean;
  counters: Record<string, number>;
  damageMarked: number;
  attachedTo: string | null;
  copyState?: PermanentCopyState;
  isCommander?: boolean;
  commanderIdentity?: string | null;
  controlHistory?: PlayerId[];
  [key: string]: unknown;
}

export interface PlayerState {
  id: PlayerId;
  objectKind: 'player';
  gameObjectId: string;
  life: number;
  restrictedMana: Array<Record<string, unknown>>;
  library: CardGameObject[];
  hand: CardGameObject[];
  battlefield: CardGameObject[];
  graveyard: CardGameObject[];
  exile: CardGameObject[];
  command: CardGameObject[];
  commanderTax: number;
  commanderTaxLedger: Record<string, { commanderIdentity: string; cardId: string; castsFromCommandZone: number; tax: number }>;
  commanderDamage: Record<string, number>;
  counters: Record<string, number>;
  commanderIdentities: string[];
  commanderCardIds: string[];
  [key: string]: unknown;
}

export interface StackObject {
  id: string;
  gameObjectId: string;
  objectKind: 'spell' | 'ability-on-stack';
  type: 'spell' | 'ability' | 'trigger' | 'ward';
  controller: PlayerId;
  source: CardGameObject | null;
  card: CardGameObject | null;
  ability: Record<string, unknown> | null;
  effect: Record<string, unknown> | null;
  selectedModes: unknown[];
  mode: unknown | null;
  targets: string[];
  xValue: number | null;
  divided: unknown | null;
  additionalCosts: unknown[];
  alternativeCost: unknown | null;
  castOption: unknown | null;
  isCopy: boolean;
  copyMetadata: {
    isCopy: boolean;
    copiedFromStackObjectId: string | null;
    retargetAllowed: boolean;
    copiableValues?: CopiableValues | null;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}


export type TurnPhaseGroup = 'BEGINNING' | 'PRECOMBAT_MAIN' | 'COMBAT' | 'POSTCOMBAT_MAIN' | 'ENDING';

export interface TurnSequenceNode {
  id: string;
  key: string;
  phaseGroup: TurnPhaseGroup;
  grantsPriority: boolean;
  turnBasedAction: string | null;
  optional: boolean;
  occurrence: number;
  origin: string;
  metadata: unknown;
}

export interface TurnModifiers {
  skippedTurns: Record<PlayerId, number>;
  extraUpkeeps: Record<PlayerId, number>;
  skippedDrawSteps: Record<PlayerId, number>;
  skippedCombatPhases: Record<PlayerId, number>;
  skipSteps: Record<PlayerId, Record<string, number>>;
  skipPhaseGroups: Record<PlayerId, Record<string, number>>;
}

export interface TurnHistoryEntry {
  turn: number;
  activePlayer: PlayerId;
  turnOrder: PlayerId[];
  sequence: Array<{ id: string; key: string; phaseGroup: TurnPhaseGroup; origin: string; occurrence: number }>;
  completed: boolean;
}
export interface KnownCardInformation {
  instanceId: string;
  gameObjectId: string | null;
  cardId: string;
  zone: ZoneName;
  owner: PlayerId;
  public: boolean;
  reason: string | null;
  position: string | null;
  [key: string]: unknown;
}

export interface PlayerKnownInformation {
  cards: Record<string, KnownCardInformation>;
}

export interface LastKnownInformationRecord {
  lkiId: string;
  sequence: number;
  eventId: string | null;
  reason: string | null;
  fromZone: ZoneName | null;
  capturedTurn: number;
  capturedPhase: string;
  object: Record<string, unknown>;
}

export interface LegalityUsageRecord {
  id: string;
  turn: number;
  phase: string;
  playerId: PlayerId;
  operation: string;
  count: number;
  cardId: string | null;
  objectId: string | null;
  zone: ZoneName | null;
  types: string[];
  subtypes: string[];
  metadata: Record<string, unknown>;
}

export interface LegalityDiagnosticRecord {
  id: string;
  kind: string;
  turn: number;
  phase: string;
  operation?: string;
  playerId?: PlayerId;
  [key: string]: unknown;
}


export interface TimingUsageRecord {
  id: string;
  turn: number;
  phase: string;
  phaseIndex: number;
  combatId: string | null;
  playerId: PlayerId;
  actionType: string;
  sourceObjectId: string | null;
  abilityKey: string | null;
  usageKey: string;
  permission: Record<string, unknown>;
}

export interface TimingDiagnosticRecord {
  id: string;
  kind: string;
  turn: number;
  phase: string;
  priorityPlayer: PlayerId | null;
  playerId?: PlayerId;
  actionType?: string;
  [key: string]: unknown;
}

export interface CanonicalGameState {
  schemaVersion: 2;
  turn: number;
  activePlayer: PlayerId;
  priorityPlayer: PlayerId | null;
  phase: string;
  phaseIndex: number;
  turnStepId: string | null;
  turnPhaseGroup: TurnPhaseGroup | null;
  turnSequence: TurnSequenceNode[];
  cleanupIteration: number;
  turnModifiers: TurnModifiers;
  extraTurnQueue: PlayerId[];
  turnKind: 'normal' | 'extra';
  normalTurnPlayer: PlayerId;
  turnHistory: TurnHistoryEntry[];
  skippedTurnHistory: Array<Record<string, unknown>>;
  players: Record<PlayerId, PlayerState>;
  playerOrder: PlayerId[];
  stack: StackObject[];
  pendingTriggers: Array<Record<string, unknown>>;
  triggerRegistrations: Array<Record<string, unknown>>;
  continuousEffects: Array<Record<string, unknown>>;
  continuousTimestampSequence: number;
  preventionEffects: Array<Record<string, unknown>>;
  knownInformation: Record<PlayerId, PlayerKnownInformation>;
  lastKnownInformation: {
    sequence: number;
    byObjectId: Record<string, LastKnownInformationRecord>;
    byInstanceId: Record<string, LastKnownInformationRecord>;
  };
  legalityUsage: LegalityUsageRecord[];
  legalityDiagnostics: LegalityDiagnosticRecord[];
  timingUsage: TimingUsageRecord[];
  timingDiagnostics: TimingDiagnosticRecord[];
  [key: string]: unknown;
}
