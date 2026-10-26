import { compileLevel, computeRequires, loadCatalog, loadLevel } from '@node-arena/content';
import { create, createTroopBuffer } from '@node-arena/sim';
import { Box3, TextureLoader, Vector3 } from 'three';
import { contentFiles } from '../app/boot.js';
import { loadManifest } from '../manifest/load.js';
import { fitCamera } from '../render/camera.js';
import { createLevelScene } from '../render/scene.js';
import { blankDocument, type LevelDoc } from './document.js';
import type { LibraryItem } from './model.js';

export const LIBRARY_ITEMS: readonly LibraryItem[] = ['house-wt1', 'house-wt2', 'tower', 'obstacle-small', 'obstacle-big'];
/** Missing entry = render failed; the UI shows a text tile instead. */
export type Thumbnails = Partial<Record<LibraryItem, string>>;
/** Renders one data URL per item, in order. Implementations own and release their GL context; a throw marks that item missing. */
export interface ThumbnailRenderer {
  render(item: LibraryItem): Promise<string>;
  dispose(): void;
}
export type ThumbnailRendererFactory = () => Promise<ThumbnailRenderer>;

const SIZE = 128, HELPER = { x: 6, z: 6 };
const frame = () => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())));

function itemDoc(item: LibraryItem, theme: string): LevelDoc {
  const doc = blankDocument('na-thumb', theme, 'small');
  const obstacle = item.startsWith('obstacle-');
  // Obstacles need a building for the level to compile; it is hidden and framing ignores it.
  doc.buildings.push({ id: 'b0', archetype: obstacle ? 'house-wt1' : item, pos: obstacle ? HELPER : { x: 0, z: 0 }, owner: null, level: 1, ignoreForWin: false } as LevelDoc['buildings'][number]);
  if (obstacle) doc.elements.push({ id: 'e0', archetype: 'obstacle', variant: item === 'obstacle-big' ? 'big' : 'small', pos: { x: 0, z: 0 }, yawDeg: 0 } as LevelDoc['elements'][number]);
  return doc;
}

/** One offscreen host + one scene, re-leveled per item. Real manifest, catalog, compile and sim, as the editor viewport does. */
export const createWebGlThumbnailRenderer: ThumbnailRendererFactory = async () => {
  const manifest = await loadManifest();
  const catalog = loadCatalog(contentFiles(), { themes: Object.keys(manifest.themes), colorKeys: Object.keys(manifest.palettes) });
  const theme = Object.keys(manifest.themes)[0]!;
  const loader = new TextureLoader(), textureLoads: Promise<void>[] = [];
  let textureError: unknown;
  const textureLoader = (path: string) => {
    let loaded!: () => void;
    textureLoads.push(new Promise<void>(resolve => { loaded = resolve; }));
    return loader.load(`/${path}`, loaded, undefined, error => { textureError ??= error; loaded(); });
  };
  const host = document.createElement('div');
  Object.assign(host.style, { position: 'fixed', left: '-9999px', top: '0', width: `${SIZE}px`, height: `${SIZE}px`, pointerEvents: 'none' });
  document.body.appendChild(host);
  const compile = (item: LibraryItem) => {
    const doc = itemDoc(item, theme);
    const level = compileLevel(catalog, loadLevel(catalog, { ...doc, requires: computeRequires(catalog, doc) }).level);
    return { level, sim: create(level, 1) };
  };
  let scene: ReturnType<typeof createLevelScene> | undefined;
  return {
    async render(item) {
      const { level, sim } = compile(item);
      if (!scene) { scene = createLevelScene({ level, view: sim.view, manifest, parent: host, worldOptions: { textureLoader } }); await scene.ready; }
      else await scene.world.setLevel(level, level.theme);
      // Initial sim state applies neutral team textures and selects the one visible building stage.
      scene.world.setShowTowerRanges(false);
      scene.update({ view: sim.view, troops: createTroopBuffer(0), n: 0, alpha: 0 }, [], 0);
      await Promise.all(textureLoads);
      if (textureError) throw textureError;
      await frame(); // let the scene's ResizeObserver run before we override the camera
      const obstacle = item.startsWith('obstacle-');
      const hidden = obstacle ? 'b0' : undefined;
      if (hidden) scene.scene.getObjectByName(hidden)!.visible = false;
      scene.scene.getObjectByName('world:labels')!.visible = false;
      const box = new Box3();
      if (obstacle) box.setFromCenterAndSize(new Vector3(0, .5, 0), new Vector3(1.2, .8, 1.2));
      else {
        const a = scene.world.anchors.building('b0')!, r = a.radius;
        box.expandByPoint(new Vector3(a.pos.x - r, 0, -a.pos.z - r)); box.expandByPoint(new Vector3(a.pos.x + r, a.pos.y + r, -a.pos.z + r)); box.expandByScalar(r * .7);
      }
      fitCamera(scene.camera, box, { ...manifest.camera, margin: 0 }, 1, undefined, 1);
      scene.camera.updateMatrixWorld();
      scene.scene.updateMatrixWorld(true);
      scene.render();
      return scene.canvas.toDataURL('image/png');
    },
    dispose() { scene?.dispose(); scene = undefined; host.remove(); },
  };
};

let cached: Promise<Thumbnails> | undefined;

/** Renders the five library thumbnails once per page load; later calls share the result. Never rejects. */
export function getThumbnails(factory: ThumbnailRendererFactory = createWebGlThumbnailRenderer): Promise<Thumbnails> {
  cached ??= (async () => {
    const result: Thumbnails = {};
    let renderer: ThumbnailRenderer | undefined;
    try {
      renderer = await factory();
      for (const item of LIBRARY_ITEMS) {
        try { result[item] = await renderer.render(item); } catch (e) { console.debug("thumbnail failed", item, e); }
      }
    } catch (e) { console.debug("thumbnails failed", e); }
    finally { try { renderer?.dispose(); } catch { /* ignore */ } }
    return result;
  })();
  return cached;
}

/** Test hook: forget the memoized result. */
export function resetThumbnailsForTest(): void { cached = undefined; }
