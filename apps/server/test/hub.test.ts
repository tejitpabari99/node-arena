import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PROTOCOL_VERSION, type ClientMessage, type Versions } from '@node-arena/net';
import { HELLO_DEADLINE_MS, type Socket } from '../src/conn.js';
import { createHub, playerIdFor, type HubHandler } from '../src/hub.js';
import { createLogger } from '../src/log.js';

const versions: Versions = { rules: '2.1.0', schema: '1', content: 'abc', bot: '1' };
const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

function fakeSocket() {
  let msgCb: (d: string | Uint8Array) => void = () => {};
  let closeCb: () => void = () => {};
  const sent: string[] = [];
  const s = {
    sent,
    closed: undefined as undefined | { code?: number | undefined },
    bufferedAmount: 0,
    send: (d: string) => void sent.push(d),
    close(code?: number) { s.closed = { code }; closeCb(); },
    onMessage: (cb: (d: string | Uint8Array) => void) => void (msgCb = cb),
    onClose: (cb: () => void) => void (closeCb = cb),
    recv: (d: string | Uint8Array) => msgCb(d),
    drop: () => closeCb(),
    msgs: () => sent.map((x) => JSON.parse(x) as { t: string; code?: string; playerId?: string }),
  };
  return s satisfies Socket & Record<string, unknown>;
}

function setup(handler?: HubHandler) {
  const timers: Array<{ fn: () => void; ms: number; live: boolean }> = [];
  const lines: string[] = [];
  const log = createLogger({ level: 'debug', write: (l) => lines.push(l), now: () => 0 });
  const hub = createHub({
    versions, log, secret: 'sekrit', ...(handler ? { handler } : {}),
    timers: {
      setTimeout: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t; },
      clearTimeout: (h) => { (h as { live: boolean }).live = false; },
    },
  });
  return { hub, timers, lines };
}

const hello = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({ t: 'hello', pv: PROTOCOL_VERSION, versions, nick: 'Ann', token: TOKEN, ...over });

test('hello ok -> welcome with HMAC playerId, no token', () => {
  const { hub } = setup();
  const s = fakeSocket();
  hub.accept(s);
  s.recv(hello());
  const [w] = s.msgs();
  assert.equal(w!.t, 'welcome');
  assert.equal(w!.playerId, playerIdFor('sekrit', TOKEN));
  assert.equal(s.closed, undefined);
});

test('version mismatch refused + closed', () => {
  const { hub } = setup();
  const s = fakeSocket();
  hub.accept(s);
  s.recv(hello({ versions: { ...versions, content: 'zzz' } }));
  assert.equal(s.msgs()[0]!.code, 'version-mismatch');
  assert.ok(s.closed);
  assert.equal(hub.connCount(), 0);
});

test('hello deadline closes silent conn; cleared on hello', () => {
  const { hub, timers } = setup();
  const a = fakeSocket();
  hub.accept(a);
  assert.equal(timers[0]!.ms, HELLO_DEADLINE_MS);
  timers[0]!.fn();
  assert.ok(a.closed);
  const b = fakeSocket();
  hub.accept(b);
  b.recv(hello());
  assert.equal(timers[1]!.live, false);
});

test('pre-hello non-hello / bad json / oversize rejected, no crash', () => {
  const { hub } = setup();
  for (const raw of [JSON.stringify({ t: 'ping', id: 1 }), '{nope', 'x'.repeat(5000), new Uint8Array([0xff, 0xfe])]) {
    const s = fakeSocket();
    hub.accept(s);
    s.recv(raw);
    assert.equal(s.msgs()[0]!.t, 'error');
    assert.ok(s.closed);
  }
});

test('post-hello: bad json errors without closing; routed to handler; second hello rejected', () => {
  const got: ClientMessage[] = [];
  const { hub } = setup({ onClientMessage: (_c, m) => void got.push(m) });
  const s = fakeSocket();
  hub.accept(s);
  s.recv(hello());
  s.recv('{nope');
  s.recv(JSON.stringify({ t: 'ping', id: 7 }));
  s.recv(hello());
  assert.deepEqual(got, [{ t: 'ping', id: 7 }]);
  assert.equal(s.msgs()[1]!.code, 'bad-json');
  assert.equal(s.msgs()[2]!.code, 'bad-message');
  assert.equal(s.closed, undefined);
});

test('default stub replies error for unsupported', () => {
  const { hub } = setup();
  const s = fakeSocket();
  hub.accept(s);
  s.recv(hello());
  s.recv(JSON.stringify({ t: 'room.create' }));
  assert.equal(s.msgs()[1]!.t, 'error');
});

test('same token supersedes old conn (close 4000); old close does not evict new', () => {
  const events: string[] = [];
  const { hub } = setup({ onClientMessage: () => {}, onDisconnect: (_c, r) => void events.push(r) });
  const a = fakeSocket();
  const b = fakeSocket();
  hub.accept(a);
  a.recv(hello());
  hub.accept(b);
  b.recv(hello());
  assert.equal(a.closed?.code, 4000);
  assert.equal(b.closed, undefined);
  assert.equal(hub.connCount(), 1);
  assert.deepEqual(events, ['superseded']);
  a.drop();
  assert.equal(hub.connByPlayer(playerIdFor('sekrit', TOKEN)) !== undefined, true);
  b.drop();
  assert.equal(hub.connByPlayer(playerIdFor('sekrit', TOKEN)), undefined);
  assert.deepEqual(events, ['superseded', 'closed']);
});

test('token never in logs or sent frames', () => {
  const { hub, lines } = setup();
  const a = fakeSocket();
  const b = fakeSocket();
  const c = fakeSocket();
  hub.accept(a); a.recv(hello());
  hub.accept(b); b.recv(hello());
  hub.accept(c); c.recv(hello({ versions: { ...versions, rules: '9.0.0' } }));
  a.recv('garbage'); b.drop();
  assert.ok(lines.length > 0);
  for (const l of lines) assert.ok(!l.includes(TOKEN), l);
  for (const s of [a, b, c]) for (const f of s.sent) assert.ok(!f.includes(TOKEN), f);
});

test('maxConns rejects extra', () => {
  const hub = createHub({ versions, maxConns: 1, secret: 'x' });
  const a = fakeSocket(); const b = fakeSocket();
  hub.accept(a); hub.accept(b);
  assert.equal(b.closed?.code, 1013);
  assert.equal(hub.connCount(), 1);
  hub.accept(fakeSocket());
});
