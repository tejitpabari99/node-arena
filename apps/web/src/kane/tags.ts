import { Vector2, Vector3 } from 'three';
import type { RuntimeContext } from '../app/state';
import type { createLevelScene } from '../render/scene';
import { buildingLetter } from './pairs';

/** Runtime-owned DOM labels, projected in CSS pixels from the mirrored world. */
export function createBuildingTags(context: RuntimeContext, scene: ReturnType<typeof createLevelScene>) {
  const layer = document.createElement('div');
  layer.className = 'kane-tags';
  layer.setAttribute('aria-hidden', 'true');
  const tags = context.driver.sim.view.ids.buildings.map((id, index) => {
    const span = document.createElement('span'), letter = buildingLetter(index);
    span.className = 'kane-tag';
    span.dataset.testid = 'kane-tag';
    span.dataset.letter = letter;
    span.dataset.index = String(index);
    span.dataset.buildingId = id;
    span.textContent = letter;
    layer.appendChild(span);
    return { span, id, index, owner: undefined as number | undefined };
  });
  scene.canvas.insertAdjacentElement('afterend', layer);
  const size = new Vector2(), point = new Vector3();
  const palettes: Readonly<Record<string, string>> = context.manifest.palettes;
  let disposed = false;
  const refresh = () => {
    if (disposed) return;
    // getSize reads Three's stored CSS size, never DOM geometry. The canvas fills #arena.
    scene.renderer.getSize(size);
    scene.scene.updateMatrixWorld(true);
    scene.camera.updateMatrixWorld(true);
    const view = context.driver.sim.view;
    for (const tag of tags) {
      const anchor = scene.world.anchors.building(tag.id);
      if (!anchor) continue;
      point.copy(anchor.pos).applyMatrix4(scene.worldRoot.matrixWorld).project(scene.camera);
      // Keep the disc left of the footprint, clear of the number sprite above the roof.
      tag.span.style.transform = `translate3d(${(point.x + 1) * size.x / 2}px,${(1 - point.y) * size.y / 2}px,0) translate(-150%,-50%)`;
      const owner = view.buildings.owner[tag.index]!;
      if (owner !== tag.owner) {
        const key = owner < 0 ? 'gray' : view.players[owner]!.colorKey;
        tag.span.style.borderColor = palettes[key] ?? context.manifest.palettes.gray;
        tag.owner = owner;
      }
    }
  };
  // Manual test runs also need a refresh after the initially hidden arena is shown.
  const observer = new ResizeObserver(refresh);
  observer.observe(scene.canvas);
  window.addEventListener('resize', refresh);
  refresh();
  return { refresh, dispose() {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    window.removeEventListener('resize', refresh);
    layer.remove();
  } };
}
