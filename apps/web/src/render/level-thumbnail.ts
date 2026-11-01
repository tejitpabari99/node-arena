import { loadCatalog, loadContent, type CompiledLevel, type ContentFiles, type ManifestV2 } from '@node-arena/content';
import { create, createTroopBuffer, type SimView } from '@node-arena/sim';
import { TextureLoader } from 'three';
import { loadManifest } from '../manifest/load.js';
import { fitCamera, levelVisualBounds, zoomFraming } from './camera.js';
import { createLevelScene } from './scene.js';

type Catalog = ReturnType<typeof loadCatalog>;
type LevelScene = ReturnType<typeof createLevelScene>;

export const LEVEL_THUMB_SIZE = { width: 256, height: 160 } as const;
const frame = () => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())));

export interface ThumbnailRenderContext { scene: LevelScene; manifest: ManifestV2; view: SimView; width: number; height: number }
export interface ThumbnailRenderOptions {
  width: number; height: number;
  /** Scene object names to hide (labels are always hidden). */
  hide?: readonly string[];
  /** Custom camera framing after the scene settled; default fits the whole level. */
  frameCamera?(context: ThumbnailRenderContext): void;
}
/** One offscreen host + one scene, re-leveled per render. Real manifest, catalog and sim, as the game does. */
export interface ThumbnailGl {
  readonly manifest: ManifestV2; readonly catalog: Catalog; readonly theme: string;
  render(level: CompiledLevel, options: ThumbnailRenderOptions): Promise<string>;
  dispose(): void;
}

export async function createThumbnailGl(files: ContentFiles): Promise<ThumbnailGl> {
  const manifest = await loadManifest();
  const catalog = loadCatalog(files, { themes: Object.keys(manifest.themes), colorKeys: Object.keys(manifest.palettes) });
  const theme = Object.keys(manifest.themes)[0]!;
  const loader = new TextureLoader(), textureLoads: Promise<void>[] = [];
  let textureError: unknown;
  const textureLoader = (path: string) => {
    let loaded!: () => void;
    textureLoads.push(new Promise<void>(resolve => { loaded = resolve; }));
    return loader.load(`/${path}`, loaded, undefined, error => { textureError ??= error; loaded(); });
  };
  const host = document.createElement('div');
  Object.assign(host.style, { position: 'fixed', left: '-9999px', top: '0', pointerEvents: 'none' });
  document.body.appendChild(host);
  let scene: LevelScene | undefined;
  return {
    manifest, catalog, theme,
    async render(level, options) {
      const { width, height } = options;
      host.style.width = `${width}px`; host.style.height = `${height}px`;
      textureLoads.length = 0; textureError = undefined; // a failure or stale loads from an earlier render must not poison this one
      const sim = create(level, 1);
      if (!scene) { scene = createLevelScene({ level, view: sim.view, manifest, parent: host, worldOptions: { textureLoader } }); await scene.ready; }
      else await scene.world.setLevel(level, level.theme);
      // Initial sim state applies neutral team textures and selects the one visible building stage.
      scene.world.setShowTowerRanges(false);
      scene.update({ view: sim.view, troops: createTroopBuffer(0), n: 0, alpha: 0 }, [], 0);
      await Promise.all(textureLoads);
      if (textureError) throw textureError;
      await frame(); // let the scene's ResizeObserver run before we override the camera
      for (const name of options.hide ?? []) { const object = scene.scene.getObjectByName(name); if (object) object.visible = false; }
      scene.scene.getObjectByName('world:labels')!.visible = false;
      const context = { scene, manifest, view: sim.view, width, height };
      if (options.frameCamera) options.frameCamera(context);
      else {
        const bounds = levelVisualBounds(sim.view, level.buildings.map(b => b.id), scene.world.anchors);
        fitCamera(scene.camera, bounds, manifest.camera, width / height, undefined, zoomFraming(false));
      }
      scene.camera.updateMatrixWorld();
      scene.scene.updateMatrixWorld(true);
      scene.render();
      return scene.canvas.toDataURL('image/png');
    },
    dispose() { scene?.dispose(); scene = undefined; host.remove(); },
  };
}

/** Whole-level top-down thumbnail as a PNG data URL. Pass a shared `gl` to reuse a context; otherwise one is created and released. */
export async function renderLevelThumbnail(level: CompiledLevel, size: { width: number; height: number } = LEVEL_THUMB_SIZE, options: { gl?: ThumbnailGl; files?: ContentFiles } = {}): Promise<string> {
  const own = !options.gl;
  const gl = options.gl ?? await createThumbnailGl(options.files ?? {});
  try { return await gl.render(level, size); } finally { if (own) gl.dispose(); }
}

export interface ThumbRenderer { render(levelId: string): Promise<string>; dispose(): void }
export interface LevelThumbnailService {
  /** Cached data URL, or undefined when not ready or failed. */
  get(levelId: string): string | undefined;
  /** Queue a render (lazy, deduped). Never throws. */
  request(levelId: string): void;
  subscribe(cb: () => void): () => void;
  dispose(): void;
}
export interface LevelThumbnailServiceOptions {
  /** Content version; part of the cache key. */
  version: string;
  createRenderer(): Promise<ThumbRenderer>;
  /** Tear the GL host down after the queue sat empty this long. Default 5000. */
  idleMs?: number;
}

export function createLevelThumbnailService(options: LevelThumbnailServiceOptions): LevelThumbnailService {
  const idleMs = options.idleMs ?? 5000, key = (id: string) => `${options.version}:${id}`;
  const cache = new Map<string, string>(), seen = new Set<string>(), listeners = new Set<() => void>(), queue: string[] = [];
  let renderer: Promise<ThumbRenderer> | undefined, running = false, disposed = false, idleTimer: ReturnType<typeof setTimeout> | undefined;
  const notify = () => listeners.forEach(fn => { try { fn(); } catch { /* listener errors never break the queue */ } });
  const release = () => {
    const current = renderer; renderer = undefined;
    void current?.then(r => { try { r.dispose(); } catch { /* ignore */ } }, () => undefined);
  };
  const pump = async () => {
    if (running) return;
    running = true;
    while (queue.length && !disposed) {
      const id = queue.shift()!;
      try {
        renderer ??= options.createRenderer();
        const url = await (await renderer).render(id);
        if (disposed) break;
        cache.set(key(id), url);
      } catch (e) {
        console.debug('level thumbnail failed', id, e);
        if (renderer) { const failed = renderer; renderer = undefined; void failed.then(r => { try { r.dispose(); } catch { /* ignore */ } }, () => undefined); }
      }
      notify();
    }
    running = false;
    if (!disposed && renderer) { clearTimeout(idleTimer); idleTimer = setTimeout(release, idleMs); }
  };
  return {
    get: id => cache.get(key(id)),
    request(id) {
      if (disposed || seen.has(key(id))) return;
      seen.add(key(id)); queue.push(id); clearTimeout(idleTimer);
      void pump();
    },
    subscribe(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
    dispose() { disposed = true; clearTimeout(idleTimer); queue.length = 0; listeners.clear(); release(); },
  };
}

/** Production wiring: compiles each requested level from the bundled content and renders it on one shared GL host. */
export function createWebGlLevelThumbnails(files: ContentFiles, version: string): LevelThumbnailService {
  return createLevelThumbnailService({
    version,
    async createRenderer() {
      const gl = await createThumbnailGl(files);
      let content: ReturnType<typeof loadContent> | undefined;
      return {
        async render(id) {
          content ??= loadContent(files, { themes: Object.keys(gl.manifest.themes), colorKeys: Object.keys(gl.manifest.palettes) });
          const level = content.compiled[id];
          if (!level) throw new Error(`Unknown level: ${id}`);
          return gl.render(level, LEVEL_THUMB_SIZE);
        },
        dispose: () => gl.dispose(),
      };
    },
  });
}
