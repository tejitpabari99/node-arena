// The web client imports `createBotDriver` from the built bots package (apps/web/src/driver/bot.ts).
// Parity: the built ESM bundle (dist) behaves identically to the TS source used by tests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
require('tsx/cjs');
const src = require('../src/index.ts');
const sim = require('../../sim/src/index.ts');
const fx = require('../../sim/test/fixtures.cjs');

const dist = path.resolve(__dirname, '../dist/index.js');
const loaded = fx.content.loadContent(fx.dataFiles());
const level = loaded.compiled[loaded.catalog.campaigns.common.entries.find(e => e.position === 4).level];

function play(api, simApi) {
  const s = simApi.create(level, 17), d = api.createBotDriver(level, 17), log = [];
  while (!s.view.over && s.view.tick < 1500) { const c = d.commands(s); log.push([s.view.tick, c]); s.step(c); }
  return { log, hash: s.hash() };
}

test('covers R2: web consumes createBotDriver from the bots package entry', () => {
  const web = fs.readFileSync(path.resolve(__dirname, '../../../apps/web/src/driver/bot.ts'), 'utf8');
  assert.match(web, /export \{ createBotDriver \} from '@node-arena\/bots'/);
});

test('covers R2: built dist driver matches source driver (commands + hash)', { skip: !fs.existsSync(dist) && 'dist not built (pnpm build)' }, async () => {
  const built = await import(dist);
  assert.equal(typeof built.createBotDriver, 'function');
  assert.deepEqual(built.HUMAN_PROXY, src.HUMAN_PROXY);
  assert.equal(built.BOT_VERSION, src.BOT_VERSION);
  const a = play(src, sim), b = play(built, sim);
  assert.deepEqual(a.log, b.log);
  assert.equal(a.hash, b.hash);
  assert.ok(a.log.some(([, c]) => c.length));
});
