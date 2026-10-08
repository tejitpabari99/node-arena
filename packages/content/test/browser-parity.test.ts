import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { build, preview } from 'vite';
import { compileLevel, loadContent, type ContentFileMap } from '../src/index.js';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const browserRoot = fileURLToPath(new URL('./fixtures/browser', import.meta.url));

// A broken Vite raw/default adapter, a Node-only dependency, or a divergent
// browser numeric/hash path must fail at the actual shipped browser boundary.
test('AC6 (covers R-TCK-02, covers R-TCK-03): Node fs and a Vite raw glob compile identically in Chromium', { timeout: 60000 }, async () => {
  const files: ContentFileMap = {
    'content.json': await readFile(join(packageRoot, 'content.json'), 'utf8'),
  };
  for (const entry of await readdir(join(packageRoot, 'data'), { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const path = join(entry.parentPath, entry.name);
    files[relative(packageRoot, path).split('\\').join('/')] = await readFile(path, 'utf8');
  }
  const loaded = loadContent(files);
  const levels = Object.values(loaded).filter(entity => 'towers' in entity).map(entity => compileLevel(loaded, entity.id));
  assert.ok(levels.length > 0, 'real content must contain levels');
  const outDir = await mkdtemp(join(tmpdir(), 'node-arena-content-browser-'));
  try {
    await build({ configFile: false, root: browserRoot, logLevel: 'silent', build: { outDir, emptyOutDir: true } });
    const server = await preview({ configFile: false, root: browserRoot, logLevel: 'silent', build: { outDir }, preview: { host: '127.0.0.1', port: 0 } });
    try {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        const url = server.resolvedUrls?.local[0];
        assert.ok(url, 'preview must bind a loopback URL');
        await page.goto(url);
        await page.waitForFunction(() => document.querySelector('#result')?.textContent, null, { timeout: 10000 });
        assert.deepEqual(errors, []);
        const actual = JSON.parse(await page.locator('#result').innerText()) as { paths: string[]; levels: unknown[]; nodeGlobals: string[] };
        assert.deepEqual(actual.nodeGlobals, ['undefined', 'undefined', 'undefined']);
        assert.deepEqual(actual.paths, Object.keys(files).sort(), 'glob must load exactly the same authored files');
        assert.deepEqual(actual.levels, levels, 'all compiled fields, including simHash and botHash, must agree');
        assert.equal((actual.levels[0] as { simHash: string }).simHash, levels[0]!.simHash);
      } finally { await browser.close(); }
    } finally { await server.close(); }
  } finally { await rm(outDir, { recursive: true, force: true }); }
});
