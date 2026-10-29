import { describe, expect, it } from 'vitest';
import { createIdentity, PVP_KEY, PVP_TOKEN_KEY, type KV } from '../../src/net/identity';
import { parseRoomLink, shareLinks, stripRoomParams } from '../../src/net/links';
import { resolveServerUrl } from '../../src/net/server-url';
import { SAVE_KEY } from '../../src/save';

class Mem implements KV {
  m = new Map<string, string>(); writes: string[] = [];
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.writes.push(k); this.m.set(k, v); }
}
const blocked: KV = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
let n = 0;
const rnd = (len: number) => new Uint8Array(len).fill(++n);

describe('parseRoomLink', () => {
  it.each([
    ['?room=abcd', { code: 'ABCD', role: 'play' }],
    ['?room=AbC1&watch', { code: 'ABC1', role: 'watch' }],
    ['?room=ABCD&watch=1', { code: 'ABCD', role: 'watch' }],
    ['?watch&room=wxyz', { code: 'WXYZ', role: 'watch' }],
    ['?room=abc', null], ['?room=abcde', null], ['?room=ab-d', null], ['?room=', null], ['', null], ['?watch', null],
  ])('%s', (s, want) => { expect(parseRoomLink(s)).toEqual(want); });
  it('shareLinks', () => {
    expect(shareLinks('https://x.io', '/play/', 'abcd')).toEqual({ play: 'https://x.io/play/?room=ABCD', watch: 'https://x.io/play/?room=ABCD&watch' });
    expect(parseRoomLink(new URL(shareLinks('https://x.io', '/', 'Q1w2').watch).search)).toEqual({ code: 'Q1W2', role: 'watch' });
  });
});

describe('identity', () => {
  it('persists nick, token per tab, reload keeps token', () => {
    const local = new Mem(), s1 = new Mem(), s2 = new Mem();
    const a = createIdentity({ local, session: s1, randomBytes: rnd });
    expect(a.token).toMatch(/^[0-9a-f]{32}$/);
    a.setNick('Zed');
    const reload = createIdentity({ local, session: s1, randomBytes: rnd });
    expect(reload.token).toBe(a.token); expect(reload.nick).toBe('Zed');
    expect(JSON.parse(local.m.get(PVP_KEY)!)).toEqual({ v: 1, nick: 'Zed' });
    expect(s1.m.get(PVP_TOKEN_KEY)).toBe(a.token);
    const otherTab = createIdentity({ local, session: s2, randomBytes: rnd });
    expect(otherTab.token).not.toBe(a.token); expect(otherTab.nick).toBe('Zed');
  });
  it('nick limited to 20 chars', () => {
    expect(createIdentity({ local: new Mem(), session: new Mem(), randomBytes: rnd }).setNick('x'.repeat(30))).toHaveLength(20);
  });
  it('blocked storage falls back to memory', () => {
    const id = createIdentity({ local: blocked, session: blocked, randomBytes: rnd });
    expect(id.token).toMatch(/^[0-9a-f]{32}$/);
    expect(id.setNick('Bob')).toBe('Bob'); expect(id.nick).toBe('Bob'); expect(id.token).toBe(id.token);
    const none = createIdentity({ local: null, session: null, randomBytes: rnd });
    expect(none.token).toHaveLength(32);
  });
  it('invalid blob regenerates token, keeps string nick', () => {
    const local = new Mem(), session = new Mem();
    session.setItem(PVP_TOKEN_KEY, 'a'.repeat(32));
    local.setItem(PVP_KEY, JSON.stringify({ v: 9, nick: 'Keep' }));
    const id = createIdentity({ local, session, randomBytes: rnd });
    expect(id.nick).toBe('Keep'); expect(id.token).not.toBe('a'.repeat(32));
    const bad = new Mem(); bad.setItem(PVP_KEY, '{nope');
    expect(createIdentity({ local: bad, session: new Mem(), randomBytes: rnd }).nick).toBe('');
  });
  it('never touches nodearena:save', () => {
    const local = new Mem(), session = new Mem();
    local.setItem(SAVE_KEY, '{"keep":"bytes"}'); local.writes.length = 0;
    const id = createIdentity({ local, session, randomBytes: rnd }); id.setNick('A');
    expect(local.m.get(SAVE_KEY)).toBe('{"keep":"bytes"}');
    expect([...local.writes, ...session.writes].filter((k) => k === SAVE_KEY)).toEqual([]);
  });
});

describe('resolveServerUrl', () => {
  it.each([
    [{ dev: true }, 'ws://127.0.0.1:8080'],
    [{ dev: true, envUrl: 'wss://a.io' }, 'wss://a.io'],
    [{ envUrl: 'wss://a.io' }, 'wss://a.io'],
    [{}, null], [{ envUrl: '' }, null], [{ envUrl: 'http://a.io' }, null],
    [{ dev: true, search: '?server=ws://h:1', envUrl: 'wss://a.io' }, 'ws://h:1'],
    [{ testHooks: true, search: '?server=wss://t.io' }, 'wss://t.io'],
    [{ search: '?server=wss://t.io' }, null],
    [{ envUrl: 'wss://a.io', search: '?server=wss://t.io' }, 'wss://a.io'],
    [{ dev: true, search: '?server=http://bad' }, 'ws://127.0.0.1:8080'],
    [{ testHooks: true, search: '?server=javascript:1' }, null],
  ])('%j', (env, want) => { expect(resolveServerUrl(env)).toBe(want); });
});

describe('stripRoomParams', () => {
  it('removes room/watch, keeps others', () => {
    expect(stripRoomParams('?room=ABCD&watch')).toBe('');
    expect(stripRoomParams('?server=ws%3A%2F%2Fx&room=ABCD&watch=1&nick=Z')).toBe('?server=ws%3A%2F%2Fx&nick=Z');
    expect(stripRoomParams('')).toBe('');
  });
});
