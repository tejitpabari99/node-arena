// Capture page: /?scene=<name>. Loads the registered scene, sets window.__sceneReady when the first frame is drawn.
import { loadScene, sceneNames } from './scenes/index.js';

const name = new URLSearchParams(location.search).get('scene');
window.__sceneReady = false;
window.__sceneError = null;
try {
  if (!name || !sceneNames.includes(name)) throw new Error(`unknown scene "${name}"; known: ${sceneNames.join(', ')}`);
  const mod = await loadScene(name);
  const canvas = document.createElement('canvas');
  canvas.width = innerWidth;
  canvas.height = innerHeight;
  document.body.append(canvas);
  await mod.default({ canvas, name, width: canvas.width, height: canvas.height });
  window.__sceneReady = true;
} catch (e) {
  window.__sceneError = String(e && e.stack || e);
  console.error(window.__sceneError);
}
