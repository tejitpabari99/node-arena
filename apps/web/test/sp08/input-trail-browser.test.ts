import { expect, it } from 'vitest';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

it('renders a cut slash at least 3px thick and fades it within 300ms after release', async () => {
  const server = await createServer({ configFile: false, root: process.cwd(), optimizeDeps: { noDiscovery: true, include: [] }, server: { host: '127.0.0.1', port: 0 },
    plugins: [{ name: 'trail-fixture', configureServer(s) { s.middlewares.use('/__trail', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<body style="margin:0;background:black"><canvas style="width:800px;height:600px"></canvas>'); }); } }] });
  await server.listen();
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.goto(server.resolvedUrls!.local[0] + '__trail');
    await page.evaluate(async () => {
      const load = new Function('url', 'return import(url)');
      const { createInputController } = await load('/src/input/index.ts');
      const { Group, PerspectiveCamera, Scene, WebGLRenderer } = await load('/node_modules/three/build/three.module.js');
      const canvas = document.querySelector('canvas')!;
      const renderer = new WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true }); renderer.setSize(800, 600);
      const camera = new PerspectiveCamera(45, 800 / 600, .1, 100); camera.position.set(0, 10, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
      const scene = new Scene(), root = new Group(); root.scale.z = -1; scene.add(root);
      const sim = { view: { players: [{ kind: 'human', colorKey: 'blue' }], ids: { buildings: [] }, buildings: { owner: [] }, buildingStatic: [], lines: [], over: null } };
      let frozen: number | undefined, offset = 0;
      const now = () => (frozen ?? performance.now()) - offset;
      const input = createInputController({ canvas, camera, scene, worldRoot: root, sim, now, world: { anchors: { building: () => undefined }, pickMeshes: [], previewLane() {}, clearPreview() {}, select() {} }, driver: { submit() {} } });
      const render = () => { input.refresh(); renderer.render(scene, camera); requestAnimationFrame(render); }; render();
      const gl = renderer.getContext(), pixels = new Uint8Array(240 * 60 * 4);
      Object.assign(window, {
        freezeTrail: () => { frozen = performance.now(); },
        resumeTrail: () => { offset += performance.now() - frozen!; frozen = undefined; },
        trailThickness: () => {
          gl.readPixels(300, 270, 240, 60, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          let thickest = 0;
          for (let x = 0; x < 240; x++) { let lit = 0; for (let y = 0; y < 60; y++) if (pixels[(y * 240 + x) * 4]! > 20) lit++; thickest = Math.max(thickest, lit); }
          return thickest;
        },
      });
    });
    await page.mouse.move(260, 300); await page.mouse.down(); await page.mouse.move(540, 300, { steps: 8 });
    // Pause only the injected clock during screenshot encoding; fade assertions run on live time.
    await page.evaluate(() => Reflect.get(window, 'freezeTrail')());
    const during = await page.evaluate(() => Reflect.get(window, 'trailThickness')()); expect(during).toBeGreaterThanOrEqual(3);
    await page.screenshot({ path: '/tmp/sp02-task3-trail-visible.png' });
    await page.evaluate(() => Reflect.get(window, 'resumeTrail')());
    await page.mouse.up();
    const afterRelease = await page.evaluate(() => Reflect.get(window, 'trailThickness')()); expect(afterRelease).toBeGreaterThanOrEqual(3);
    await page.waitForTimeout(300);
    const faded = await page.evaluate(() => Reflect.get(window, 'trailThickness')()); expect(faded).toBe(0);
    console.log('CUT_RIBBON_PIXELS', { during, afterRelease, faded });
    await page.screenshot({ path: '/tmp/sp02-task3-trail-faded.png' });
  } finally { await browser.close(); await server.close(); }
}, 20000);
