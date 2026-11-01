import { compileLevel, computeRequires, loadLevel } from '@node-arena/content';
import { Box3, Vector3 } from 'three';
import { contentFiles } from '../app/boot.js';
import { fitCamera } from '../render/camera.js';
import { createThumbnailGl } from '../render/level-thumbnail.js';
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

function itemDoc(item: LibraryItem, theme: string): LevelDoc {
  const doc = { ...blankDocument('na-thumb', theme, 'small'), buildings: [] as LevelDoc['buildings'] };
  const obstacle = item.startsWith('obstacle-');
  // Obstacles need a building for the level to compile; it is hidden and framing ignores it.
  doc.buildings.push({ id: 'b0', archetype: obstacle ? 'house-wt1' : item, pos: obstacle ? HELPER : { x: 0, z: 0 }, owner: null, level: 1, ignoreForWin: false } as LevelDoc['buildings'][number]);
  if (obstacle) doc.elements.push({ id: 'e0', archetype: 'obstacle', variant: item === 'obstacle-big' ? 'big' : 'small', pos: { x: 0, z: 0 }, yawDeg: 0 } as LevelDoc['elements'][number]);
  return doc;
}

/** One shared offscreen host + scene (render/level-thumbnail), re-leveled per item. Real manifest, catalog, compile and sim, as the editor viewport does. */
export const createWebGlThumbnailRenderer: ThumbnailRendererFactory = async () => {
  const gl = await createThumbnailGl(contentFiles());
  const compile = (item: LibraryItem) => {
    const doc = itemDoc(item, gl.theme);
    return compileLevel(gl.catalog, loadLevel(gl.catalog, { ...doc, requires: computeRequires(gl.catalog, doc) }).level);
  };
  return {
    render(item) {
      const obstacle = item.startsWith('obstacle-');
      return gl.render(compile(item), {
        width: SIZE, height: SIZE,
        hide: obstacle ? ['b0'] : [],
        frameCamera({ scene, manifest }) {
          const box = new Box3();
          if (obstacle) box.setFromCenterAndSize(new Vector3(0, .5, 0), new Vector3(1.2, .8, 1.2));
          else {
            const a = scene.world.anchors.building('b0')!, r = a.radius;
            box.expandByPoint(new Vector3(a.pos.x - r, 0, -a.pos.z - r)); box.expandByPoint(new Vector3(a.pos.x + r, a.pos.y + r, -a.pos.z + r)); box.expandByScalar(r * .7);
          }
          fitCamera(scene.camera, box, { ...manifest.camera, margin: 0 }, 1, undefined, 1);
        },
      });
    },
    dispose() { gl.dispose(); },
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
