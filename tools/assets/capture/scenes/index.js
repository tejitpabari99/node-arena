// Scene registry. Later tasks replace a stub entry with the real renderer: point `load` at a module whose
// default export is `async ({ canvas, name, width, height }) => void` and which has drawn >=1 frame on resolve.
// `ref` (optional) = path relative to BF/ref/ of the reference frame used by `--compare`.
export const scenes = {
  'stub': { load: () => import('./stub.js') },
  'l4-green': { load: () => import('./l4-green.js'), ref: 'tw-yt/L04.jpg' },
  'l21-snow': { load: () => import('./l21-snow.js'), ref: 'tw-yt/L21.jpg' },
  'unit-lineup': { load: () => import('./unit-lineup.js'), ref: 'tw-yt/d-battle-lanes.jpg' },
  'stage-ladder': { load: () => import('./stage-ladder.js'), ref: 'tw-yt/d-house-levels-11.jpg' },
  'fx': { load: () => import('./fx-scene.js'), ref: 'tw-yt/d-tower-firing.jpg' },
  'obstacles-green': { load: () => import('./obstacles-green.js') },
  'obstacles-snow': { load: () => import('./obstacles-snow.js') },
};
export const sceneNames = Object.keys(scenes);
export const loadScene = name => scenes[name].load();
