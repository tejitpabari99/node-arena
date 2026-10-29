import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PROTOCOL_VERSION, checkHello } from '@node-arena/net';
import { DEFAULT_CONTENT_DIR } from '../src/config.js';
import { loadServerContent, loadServerContentOrExit } from '../src/content.js';

const fixture = readFileSync(new URL('./fixtures/na-pvp-fixture.json', import.meta.url), 'utf8');

test('loads real content; lists pvp levels; compiled frozen', () => {
  const c = loadServerContent(DEFAULT_CONTENT_DIR);
  assert.ok(c.pvpLevelIds.includes('na-pvp-duel-s'));
  for (const id of c.pvpLevelIds) assert.equal(c.compiled[id]!.objective, 'pvp');
  assert.ok(!c.pvpLevelIds.includes('na-pvp-fixture'));
  assert.ok(Object.isFrozen(c.compiled)); assert.ok(Object.isFrozen(c.compiled['na-pvp-duel-s']));
  assert.throws(() => { (c.compiled['na-pvp-duel-s'] as { id: string }).id = 'x'; }, TypeError);
});

test('versions satisfy checkHello', () => {
  const c = loadServerContent(DEFAULT_CONTENT_DIR);
  const r = checkHello({ t: 'hello', pv: PROTOCOL_VERSION, versions: c.versions, nick: 'a', token: 't' }, c.versions, { playerId: 'p' });
  assert.equal(r.ok, true);
  assert.match(c.versions.content, /^\d+\.\d+\.\d+$/);
});

test('fixture injection via extraLevels', () => {
  const c = loadServerContent(DEFAULT_CONTENT_DIR, { extraLevels: { 'na-pvp-fixture': fixture } });
  assert.ok(c.pvpLevelIds.includes('na-pvp-fixture'));
  assert.ok(c.compiled['na-pvp-fixture']);
});

test('content error refuses start (exit 1)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'na-content-'));
  cpSync(DEFAULT_CONTENT_DIR, join(dir, 'data'), { recursive: true });
  cpSync(join(DEFAULT_CONTENT_DIR, '..', 'content.json'), join(dir, 'content.json'));
  assert.doesNotThrow(() => loadServerContent(join(dir, 'data')));
  writeFileSync(join(dir, 'data', 'balance.json'), '{ not json');
  assert.throws(() => loadServerContent(join(dir, 'data')));
  let code = -1; const msgs: string[] = [];
  loadServerContentOrExit(join(dir, 'data'), ((c: number) => { code = c; return undefined as never; }), (m) => msgs.push(m));
  assert.equal(code, 1); assert.match(msgs[0]!, /Content load failed/);
  // missing dir also refuses
  assert.throws(() => loadServerContent(join(dir, 'nope')));
});
