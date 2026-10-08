const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

// Catches a missing command, missing/stale baseline, or Node hash drift.
test('sim:golden checks committed recorder-based golden replays', () => {
  const result = spawnSync('pnpm', ['sim:golden'], { cwd: path.resolve(__dirname, '../../..'), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /golden replays verified/);
});

const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
require('tsx/cjs');
const { runGoldens } = require('./golden/run.ts');
const { scenarios } = require('./golden/scenarios.ts');
const metadata = require('../../content/content.json');
const { assertVersionBump, gitBaseline, updateFile } = require('../scripts/golden.cjs');
const baseline = require('./golden/baseline.json');

test('every committed record plays, commands are applied, and fixtures exercise their named mechanic', () => {
  const results = runGoldens(metadata);
  assert.deepEqual(results.map(({ events, ...r }) => r), baseline.results);
  const byName = Object.fromEntries(results.map(r => [r.name, r]));
  const log = name => byName[name].events;
  assert.equal(log('persistent-cut-replaced').filter(e => e.type === 'LineCut' && e.reason === 'replaced').length, 1);
  assert.ok(log('persistent-cut-replaced').some(e => e.type === 'TroopArrived' && e.tick > 4));
  assert.equal(log('slot-reduction').find(e => e.type === 'LineCut').reason, 'slots');
  assert.deepEqual(log('head-on-clash').find(e => e.type === 'Clash'), { type: 'Clash', tick: 3, channel: 1, progA: 200, progB: 200, value: 1 });
  assert.deepEqual(log('overshoot-capture').filter(e => e.type === 'TroopArrived').map(e => e.owner), [0, 1]);
  assert.deepEqual(log('overshoot-capture').filter(e => e.type === 'Captured').map(e => e.to), [0, 1]);
  assert.equal(log('cap-overflow').filter(e => e.type === 'TroopArrived' && e.effect === 'overflow').length, 4);
  assert.equal(log('command-rejections').filter(e => e.type === 'CommandRejected').length, 3);
  assert.equal(byName['command-rejections'].replay.commands.length, 4);
  assert.equal(byName['mutual-defeat'].replay.outcome.outcome, 'draw');
  assert.deepEqual(scenarios.filter(s => s.fullGame).map(s => byName[s.name].replay.outcome.outcome), ['won', 'lost', 'timeout']);
  assert.equal(log('full-transit-win').find(e => e.type === 'Captured').tick, 2);
  assert.equal(log('full-transit-win').find(e => e.type === 'PlayerEliminated').tick, 101);
  // The checker must not merely re-create records without playing committed inputs.
  const { playReplay } = require('../src/index.ts');
  for (const result of baseline.results) {
    const level = baseline.scenarios.find(s => s.name === result.name).level;
    const played = playReplay({ metadata, level }, result.replay);
    assert.equal(played.ok, true);
    if (result.name === 'generation-cap') {
      assert.equal(played.sim.view.tower.col['garrison.count'][0], 2);
      assert.equal(played.sim.view.tower.col['generates.acc'][0], 5000); // Remaining fraction freezes at cap.
      assert.equal(played.sim.view.players[0].stats.generated, 2);
    }
  }
});

// Deleting/weakening version checks, string-comparing semver, or checking only
// the working baseline must fail these tests. Metadata fixtures never edit content.
test('golden updates require appropriate strictly increased versions, including identical output', () => {
  assert.throws(() => assertVersionBump(baseline, baseline), /increased authoritative version/);
  const changed = structuredClone(baseline);
  changed.results[0].eventLogHash = '0'.repeat(16);
  assert.throws(() => assertVersionBump(changed, baseline), /increased authoritative version/);
  changed.metadata.contentVersion = '1.0.1';
  assert.throws(() => assertVersionBump(changed, baseline), /rulesVersion/);
  changed.metadata.rulesVersion = '1.0.1';
  assert.doesNotThrow(() => assertVersionBump(changed, baseline));
  const inputs = structuredClone(baseline);
  inputs.scenarios[0].level.towers[0].x++;
  inputs.metadata.rulesVersion = '1.0.1';
  assert.throws(() => assertVersionBump(inputs, baseline), /contentVersion or schemaVersion/);
  inputs.metadata.contentVersion = '1.0.1';
  assert.doesNotThrow(() => assertVersionBump(inputs, baseline));
  const bumped = structuredClone(baseline); bumped.metadata.contentVersion = '1.0.10';
  const old = structuredClone(baseline); old.metadata.contentVersion = '1.0.9';
  assert.doesNotThrow(() => assertVersionBump(bumped, old));
  bumped.metadata.rulesVersion = '0.9.9';
  assert.throws(() => assertVersionBump(bumped, old), /decrease/);
});

test('git baseline prevents deletion/bootstrap bypass, and refused writes preserve the file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-golden-guard-'));
  const run = args => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  try {
    run(['init']); run(['config', 'user.name', 'Golden Test']); run(['config', 'user.email', 'test@example.invalid']);
    fs.writeFileSync(path.join(root, 'README.md'), 'fixture\n');
    run(['add', '.']); run(['commit', '-m', 'initial']);
    assert.equal(gitBaseline(root, 'HEAD', 'baseline.json'), null);
    const file = path.join(root, 'baseline.json');
    updateFile(file, baseline, [null, gitBaseline(root, 'HEAD', 'baseline.json')]);
    run(['add', '.']); run(['commit', '-m', 'baseline']);
    const committed = gitBaseline(root, 'HEAD', 'baseline.json');
    assert.deepEqual(committed, baseline);
    fs.unlinkSync(file);
    assert.throws(() => updateFile(file, baseline, [null, committed]), /increased authoritative version/);
    assert.equal(fs.existsSync(file), false);
    fs.writeFileSync(file, 'preserve me');
    assert.throws(() => updateFile(file, baseline, [committed]), /increased authoritative version/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'preserve me');
    const next = structuredClone(baseline); next.metadata.rulesVersion = '1.1.0';
    updateFile(file, next, [committed]);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), next);
    assert.throws(() => gitBaseline(root, 'no-such-ref', 'baseline.json'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('same-state --update refuses the authoritative versions without touching the committed baseline', () => {
  const file = path.join(__dirname, 'golden/baseline.json'), before = fs.readFileSync(file, 'utf8');
  const result = spawnSync('pnpm', ['sim:golden', '--update'], { cwd: path.resolve(__dirname, '../../..'), encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /increased authoritative version/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('Node and Chromium golden hashes, full event logs and playback records agree exactly', { timeout: 60000 }, async () => {
  const { chromium } = await import('playwright');
  const { build, preview } = await import('vite');
  const browserRoot = path.join(__dirname, 'golden/browser');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-golden-browser-'));
  try {
    await build({ configFile: false, root: browserRoot, logLevel: 'silent', build: { outDir, emptyOutDir: true } });
    const server = await preview({ configFile: false, root: browserRoot, logLevel: 'silent', build: { outDir }, preview: { host: '127.0.0.1', port: 0 } });
    try {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        assert.ok(server.resolvedUrls?.local[0]);
        await page.goto(server.resolvedUrls.local[0]);
        await page.waitForFunction(() => document.querySelector('#result')?.textContent, null, { timeout: 10000 });
        assert.deepEqual(errors, []);
        const actual = JSON.parse(await page.locator('#result').innerText());
        assert.deepEqual(actual.nodeGlobals, ['undefined', 'undefined', 'undefined']);
        assert.deepEqual(actual.results, runGoldens(metadata));
        assert.deepEqual(actual.results.map(({ events, ...r }) => r), baseline.results);
        assert.deepEqual(actual.played, baseline.results.map(r => ({ name: r.name, ok: true, finalHash: r.replay.finalHash })));
      } finally { await browser.close(); }
    } finally { await server.close(); }
  } finally { fs.rmSync(outDir, { recursive: true, force: true }); }
});
