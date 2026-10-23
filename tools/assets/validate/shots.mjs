// Playwright/Vite plumbing for turntable renders: startShooter() -> { shoot(opts, file), close() }.
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const web = createRequire(path.join(root, 'apps/web/package.json'));

export async function startShooter({ extract, port = 4181 }) {
  process.env.TW_EXTRACT = extract; // read by vite.config.mjs (fs.allow)
  const pw = await import(pathToFileURL(web.resolve('@playwright/test')).href);
  const chromium = pw.chromium ?? pw.default.chromium;
  const { createServer } = await import(pathToFileURL(web.resolve('vite')).href);
  const server = await createServer({ configFile: path.join(here, 'vite.config.mjs'), logLevel: 'warn', server: { port, strictPort: true, host: '127.0.0.1' } });
  await server.listen();
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error('pageerror', e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('console', m.text()); });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__ready, null, { timeout: 60_000 });
  const url = glb => `/@fs${path.resolve(glb)}`;
  return {
    /** Render one view; returns PNG Buffer (and writes it when `file` given). */
    async shoot(opts, file) {
      const w = opts.w ?? 512, h = opts.h ?? 512;
      await page.setViewportSize({ width: w, height: h });
      const info = await page.evaluate(o => window.renderShot(o), { ...opts, glb: url(opts.glb) });
      const buf = await page.locator('canvas').screenshot(file ? { path: file } : {});
      return { buf, info };
    },
    async close() { await browser.close(); await server.close(); },
  };
}
