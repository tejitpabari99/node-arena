import { describe, expect, it } from 'vitest';
import type { Versions } from '@node-arena/net';
import { createIdentity, PVP_KEY, type KV } from '../../src/net/identity';
import { createPvpController } from '../../src/pvp/controller';

describe('nickname draft', () => {
  class Mem implements KV { m = new Map<string, string>(); writes: string[] = []; getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.writes.push(v); this.m.set(k, v); } }
  const versions: Versions = { rules: 'r', schema: 's', content: 'c', bot: 'b' };
  it('keeps "a b" in the draft, persists sanitized per keystroke', () => {
    const local = new Mem();
    const ctl = createPvpController({ identity: createIdentity({ local, session: null }), serverUrl: 'ws://x', versions, createSocket: () => { throw new Error('no'); } });
    ctl.open();
    for (const v of ['a', 'a ', 'a b']) { ctl.setNick(v); expect(ctl.snapshot().nickDraft).toBe(v); }
    expect(ctl.snapshot().nick).toBe('a b');
    expect(local.writes.map((w) => JSON.parse(w).nick)).toEqual(['a', 'a', 'a b']);
    expect(JSON.parse(local.m.get(PVP_KEY)!)).toEqual({ v: 1, nick: 'a b' });
    ctl.setNick('  '); expect(ctl.snapshot()).toMatchObject({ nick: '', nickDraft: '  ' });
    ctl.setNick('x'.repeat(30)); expect(ctl.snapshot().nickDraft).toHaveLength(20);
  });
});
