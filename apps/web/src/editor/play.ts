import type { ContentFiles } from '@node-arena/content';
import { createAppController } from '../app/state.js';
import { createBrowserRuntime } from '../app/runtime.js';
import { connectAppAudio } from '../audio/app.js';
import { createInputController } from '../input/index.js';
import { loadManifest } from '../manifest/load.js';
import { mountApp } from '../ui/App.js';
import type { LevelDoc } from './document.js';
import { editorPlayOptions } from './play-content.js';

/** Owns only Play resources. The editor's document/history/selection stay mounted. */
export function mountEditorPlay(parent: HTMLElement, files: ContentFiles, doc: LevelDoc, onExit: () => void) {
  const options = editorPlayOptions(files, doc);
  const overlay = document.createElement('section'); overlay.className = 'editor-play-overlay'; overlay.setAttribute('aria-label', 'Play level');
  const arena = document.createElement('div'); arena.className = 'editor-play-arena'; arena.setAttribute('aria-label', 'Arena');
  const ui = document.createElement('div'); ui.className = 'editor-play-ui';
  const bar = document.createElement('div'); bar.className = 'editor-play-bar';
  const back = document.createElement('button'); back.textContent = 'Back to editor';
  const timing = document.createElement('span'); timing.dataset.testid = 'play-load-cost'; timing.textContent = 'Loading content…';
  bar.append(back, timing); overlay.append(arena, ui, bar); parent.append(overlay);
  let disposed = false, started = false, loadStart = 0, loadContentMs = 0;
  const app = createAppController({
    ...options,
    loadManifest: async () => { const manifest = await loadManifest(); loadStart = performance.now(); return manifest; },
    createRuntime: context => createBrowserRuntime(context, arena, (ctx, stage) => createInputController({ canvas: stage.canvas, sim: ctx.driver.sim, camera: stage.camera, world: stage.world, worldRoot: stage.worldRoot, scene: stage.scene, driver: ctx.driver, isEnabled: () => ctx.enabled() && !ctx.driver.paused })),
  });
  const unmount = mountApp(app, ui, exit), audio = connectAppAudio(app);
  const unsubscribe = app.subscribe(() => { if (started && app.snapshot().screen === 'picker') exit(); });
  function dispose() {
    if (disposed) return; disposed = true;
    back.removeEventListener('click', exit); unsubscribe(); audio.dispose(); unmount(); app.dispose(); overlay.remove();
  }
  function exit() { if (!disposed) { dispose(); onExit(); } }
  back.addEventListener('click', exit);
  const ready = (async () => {
    await app.boot();
    if (disposed) return;
    loadContentMs = performance.now() - loadStart;
    timing.textContent = `Content loaded in ${loadContentMs.toFixed(1)} ms`;
    if (app.snapshot().screen !== 'picker') return;
    // Ignore the initial boot picker; subsequent normal picker transitions exit Play.
    started = true;
    await app.startLevel(doc.id);
  })();
  return { app, ready, dispose, get loadContentMs() { return loadContentMs; } };
}
