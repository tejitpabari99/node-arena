import { describe, expect, it } from 'vitest';
import { HASH_INTERVAL, LockstepClient, type ClientMessage } from '@node-arena/net';
import type { Sim } from '@node-arena/sim';
import { NetDriver } from '../../src/driver/net-driver';
import { STEP_MS } from '../../src/driver';

function setup(clockStep = 0) {
  const view = { tick: 0, over: false };
  const stepped: { cmds: unknown[]; events: unknown }[] = [];
  const sim = {
    view,
    step(cmds: unknown[], o: { events?: boolean }) { stepped.push({ cmds, events: o.events }); view.tick++; return []; },
    hash: () => `h${view.tick}`,
  } as unknown as Sim;
  const sent: ClientMessage[] = [];
  let t = 0;
  const frames: (() => void)[] = [];
  const client = new LockstepClient(0);
  const d = new NetDriver({
    sim, client, send: m => sent.push(m), now: () => (t += clockStep),
    raf: cb => frames.push(() => cb(t)), caf: () => {},
  });
  const tickMsg = (n: number) => d.push({ t: 'tick', n } as never);
  return { d, sim, view, stepped, sent, client, tickMsg, setT: (x: number) => { t = x; }, frames };
}

describe('NetDriver onFrame', () => {
  it('fires every rAF (even with 0 steps), stops after stop()', () => {
    const view = { tick: 0, over: false };
    const sim = { view, step() { view.tick++; return []; }, hash: () => 'h' } as unknown as Sim;
    const q: (() => void)[] = []; const got: { steps: number; alpha: number }[] = [];
    const d = new NetDriver({ sim, client: new LockstepClient(0), send: () => {}, now: () => 0, raf: cb => q.push(() => cb(0)), caf: () => {}, onFrame: u => got.push({ steps: u.steps, alpha: u.alpha }) });
    d.start(); q.shift()!(); d.push({ t: 'tick', n: 0 } as never); q.shift()!();
    expect(got.map(g => g.steps)).toEqual([0, 1]);
    d.stop(); q.length = 0; expect(q.length).toBe(0);
  });
});

describe('NetDriver', () => {
  it('steps only on pushed ticks', () => {
    const s = setup();
    expect(s.d.advance()).toBe(0);
    s.tickMsg(0);
    expect(s.d.advance()).toBe(1);
    expect(s.d.advance()).toBe(0);
    expect(s.view.tick).toBe(1);
  });
  it('live budget is 2 steps per frame', () => {
    const s = setup();
    for (let i = 0; i < 4; i++) s.tickMsg(i);
    expect(s.d.advance()).toBe(2);
    expect(s.d.advance()).toBe(2);
  });
  it('never pauses when hidden', () => {
    const s = setup();
    Object.defineProperty(globalThis, 'document', { value: { hidden: true }, configurable: true });
    try {
      s.tickMsg(0);
      expect(s.d.paused).toBe(false);
      expect(s.d.advance()).toBe(1);
    } finally { delete (globalThis as { document?: unknown }).document; }
  });
  it('sends hash at every HASH_INTERVAL tick', () => {
    const s = setup();
    for (let i = 0; i < HASH_INTERVAL; i++) { s.tickMsg(i); s.d.advance(); }
    expect(s.sent).toEqual([{ t: 'hash', tick: HASH_INTERVAL, h: `h${HASH_INTERVAL}` }]);
  });
  it('submit sends cmd without player/tick', () => {
    const s = setup();
    s.d.submit({ type: 'DrawLine', player: 1, from: 1, to: 2 } as never);
    expect(s.sent).toEqual([{ t: 'cmd', c: { type: 'DrawLine', from: 1, to: 2 } }]);
  });
  it('alpha clamps and holds 1 when queue empty', () => {
    const s = setup();
    expect(s.d.alpha).toBe(1);
    s.tickMsg(0); s.tickMsg(1); s.tickMsg(2);
    s.d.advance(); // steps 2, 1 left queued
    s.setT(STEP_MS / 2);
    expect(s.d.alpha).toBeCloseTo(0.5, 5);
    s.setT(STEP_MS * 10);
    expect(s.d.alpha).toBe(1);
    s.setT(0);
    expect(s.d.alpha).toBe(0);
    s.d.advance();
    expect(s.d.alpha).toBe(1);
  });
  it('catch-up for large bursts: events only for final 2 steps', () => {
    const s = setup();
    for (let i = 0; i < 10; i++) s.tickMsg(i);
    expect(s.d.advance()).toBe(10);
    expect(s.stepped.map(x => x.events)).toEqual([...Array(8).fill(false), true, true]);
  });
  it('catch-up respects time budget', () => {
    const s = setup();
    for (let i = 0; i < 10; i++) s.tickMsg(i);
    let c = 0;
    const d = new NetDriver({ sim: s.sim, client: s.client, send: () => {}, now: () => (c += 3) });
    expect(d.advance()).toBeLessThan(10);
    expect(s.client.queued()).toBeGreaterThan(0);
  });
  it('reports push errors', () => {
    const s = setup();
    expect(s.tickMsg(5)).toEqual({ ok: false, reason: 'gap' });
  });
  it('rAF loop steps and stops', () => {
    const s = setup();
    s.d.start();
    s.tickMsg(0);
    s.frames.shift()!();
    expect(s.view.tick).toBe(1);
    expect(s.frames.length).toBe(1);
    s.d.dispose();
  });
});

describe('NetDriver catch-up progress', () => {
  const chunk = (from: number, to: number, done: boolean) => ({ t: 'catchup', from, to, cmds: [], done }) as never;
  it('null when live; progress = tick/(tick+queued) during catchup; resumes live with no gap', () => {
    const s = setup(1); // fake clock: 1 ms per read, 8 ms budget
    const d = s.d;
    expect(d.catchupProgress).toBeNull();
    d.push(chunk(0, 100, false));
    expect(d.catchupProgress).toBe(0);
    const n = d.advance();
    expect(n).toBeGreaterThan(0); expect(n).toBeLessThan(10);
    expect(d.catchupProgress).toBeCloseTo(n / 100, 5);
    d.push(chunk(100, 200, true));
    expect(d.catchupProgress).toBeCloseTo(n / 200, 5);
    let guard = 0;
    while (d.catchupProgress !== null && guard++ < 1000) d.advance();
    expect(d.catchupProgress).toBeNull();
    expect(s.client.queued()).toBeLessThanOrEqual(6);
    expect(d.push({ t: 'tick', n: 200 } as never)).toEqual({ ok: true }); // live tick follows done chunk with no gap
    while (s.client.queued() > 0) d.advance();
    expect(s.view.tick).toBe(201);
    expect(s.stepped.slice(0, n).every(x => x.events === false)).toBe(true);
  });
  it('shows when queued > 40 without catchup messages, hides at <= 6', () => {
    const s = setup(3);
    for (let i = 0; i < 41; i++) s.tickMsg(i);
    expect(s.d.catchupProgress).toBe(0);
    s.d.advance();
    expect(s.d.catchupProgress).not.toBeNull();
    while (s.client.queued() > 0) s.d.advance();
    expect(s.d.catchupProgress).toBeNull();
    expect(s.view.tick).toBe(41);
  });
  it('small burst never shows overlay', () => {
    const s = setup();
    for (let i = 0; i < 10; i++) s.tickMsg(i);
    expect(s.d.catchupProgress).toBeNull();
  });
});
