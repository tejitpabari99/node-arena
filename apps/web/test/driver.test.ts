import { describe, expect, it } from 'vitest';
import metadata from '../../../packages/content/content.json';
import { loadContent, type CompiledLevel } from '@node-arena/content';
import { create, createReplayRecorder, playReplay, type Command } from '@node-arena/sim';
import { GameDriver, createBotDriver, type DriverEnvironment, type TickUpdate } from '../src/driver';

const raw = import.meta.glob<string>([
  '../../../packages/content/data/**/*.json',
], { eager: true, query: '?raw', import: 'default' });
const files = Object.fromEntries(Object.entries(raw).map(([path, value]) => [path.replace('../../../packages/content/', ''), value]));
const loaded = loadContent(files);
const level = loaded.compiled[loaded.catalog.campaigns.common!.entries[0]!.level]!;
const own = level.buildings.findIndex(b => b.owner === 0);
const target = level.buildings.findIndex((b,i) => i !== own && create(level,42).canDraw(0,own,i) === null);
const draw: Command = { type: 'DrawLine', player: 0, from: own, to: target };
const cut: Command = { type: 'CutLine', player: 0, from: own, to: target };
const botFrom = level.buildings.findIndex(b => b.owner === 1);
const botTo = level.buildings.findIndex((_,i) => i !== botFrom && create(level,42).canDraw(1,botFrom,i) === null);
const botDraw: Command = {type:'DrawLine',player:1,from:botFrom,to:botTo};

class Environment implements DriverEnvironment {
  hidden = false;
  nextId = 0;
  frames = new Map<number, (timestamp: number) => void>();
  listeners = new Set<() => void>();
  requestFrame = (callback: (timestamp: number) => void): number => {
    const id = ++this.nextId; this.frames.set(id, callback); return id;
  };
  cancelFrame = (id: number): void => { this.frames.delete(id); };
  isHidden = (): boolean => this.hidden;
  onVisibilityChange = (callback: () => void): (() => void) => {
    this.listeners.add(callback); return () => { this.listeners.delete(callback); };
  };
  frame(timestamp: number): void {
    const callbacks = [...this.frames.values()]; this.frames.clear();
    callbacks.forEach(callback => callback(timestamp));
  }
  visibility(hidden: boolean): void { this.hidden = hidden; this.listeners.forEach(listener => listener()); }
}
const driver = (options: Partial<ConstructorParameters<typeof GameDriver>[0]> = {}) => new GameDriver({ level, matchSeed: 42, autoStart: false, ...options });

describe('fixed-step GameDriver', () => {
  it('accumulates 20Hz ticks and exposes fractional render alpha', () => {
    const frames: number[] = [];
    const game = driver({ onFrame: frame => frames.push(frame.alpha) });
    game.advanceFrame(0); game.advanceFrame(24);
    expect(game.sim.view.tick).toBe(0); expect(game.alpha).toBeCloseTo(0.48);
    game.advanceFrame(74);
    expect(game.sim.view.tick).toBe(1); expect(game.alpha).toBeCloseTo(0.48);
    expect(frames).toEqual([0, 0.48, 0.48]);
  });

  it('clamps long frames to 250ms', () => {
    const game = driver(); game.advanceFrame(0); game.advanceFrame(10_000);
    expect(game.sim.view.tick).toBe(5); expect(game.alpha).toBe(0);
    game.advanceFrame(10_050); expect(game.sim.view.tick).toBe(6);
  });

  it('runs at 2x but caps five ticks and drops spilled whole ticks', () => {
    const game = driver(); game.setSpeed(2); game.advanceFrame(0); game.advanceFrame(25);
    expect(game.sim.view.tick).toBe(1);
    game.advanceFrame(275); expect(game.sim.view.tick).toBe(6); expect(game.alpha).toBe(0);
    game.advanceFrame(300); expect(game.sim.view.tick).toBe(7);
    game.setSpeed(1); game.advanceFrame(325); expect(game.sim.view.tick).toBe(7);
    expect(game.alpha).toBe(0.5);
  });

  it('copies and stamps queued submissions and consumes each exactly once', () => {
    const ticks: TickUpdate[] = [];
    const game = driver({ onTick: tick => ticks.push(tick) });
    const mutable = { ...draw };
    expect(game.submit(mutable)).toEqual({ tick: 0, cmd: draw });
    game.submit(cut); mutable.to = own;
    game.advanceFrame(0); game.advanceFrame(100);
    expect(ticks[0]?.submissions).toEqual([{ tick: 0, cmd: draw }, { tick: 0, cmd: cut }]);
    expect(ticks[0]?.events.map(event => event.type)).toEqual(['LineDrawn', 'LineCut']);
    expect(ticks[1]?.submissions).toEqual([]);
    expect(game.sim.view.lines).toHaveLength(0);
  });

  it('pause blocks ticks/input, clears stale commands/alpha and resumes without catchup', () => {
    const game = driver(); game.advanceFrame(0); game.advanceFrame(25); game.submit(draw);
    game.pause(); expect(game.alpha).toBe(0); expect(game.submit(draw)).toBeNull();
    expect(game.step(10)).toBe(0); game.advanceFrame(100_000); expect(game.sim.view.tick).toBe(0);
    game.resume(); game.advanceFrame(200_000); game.advanceFrame(200_050);
    expect(game.sim.view.tick).toBe(1); expect(game.sim.view.lines).toHaveLength(0);
  });

  it('hidden tab auto-pauses, shows a pause reason, and requires explicit visible resume', () => {
    const env = new Environment(); const reasons: (string | null)[] = [];
    const game = driver({ environment: env, onPauseChange: reason => reasons.push(reason) });
    game.advanceFrame(0); game.submit(draw); env.visibility(true);
    expect(game.pauseReason).toBe('hidden'); expect(game.paused).toBe(true);
    game.resume(); expect(game.paused).toBe(true);
    game.advanceFrame(1_000_000); env.visibility(false); expect(game.paused).toBe(true);
    game.resume(); game.advanceFrame(2_000_000); game.advanceFrame(2_000_050);
    expect(game.sim.view.tick).toBe(1); expect(game.sim.view.lines).toHaveLength(0);
    expect(reasons).toEqual(['hidden', null]);
  });

  it('starts hidden safely and never manually steps while hidden', () => {
    const env = new Environment(); env.hidden = true;
    const game = driver({ environment: env });
    expect(game.paused).toBe(true); expect(game.submit(draw)).toBeNull(); expect(game.step(1)).toBe(0);
  });

  it('creates bots with exact level/seed and merges their commands before each step', () => {
    const calls: [CompiledLevel, number][] = []; const observed: number[] = [];
    const ticks: TickUpdate[] = [];
    const game = driver({ createBotDriver: (compiled, seed) => {
      calls.push([compiled, seed]);
      return { commands: sim => { observed.push(sim.view.tick); return sim.view.tick === 0 ? [botDraw] : []; } };
    }, onTick: tick => ticks.push(tick) });
    game.submit(draw); game.step(2);
    expect(calls).toEqual([[level, 42]]); expect(calls[0]?.[0]).toBe(level);
    expect(observed).toEqual([0, 1]);
    expect(ticks[0]?.submissions).toEqual([{ tick: 0, cmd: draw }, { tick: 0, cmd: botDraw }]);
    expect(game.sim.view.lines).toHaveLength(2);
    expect(Array.isArray(createBotDriver(level, 42).commands(game.sim))).toBe(true);
  });

  it('resume is idempotent and does not discard active input or interpolation', () => {
    const game = driver(); game.advanceFrame(0); game.advanceFrame(25);
    game.submit(draw); game.resume();
    expect(game.alpha).toBe(0.5); game.advanceFrame(50);
    expect(game.sim.view.tick).toBe(1); expect(game.sim.view.lines).toHaveLength(1);
  });

  it('restart resets sim, seed, bot and all timing/queued state', () => {
    const seeds: number[] = [];
    const game = driver({ createBotDriver: (_, seed) => { seeds.push(seed); return { commands: () => [] }; } });
    game.step(3); game.submit(draw); game.advanceFrame(0); game.advanceFrame(25); game.pause();
    game.restart(level, 99);
    expect(game.sim.hash()).toBe(create(level, 99).hash()); expect(game.paused).toBe(false);
    expect(game.alpha).toBe(0); expect(seeds).toEqual([42, 99]);
    game.advanceFrame(10_000); expect(game.sim.view.tick).toBe(0);
    game.step(1); expect(game.sim.view.lines).toHaveLength(0);
  });

  it('stops immediately at GameOver and exposes its events to tick subscribers', () => {
    const short = { ...level, timeLimitSec: 1, rules: { ...level.rules, timeLimitSec: 1 } };
    const ticks: TickUpdate[] = [];
    const game = driver({ level: short, onTick: tick => ticks.push(tick) });
    expect(game.step(100)).toBe(20); expect(game.sim.view.over).not.toBeNull();
    expect(ticks.at(-1)?.events.some(event => event.type === 'MatchOver')).toBe(true);
    expect(game.submit(draw)).toBeNull(); game.advanceFrame(0); game.advanceFrame(250);
    expect(game.sim.view.tick).toBe(20); expect(game.alpha).toBe(0);
  });

  it('owns rAF lifecycle and removes visibility listeners on disposal', () => {
    const env = new Environment(); const game = driver({ environment: env, autoStart: true });
    expect(env.frames.size).toBe(1); game.start(); expect(env.frames.size).toBe(1);
    env.frame(0); env.frame(50); expect(game.sim.view.tick).toBe(1);
    game.stop(); expect(env.frames.size).toBe(0);
    game.start(); env.frame(10_000); expect(game.sim.view.tick).toBe(1);
    game.dispose(); expect(env.frames.size).toBe(0); expect(env.listeners.size).toBe(0);
    game.start(); expect(env.frames.size).toBe(0); expect(game.step(1)).toBe(0);
    expect(game.submit(draw)).toBeNull(); game.advanceFrame(20_000); expect(game.sim.view.tick).toBe(1);
  });

  it('manual stepping resets rAF baseline and refuses invalid tick counts', () => {
    const game = driver(); game.advanceFrame(0); game.advanceFrame(25); game.step(2);
    game.advanceFrame(10_000); expect(game.sim.view.tick).toBe(2); expect(game.alpha).toBe(0);
    expect(() => game.step(-1)).toThrow(); expect(() => game.step(1.5)).toThrow();
    expect(() => game.step(Infinity)).toThrow();
  });

  it('different frame splits produce the same hash as direct fixed ticks', () => {
    const make = () => driver({ createSim:(compiled,seed)=>createReplayRecorder(compiled,seed,metadata),createBotDriver: () => ({ commands: () => [] }) });
    const split = make(), batch = make(); split.submit(draw); batch.submit(draw);
    split.advanceFrame(0); batch.advanceFrame(0);
    for(let time=10;time<=1000;time+=10)split.advanceFrame(time);
    for(let time=250;time<=1000;time+=250)batch.advanceFrame(time);
    const direct=create(level,42);direct.step([draw]);for(let tick=1;tick<20;tick++)direct.step([]);
    expect(split.sim.view.tick).toBe(20);expect(split.sim.hash()).toBe(batch.sim.hash());expect(split.sim.hash()).toBe(direct.hash());
    const record=(split.sim as ReturnType<typeof createReplayRecorder>).record();
    expect(record.commands).toEqual([{tick:0,cmd:draw}]);const replay=playReplay({metadata,level},record);expect(replay.ok).toBe(true);expect(replay.sim.hash()).toBe(split.sim.hash());
  });
});
