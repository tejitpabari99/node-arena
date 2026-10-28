import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkHello } from '../src/handshake.js';
import type { HelloMsg, Versions } from '../src/messages.js';
import { PROTOCOL_VERSION } from '../src/version.js';

const server: Versions = { rules: '2.1.0', schema: '3', content: 'abc', bot: '5' };
const hello = (over: Partial<HelloMsg> = {}, v: Partial<Versions> = {}): HelloMsg => ({
  t: 'hello', pv: PROTOCOL_VERSION, versions: { ...server, ...v }, nick: 'Ann', token: 'f'.repeat(32), ...over,
});
const refused = (h: HelloMsg) => {
  const r = checkHello(h, server, { playerId: 'p1' });
  assert.equal(r.ok, false);
  if (r.ok) throw new Error('unreachable');
  assert.equal(r.error.t, 'error');
  assert.equal(r.error.code, 'version-mismatch');
  assert.ok(r.error.detail);
  return r.error;
};

test('ok path yields welcome with playerId and server versions', () => {
  const r = checkHello(hello(), server, { playerId: 'p1' });
  assert.deepEqual(r, { ok: true, welcome: { t: 'welcome', pv: PROTOCOL_VERSION, playerId: 'p1', serverVersions: server } });
});

test('welcome carries resume when supplied', () => {
  const r = checkHello(hello(), server, { playerId: 'p1', resume: { code: 'AB12', seat: 1 } });
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.welcome.resume, { code: 'AB12', seat: 1 });
});

test('refuses protocol mismatch', () => { refused(hello({ pv: PROTOCOL_VERSION + 1 })); });
test('refuses rules major mismatch', () => { refused(hello({}, { rules: '3.1.0' })); });
test('refuses rules minor mismatch', () => { refused(hello({}, { rules: '2.2.0' })); });
test('refuses schema mismatch', () => { refused(hello({}, { schema: '4' })); });
test('refuses content mismatch', () => { refused(hello({}, { content: 'xyz' })); });

test('refusal detail names the field and error carries server versions', () => {
  const e = refused(hello({}, { content: 'xyz' }));
  assert.match(e.detail!, /content/);
  assert.match(e.detail!, /abc/);
  const e2 = refused(hello({ pv: 9 }));
  assert.match(e2.detail!, /protocol/);
});

test('accepts patch-only rules diff', () => {
  assert.ok(checkHello(hello({}, { rules: '2.1.9' }), server, { playerId: 'p' }).ok);
});

test('accepts any bot version; onBotMismatch logged only', () => {
  const seen: string[] = [];
  const r = checkHello(hello({}, { bot: '99' }), server, { playerId: 'p', onBotMismatch: (c, s) => seen.push(`${c}/${s}`) });
  assert.ok(r.ok);
  assert.deepEqual(seen, ['99/5']);
});

test('auth ignored', () => {
  assert.ok(checkHello(hello({ auth: 'whatever' }), server, { playerId: 'p' }).ok);
});
