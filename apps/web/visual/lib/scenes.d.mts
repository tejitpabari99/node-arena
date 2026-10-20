export const VISUAL_DIR: string;
export const WEB_DIR: string;
export const OUT_DIR: string;
export const PORT: number;
export const LEVELS_DIR: string;
export const ALL_LEVELS_TICK: number;
export const VIEWPORTS: string[];
export interface SceneCommand { type: string; player: string; from: string; to: string; tick?: number }
/** `action`: after reaching the frame tick (none = current tick), `pause` pauses like the Pause button; `results` fast-forwards the sim to the result screen. */
export interface SceneFrame { label?: string | null; tick?: number; relative?: number; after?: { event: string; plus: number }; settle?: boolean; action?: 'pause' | 'results' }
export interface Scene {
  id: string; level?: string; fixture?: string; screen?: 'menu' | 'picker';
  commands?: SceneCommand[]; frames?: SceneFrame[]; settings?: Record<string, unknown>;
  splitTrace?: { ticks: number }; laneCrop?: { from: string; to: string }; silentBots?: boolean; fallback?: Partial<Scene>; generated?: boolean;
}
export interface ScenesConfig { seed: number; viewports: string[]; extraViewports?: Record<string, string[]>; settings: Record<string, unknown>; scenes: Scene[] }
export interface CaptureOptions { scenes: string[]; viewports: string[]; headed: boolean; gpu: boolean; dev: boolean; build: boolean; lod: 'low' | 'high' | null; allLevels: boolean }
export function loadScenes(file?: string): ScenesConfig;
export function parseArgs(argv: string[]): CaptureOptions;
export function runFileName(opts: { perfOnly: boolean }): string;
export function parseViewport(id: string): { width: number; height: number };
export function captureJobs(config: ScenesConfig, opts?: Pick<CaptureOptions, 'scenes' | 'viewports'> & { allLevels?: boolean }): { scene: Scene; viewport: string }[];
export function frameFile(sceneId: string, viewport: string, label?: string | null): string;
export function sceneFrames(scene: Scene): (SceneFrame & { label: string | null; settle: boolean })[];
export function levelScenes(dir?: string): Scene[];
export function allScenes(config: ScenesConfig, dir?: string): Scene[];
