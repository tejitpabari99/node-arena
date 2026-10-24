import { afterEach, expect, it, vi } from 'vitest';
import { Box3, PerspectiveCamera, Vector3 } from 'three';
import type { ManifestV2 } from '@node-arena/content';
import type { SimView } from '@node-arena/sim';
import { createLevelScene } from '../../src/render/scene';
import { fitCamera, HUD_PADDING, zoomFraming } from '../../src/render/camera';

vi.mock('three', async importOriginal => {
  const actual = await importOriginal<typeof import('three')>();
  return { ...actual, WebGLRenderer: class {
    domElement = { style: {}, remove() {} };
    setPixelRatio() {} setSize() {} render() {} dispose() {} forceContextLoss() {}
  } };
});
vi.mock('../../src/render/world.js', () => ({ createWorldRenderer: () => ({
  anchors: { building: () => undefined }, setLevel: async () => {}, dispose() {},
}) }));
afterEach(() => vi.unstubAllGlobals());

it('refits the real camera with fresh getter padding on every resize', async () => {
  vi.stubGlobal('window', { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const parent = { clientWidth: 1600, clientHeight: 900, appendChild() {} } as unknown as HTMLElement;
  const bounds = { minX: -6000, maxX: 6000, minZ: -4000, maxZ: 4000 };
  const settings = { fov: 21, pitchDeg: 55, margin: 3 };
  let reserved = 210;
  const stage = createLevelScene({ parent, level: { theme: 'green', buildings: [] } as never,
    view: { bounds } as SimView, manifest: { camera: settings, themes: { green: { sky: '#abcdef' } } } as unknown as ManifestV2,
    padding: () => ({ ...HUD_PADDING, bottom: reserved }),
  });
  await stage.ready;
  const expected = new PerspectiveCamera();
  const check = () => {
    fitCamera(expected, new Box3(new Vector3(-6, 0, -4), new Vector3(6, 0, 4)), settings,
      parent.clientWidth / parent.clientHeight, { width: parent.clientWidth, height: parent.clientHeight, padding: { ...HUD_PADDING, bottom: reserved } }, zoomFraming(false));
    expect(stage.camera.position.toArray()).toEqual(expected.position.toArray());
    expect(stage.camera.projectionMatrix.elements).toEqual(expected.projectionMatrix.elements);
  };
  check();
  reserved = 180.96;
  Object.assign(parent, { clientWidth: 1366, clientHeight: 768 });
  stage.resize(); check(); stage.dispose();
});

it.each([[400, 140], [636, 140], [768, 168.96], [900, 198], [1000, 220], [1200, 220]])(
  'reserves a bounded panel height for a %i px viewport', async (height, expected) => {
    const { panelHeight } = await import('../../src/kane/layout');
    expect(panelHeight(height)).toBe(expected);
  },
);

it.each([undefined, HUD_PADDING])('preserves common framing with default or static HUD padding (%s)', async padding => {
  vi.stubGlobal('window', { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const settings = { fov: 21, pitchDeg: 55, margin: 3 };
  const stage = createLevelScene({ parent: { clientWidth: 1600, clientHeight: 900, appendChild() {} } as unknown as HTMLElement,
    level: { theme: 'green', buildings: [] } as never,
    view: { bounds: { minX: -6000, maxX: 6000, minZ: -4000, maxZ: 4000 } } as SimView,
    manifest: { camera: settings, themes: { green: { sky: '#abcdef' } } } as unknown as ManifestV2,
    ...(padding ? { padding } : {}),
  });
  await stage.ready;
  const expected = new PerspectiveCamera();
  fitCamera(expected, new Box3(new Vector3(-6, 0, -4), new Vector3(6, 0, 4)), settings, 1600 / 900,
    { width: 1600, height: 900, padding: { left: 36, right: 36, top: 104, bottom: 64 } }, .87);
  expect(stage.camera.position.toArray()).toEqual(expected.position.toArray());
  expect(stage.camera.projectionMatrix.elements).toEqual(expected.projectionMatrix.elements);
  stage.dispose();
});
