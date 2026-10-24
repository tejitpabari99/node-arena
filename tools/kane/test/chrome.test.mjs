import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromeArgs, resolveChromeBinary, launchChrome, preparePage } from '../lib/chrome.mjs';
test('Chrome launches only about:blank with visibility and server flags', () => {
  const args = chromeArgs({ port: 9922, userDataDir: '/tmp/profile', headless: true, root: true });
  assert.equal(args.at(-1), 'about:blank');
  for (const flag of ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9922', '--window-size=1600,900', '--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--no-sandbox']) assert.ok(args.includes(flag), flag);
  assert.ok(!chromeArgs({ port: 9922, userDataDir: '/tmp/profile', root: false }).includes('--no-sandbox'));
});
test('Chrome discovery honors explicit/env binaries and rejects unavailable overrides', async () => {
  assert.equal(await resolveChromeBinary({ chrome: process.execPath }), process.execPath);
  assert.equal(await resolveChromeBinary({ env: { KANE_CLI_CHROME_PATH: process.execPath } }), process.execPath);
  await assert.rejects(resolveChromeBinary({ chrome: '/missing/chrome' }), /Chrome binary/);
});
test('visibility mitigation retries paused once and fails stuck paused with exit 23', async () => {
  const calls = [], warnings = [];
  let reads = 0;
  const cdp = { send: async method => { calls.push(method); }, evaluate: async expression => expression.includes('hidden:') ? { hidden: ++reads < 2, paused: false } : undefined, setFocusEmulation: async () => {} };
  const page = { cdp, sessionId: 's', summary: async () => ({ tick: 1 }), onWarn: warning => warnings.push(warning) };
  await preparePage(page);
  assert.equal(calls.filter(method => method === 'Page.bringToFront').length, 2);
  assert.equal(warnings[0].code, 'paused_hidden');
  cdp.evaluate = async expression => expression.includes('hidden:') ? { hidden: true, paused: false } : undefined;
  await assert.rejects(preparePage(page), error => error.exitCode === 23);
});
test('launch rejects early Chrome exit with exit 22', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'na-chrome-test-'));
  const executable = join(directory, 'chrome');
  await writeFile(executable, '#!/bin/sh\nexit 7\n', { mode: 0o755 });
  try { await assert.rejects(launchChrome({ url: 'about:blank', chrome: executable, port: 0, timeoutMs: 1000, handleSignals: false }), error => error.exitCode === 22); }
  finally { await rm(directory, { recursive: true, force: true }); }
});

test('Playwright preference resolves cached Chromium before system Chrome and retains overrides', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'na-chrome-discovery-'));
  const cache = join(directory, 'cache'), cached = join(cache, 'chromium-123', 'chrome-linux64', 'chrome');
  const system = join(directory, 'chromium');
  await mkdir(join(cache, 'chromium-123', 'chrome-linux64'), { recursive: true });
  await writeFile(cached, '#!/bin/sh\n', { mode: 0o755 });
  await writeFile(system, '#!/bin/sh\n', { mode: 0o755 });
  const env = { PATH: directory, PLAYWRIGHT_BROWSERS_PATH: cache };
  try {
    assert.equal(await resolveChromeBinary({ env }), system);
    assert.equal(await resolveChromeBinary({ env, preferPlaywright: true }), cached);
    assert.equal(await resolveChromeBinary({ chrome: system, env, preferPlaywright: true }), system);
    assert.equal(await resolveChromeBinary({ env: { ...env, KANE_CLI_CHROME_PATH: system }, preferPlaywright: true }), system);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
