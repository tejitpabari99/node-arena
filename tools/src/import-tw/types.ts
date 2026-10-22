// Typed Tower War level ("TwLevel" == the research `tw-level-ext@0.1` shape, v1-short dialect only).
// Raw TextAsset keys (P/PT/PC/BD/OBS/...) are mapped to semantic names exactly as the archived
// Python converter (_tools/p2_tw2na.py) does, so raw -> TwLevel parity with converted/ext holds.

export type TwVec = [number, number, number];

export type TwPlayerType = 'player' | 'ai' | 'neutral';
export type TwColor = 'blue' | 'green' | 'red' | 'yellow' | 'gray';
export type TwSlotKey = 'p' | 'ai_p' | 'n_p';

/** `GT` 0 none / 1 create way (line) / 2 capture house; `then` = `OS`. */
export interface TwAiAction {
  goal: 0 | 1 | 2;
  ownHouse: number;
  targetHouse: number;
  startDelay: number;
  then: TwAiAction[] | null;
}

export interface TwAi {
  actionDelay?: number; // AD
  reactionDelayMin?: number; // MinRD
  reactionDelayMax?: number; // MaxRD
  behavior?: 0 | 1 | 2; // BT: Attack / Defense / Random
  steps: {
    delaySteps?: { index: number; delay: number }[] | null; // AiDS {I,D}
    createWaySteps?: { index: number; ownHouse: number; targetHouse: number; attackDelay: number }[] | null; // AiCWS {I,OHId,THId,AD}
    railwayMoveSteps?: { index: number; targetPathPointIndex: number; building: number }[] | null; // AiRM {I,TPPI,BId}
    actionSteps?: { index: number; action: TwAiAction }[] | null; // AiSC {I,AiSA}
  };
}

export interface TwPlayer {
  type: TwPlayerType;
  pt: 0 | 1 | 2;
  color: TwColor;
  pc: 0 | 1 | 2 | 3 | 4;
  slotKey: TwSlotKey;
  ai?: TwAi;
  nullSlots?: number[];
  bdNull?: true;
  extra?: Record<string, unknown>;
}

export type TwBuildingKind =
  | 'house' | 'tower' | 'resource' | 'rocket_tower' | 'fortess' | 'flag'
  | 'selectable_fortess' | 'capture_rocket_tower' | 'boss_tower' | 'trolley' | 'speed_tower';

/** House params (`WT l ml cbi ws cwc sc gl`). */
export interface TwHouseParams {
  warriorType?: number;
  level?: number;
  maxLevel?: number;
  canBeIgnored?: boolean;
  spawnWarriorSpeed?: number;
  coefByWayCount?: number;
  spawnCoef?: number;
  growLevelTime?: number;
}
/** Tower params (`l ml cbi ad ar supl rupl bs`). */
export interface TwTowerParams {
  level?: number;
  maxLevel?: number;
  canBeIgnored?: boolean;
  attackDelay?: number;
  attackRadius?: number;
  speedUpByLevel?: number;
  radiusUpByLevel?: number;
  bulletSpeed?: number;
}
export type TwBuildingParams = TwHouseParams | TwTowerParams | Record<string, unknown>;

export interface TwBuilding {
  /** Index into `players[]`; `null` = unowned (WOD resource piles). */
  owner: number | null;
  kind: TwBuildingKind | (string & {});
  id: number;
  style?: number; // lt
  pos: TwVec;
  params?: TwBuildingParams;
  extra?: Record<string, unknown>;
  key: string;
}

export interface TwObstacle {
  parentPos: TwVec; // OPP
  parentRot: TwVec; // OPR
  childPos: TwVec[]; // OCP
  childRot: TwVec[]; // OCR
  active: boolean[]; // S
  extra?: Record<string, unknown>;
}
export interface TwMine { pos: TwVec; rot: TwVec; active: boolean; extra?: Record<string, unknown> }
export interface TwWall { pos: TwVec; rot: TwVec; active: boolean; hp: number; punchStrength: number; extra?: Record<string, unknown> }
export interface TwSheep { pos: TwVec; rot: TwVec; active: boolean; delayToReturn: number; isSquare: boolean; extra?: Record<string, unknown> }
export interface TwRiver { pos: TwVec; rot: TwVec; type: number; bridgeWidth: number; distance: number; extra?: Record<string, unknown> }
export interface TwCargo { building: number; points: TwVec[]; extra?: Record<string, unknown> }
export interface TwGate { type: number; coef: number; pos: TwVec; rot: TwVec; extra?: Record<string, unknown> }
export interface TwRailway { pos: TwVec; connectedBuilding: number; pathPoints: TwVec[]; startPathPointIndex: number; extra?: Record<string, unknown> }

export interface TwMapObjects {
  obstacles: TwObstacle[]; // OBS
  riverObstacles: TwObstacle[]; // ROBS
  mines: TwMine[]; // Mine
  walls: TwWall[]; // Wall
  sheep: TwSheep[]; // Sheep
  rivers: TwRiver[]; // River
  cargo: TwCargo[]; // Cargo
  gates: TwGate[]; // Gate
  railways: TwRailway[]; // Railway
}

export type TwCategory = 'arena' | 'boss' | 'campaign' | 'challengeTower' | 'daily' | 'daily-unlisted' | 'festival' | 'other' | 'pvp';

export interface TwSource {
  game: 'tower-war';
  gameVersion: string;
  asset: string;
  family: string;
  number: number | null;
  author: string | null;
  dialect: 'v1-short' | 'prefab-reconstructed';
  /** Prefab levels only. */
  origin?: 'prefab';
  prefab?: string;
  scriptedComponents?: string[];
}

export interface TwLevel {
  schema: 'node-arena/tw-level-ext@0.1';
  id: string;
  name: string;
  category: TwCategory;
  source: TwSource;
  players: TwPlayer[];
  buildings: TwBuilding[];
  mapObjects: TwMapObjects;
  extra?: Record<string, unknown>;
}

/** A prefab-derived level: frozen, hand-reconstructed data (UnityPy), not reproducible from raw TextAssets. */
export interface TwPrefabLevel extends TwLevel {
  handData: true;
}

export interface CampaignEntry {
  /** Asset name, e.g. `LevelView 182_NB`. */
  id: string;
  /** 1-based index in the remote-config list (tutorials included: LevelView 1 is 4). */
  position: number;
  isTutor: boolean;
}
