import { describe, expect, it } from 'vitest';
import { encode, PROTOCOL_VERSION, type ServerMessage, type Versions } from '@node-arena/net';
import { createPvpConnection, backoffDelay, type ConnState, type WebSocketLike } from '../../src/net/connection';

const versions: Versions = { rules: 'r', schema: 's', content: 'c', bot: 'b' };

class FakeSock implements WebSocketLike {
  onopen: WebSocketLike['onopen'] = null; onmessage: WebSocketLike['onmessage'] = null;
  onclose: WebSocketLike['onclose'] = null; onerror: WebSocketLike['onerror'] = null;
  sent: string[] = []; closed = false;
  send(d: string) { this.sent.push(d); }
  close() { this.closed = true; }
  open() { this.onopen?.(); }
  recv(d: unknown) { this.onmessage?.({ data: d }); }
  drop(code = 1006) { this.onclose?.({ code }); }
}

function setup(rand = () => 0.5) {
  const socks: FakeSock[] = [];
  let t = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let id = 0;
  const delays: number[] = [];
  const conn = createPvpConnection({
    url: 'ws://x', nick: 'n', token: 'tok', versions, rand, now: () => t,
    createSocket: () => { const s = new FakeSock(); socks.push(s); return s; },
    setTimeout: (fn, ms) => { delays.push(ms); timers.push({ at: t + ms, fn, id: ++id }); return id; },
    clearTimeout: (h) => { const i = timers.findIndex((x) => x.id === h); if (i >= 0) timers.splice(i, 1); },
  });
  const states: ConnState[] = [];
  conn.onState((s) => states.push(s));
  const fire = () => { timers.sort((a, b) => a.at - b.at); const x = timers.shift()!; t = x.at; x.fn(); };
  return { conn, socks, states, delays, fire, timers, last: () => socks[socks.length - 1]! };
}

describe('PvpConnection', () => {
  it('sends hello on every open', () => {
    const h = setup();
    h.last().open();
    expect(JSON.parse(h.last().sent[0]!)).toEqual({ t: 'hello', pv: PROTOCOL_VERSION, versions, nick: 'n', token: 'tok' });
    expect(h.conn.state).toBe('connected');
    h.last().drop();
    expect(h.conn.state).toBe('reconnecting');
    h.fire(); h.last().open();
    expect(h.socks).toHaveLength(2);
    expect(JSON.parse(h.last().sent[0]!).t).toBe('hello');
  });

  it('backoff schedule 0.5/1/2/4/8 capped, jitter +-20%', () => {
    const h = setup(() => 0.5);
    for (let i = 0; i < 7; i++) { h.last().drop(); if (h.conn.state === 'reconnecting') h.fire(); }
    expect(h.delays.slice(0, 7)).toEqual([500, 1000, 2000, 4000, 8000, 8000, 8000]);
    expect(backoffDelay(0, 0)).toBe(400);
    expect(backoffDelay(0, 1)).toBe(600);
    expect(backoffDelay(9, 1)).toBe(9600);
  });

  it('gives up to lost after ~60s, retry() restarts', () => {
    const h = setup();
    let guard = 0;
    while (h.conn.state !== 'lost' && guard++ < 50) { h.last().drop(); if (h.conn.state === 'reconnecting') h.fire(); }
    expect(h.conn.state).toBe('lost');
    const n = h.socks.length;
    h.conn.retry();
    expect(h.conn.state).toBe('connecting');
    expect(h.socks).toHaveLength(n + 1);
    h.last().open();
    expect(h.conn.state).toBe('connected');
  });

  it('welcome resets backoff', () => {
    const h = setup();
    h.last().drop(); h.fire(); h.last().drop(); h.fire();
    h.last().open();
    h.last().recv(encode({ t: 'welcome', pv: 1, playerId: 'p', serverVersions: versions }));
    h.last().drop();
    expect(h.delays.at(-1)).toBe(500);
  });

  it('no reconnect on close 4000 or 4003', () => {
    for (const code of [4000, 4003]) {
      const h = setup(); h.last().open(); h.last().drop(code);
      expect(h.socks).toHaveLength(1); expect(h.timers).toHaveLength(0);
      expect(h.conn.state).toBe(code === 4000 ? 'superseded' : 'refused');
    }
  });

  it('no reconnect on version-mismatch error', () => {
    const h = setup(); h.last().open();
    h.last().recv(encode({ t: 'error', code: 'version-mismatch', detail: 'x' }));
    expect(h.conn.state).toBe('refused');
    h.last();
    expect(h.timers).toHaveLength(0);
  });

  it('ignores malformed frames, delivers valid ones', () => {
    const h = setup(); h.last().open();
    const got: ServerMessage[] = [];
    h.conn.onMessage((m) => got.push(m));
    h.last().recv('not json'); h.last().recv('{"t":"nope"}'); h.last().recv(42);
    h.last().recv(encode({ t: 'pong', id: 1, tick: 0 }));
    expect(got.map((m) => m.t)).toEqual(['pong']);
    expect(h.conn.state).toBe('connected');
  });

  it('send encodes only when connected; close() does not reconnect', () => {
    const h = setup();
    expect(h.conn.send({ t: 'ping', id: 1 })).toBe(false);
    h.last().open();
    expect(h.conn.send({ t: 'ping', id: 1 })).toBe(true);
    expect(h.last().sent.at(-1)).toBe(encode({ t: 'ping', id: 1 }));
    const s = h.last();
    h.conn.close();
    s.drop();
    expect(h.socks).toHaveLength(1); expect(h.timers).toHaveLength(0);
    expect(s.closed).toBe(true);
  });
});
