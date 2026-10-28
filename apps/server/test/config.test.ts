import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigError, loadConfigOrExit, parseConfig } from '../src/config.js';
import { createLogger } from '../src/log.js';

test('config defaults', () => {
  const c = parseConfig({});
  assert.equal(c.port, 8080); assert.equal(c.host, '0.0.0.0'); assert.equal(c.inputDelay, 3);
  assert.equal(c.maxRooms, 40); assert.equal(c.maxConns, 200); assert.equal(c.logLevel, 'info');
  assert.equal(c.allowNoOrigin, false); assert.deepEqual(c.allowedOrigins, []);
  assert.match(c.contentDir, /packages\/content\/data$/);
});

test('config parses values', () => {
  const c = parseConfig({ PORT: '9000', INPUT_DELAY: '10', ALLOWED_ORIGINS: 'https://a.web.app, https://b--*.web.app', ALLOW_NO_ORIGIN: '1', LOG_LEVEL: 'debug', CONTENT_DIR: '/x' });
  assert.equal(c.port, 9000); assert.equal(c.inputDelay, 10); assert.equal(c.allowNoOrigin, true);
  assert.deepEqual(c.allowedOrigins, ['https://a.web.app', 'https://b--*.web.app']); assert.equal(c.contentDir, '/x');
});

test('config rejects bad env, listing all errors', () => {
  for (const env of [{ INPUT_DELAY: '0' }, { INPUT_DELAY: '11' }, { PORT: 'abc' }, { PORT: '70000' }, { MAX_ROOMS: '0' }, { MAX_CONNS: '-1' }, { LOG_LEVEL: 'loud' }, { ALLOW_NO_ORIGIN: 'maybe' }, { ALLOWED_ORIGINS: 'not-an-origin' }]) {
    assert.throws(() => parseConfig(env), ConfigError, JSON.stringify(env));
  }
  try { parseConfig({ PORT: 'x', INPUT_DELAY: '99' }); assert.fail(); } catch (e) { assert.equal((e as ConfigError).errors.length, 2); }
});

test('loadConfigOrExit exits 1 on bad value', () => {
  let code = -1; const msgs: string[] = [];
  const exit = ((c: number) => { code = c; return undefined as never; });
  loadConfigOrExit({ INPUT_DELAY: '0' }, exit, (m) => msgs.push(m));
  assert.equal(code, 1); assert.match(msgs[0]!, /INPUT_DELAY/);
});

test('logger writes JSON lines, filters level, drops tokens/IPs', () => {
  const lines: string[] = [];
  const log = createLogger({ level: 'info', write: (l) => lines.push(l), now: () => 0 });
  log.debug('hidden');
  log.info('room.created', { room: 'ABCD', matchId: 'm1', token: 'secret', ip: '1.2.3.4', ev: 'spoof' });
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]!), { ts: '1970-01-01T00:00:00.000Z', level: 'info', ev: 'room.created', room: 'ABCD', matchId: 'm1' });
});
