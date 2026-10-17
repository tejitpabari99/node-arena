const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRequire } = require('node:module');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

// The workspace already ships these tools with web. Resolve them explicitly from
// that package instead of relying on an undeclared hoisted bots dependency.
const webRequire = createRequire(join(__dirname, '../../../apps/web/package.json'));
test('Node and Chromium complete identical compiled-level bot runs with full logs and hashes', { timeout: 60000 }, async () => {
  const { chromium } = webRequire('@playwright/test');
  const { build, preview } = await import(pathToFileURL(webRequire.resolve('vite')).href);
  const { compiledCorpus } = await import('./fixtures/corpus.mjs');
  const { runCorpus } = await import('./fixtures/matches.mjs');
  const levels = await compiledCorpus();
  const expected = runCorpus(levels);
  const root = join(__dirname, 'fixtures/browser');
  const outDir = await mkdtemp(join(tmpdir(), 'node-arena-bots-browser-'));
  try {
    await build({ configFile: false, root, logLevel: 'silent', build: { outDir, emptyOutDir: true } });
    const server = await preview({ configFile: false, root, logLevel: 'silent', build: { outDir }, preview: { host: '127.0.0.1', port: 0 } });
    try {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        await page.goto(server.resolvedUrls.local[0]);
        const actual = await page.evaluate(levels => window.runBotCorpus(levels), levels);
        assert.deepEqual(errors, []);
        assert.deepEqual(actual.nodeGlobals, ['undefined', 'undefined', 'undefined']);
        assert.deepEqual(actual.matches, expected);
      } finally { await browser.close(); }
    } finally { await server.close(); }
  } finally { await rm(outDir, { recursive: true, force: true }); }
});
