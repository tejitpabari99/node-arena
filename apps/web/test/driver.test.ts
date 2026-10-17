import { describe, expect, it } from 'vitest';
import { compileLevel, loadContent, type CompiledLevel } from '@node-arena/content';
import { create, createReplayRecorder, playReplay, type Command } from '@node-arena/sim';
import { GameDriver, createBotDriver, type DriverEnvironment, type TickUpdate } from '../src/driver';

const raw = import.meta.glob<string>([
  '../../../packages/content/content.json', '../../../packages/content/data/**/*.json',
], { eager: true, query: '?raw', import: 'default' });
const files = Object.fromEntries(Object.entries(raw).map(([path, value]) => [path.replace('../../../packages/content/', ''), value]));
const loaded = loadContent(files);
const level = compileLevel(loaded, 'sample');

// Compile a utility opponent through the public loader without changing authored levels.
const utilityFiles = { ...files };
utilityFiles['data/examples/sample-bot.json'] = JSON.stringify({
  $schema: '../../schemas/bot.schema.json', schemaVersion: '1.0.0', id: 'sample-bot', kind: 'utility',
  params: { skill: { decisionIntervalSec: 0.175, noise: 0, actionsPerDecision: 1 },
    bias: { attack: 1, reinforce: 1, cut: 0 }, weights: { attack: { distance: 1 } } },
});
const utilityRawLevel = JSON.parse(files['data/levels/sample.json']!);
utilityRawLevel.towers[1].garrison = 40;
utilityRawLevel.towers[2].garrison = 0;
utilityFiles['data/levels/sample.json'] = JSON.stringify(utilityRawLevel);
const utilityLevel = compileLevel(loadContent(utilityFiles), 'sample');

const draw: Command = { type: 'DrawLine', player: 'p1', from: 't1', to: 't3' };
const cut: Command = { type: 'CutLine', player: 'p1', from: 't1', to: 't3' };
const botDraw: Command = { type: 'DrawLine', player: 'b1', from: 't2', to: 't3' };

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
    expect(game.sim.tick).toBe(0); expect(game.alpha).toBeCloseTo(0.48);
    game.advanceFrame(74);
    expect(game.sim.tick).toBe(1); expect(game.alpha).toBeCloseTo(0.48);
    expect(frames).toEqual([0, 0.48, 0.48]);
  });

  it('clamps long frames to 250ms', () => {
    const game = driver(); game.advanceFrame(0); game.advanceFrame(10_000);
    expect(game.sim.tick).toBe(5); expect(game.alpha).toBe(0);
    game.advanceFrame(10_050); expect(game.sim.tick).toBe(6);
  });

  it('runs at 2x but caps five ticks and drops spilled whole ticks', () => {
    const game = driver(); game.setSpeed(2); game.advanceFrame(0); game.advanceFrame(25);
    expect(game.sim.tick).toBe(1);
    game.advanceFrame(275); expect(game.sim.tick).toBe(6); expect(game.alpha).toBe(0);
    game.advanceFrame(300); expect(game.sim.tick).toBe(7);
    game.setSpeed(1); game.advanceFrame(325); expect(game.sim.tick).toBe(7);
    expect(game.alpha).toBe(0.5);
  });

  it('copies and stamps queued submissions and consumes each exactly once', () => {
    const ticks: TickUpdate[] = [];
    const game = driver({ onTick: tick => ticks.push(tick) });
    const mutable = { ...draw };
    expect(game.submit(mutable)).toEqual({ tick: 0, cmd: draw });
    game.submit(cut); mutable.to = 't2';
    game.advanceFrame(0); game.advanceFrame(100);
    expect(ticks[0]?.submissions).toEqual([{ tick: 0, cmd: draw }, { tick: 0, cmd: cut }]);
    expect(ticks[0]?.events.map(event => event.type)).toEqual(['LineDrawn', 'LineCut']);
    expect(ticks[1]?.submissions).toEqual([]);
    expect(game.sim.view.lines).toHaveLength(0);
  });

  it('pause blocks ticks/input, clears stale commands/alpha and resumes without catchup', () => {
    const game = driver(); game.advanceFrame(0); game.advanceFrame(25); game.submit(draw);
    game.pause(); expect(game.alpha).toBe(0); expect(game.submit(draw)).toBeNull();
    expect(game.step(10)).toBe(0); game.advanceFrame(100_000); expect(game.sim.tick).toBe(0);
    game.resume(); game.advanceFrame(200_000); game.advanceFrame(200_050);
    expect(game.sim.tick).toBe(1); expect(game.sim.view.lines).toHaveLength(0);
  });

  it('hidden tab auto-pauses, shows a pause reason, and requires explicit visible resume', () => {
    const env = new Environment(); const reasons: (string | null)[] = [];
    const game = driver({ environment: env, onPauseChange: reason => reasons.push(reason) });
    game.advanceFrame(0); game.submit(draw); env.visibility(true);
    expect(game.pauseReason).toBe('hidden'); expect(game.paused).toBe(true);
    game.resume(); expect(game.paused).toBe(true);
    game.advanceFrame(1_000_000); env.visibility(false); expect(game.paused).toBe(true);
    game.resume(); game.advanceFrame(2_000_000); game.advanceFrame(2_000_050);
    expect(game.sim.tick).toBe(1); expect(game.sim.view.lines).toHaveLength(0);
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
      return { commands: sim => { observed.push(sim.tick); return sim.tick === 0 ? [botDraw] : []; } };
    }, onTick: tick => ticks.push(tick) });
    game.submit(draw); game.step(2);
    expect(calls).toEqual([[level, 42]]); expect(calls[0]?.[0]).toBe(level);
    expect(observed).toEqual([0, 1]);
    expect(ticks[0]?.submissions).toEqual([{ tick: 0, cmd: draw }, { tick: 0, cmd: botDraw }]);
    expect(game.sim.view.lines).toHaveLength(2);
    expect(createBotDriver(level, 42).commands(game.sim)).toEqual([]);
  });

  it('default utility bots capture legally and record reproducible commands across pause and 2x frames', () => {
    const metadata = { rulesVersion: '1.0.0', schemaVersion: '1.0.0', contentVersion: '1.0.0' } as const;
    const make = () => {
      const updates: TickUpdate[] = [];
      const game = driver({ level: utilityLevel,
        createSim: (compiled, seed) => createReplayRecorder(compiled, seed, metadata),
        onTick: update => updates.push(update),
      });
      return { game, updates };
    };
    const direct = make(); const fast = make();
    direct.game.step(400);
    fast.game.setSpeed(2); fast.game.advanceFrame(0);
    fast.game.advanceFrame(25);
    const pausedHash = fast.game.sim.hash();
    fast.game.pause(); fast.game.advanceFrame(10_000);
    expect(fast.game.step(5)).toBe(0);
    expect(fast.game.sim.hash()).toBe(pausedHash);
    fast.game.resume(); fast.game.advanceFrame(20_000);
    for (let tick = 1; tick < direct.game.sim.tick; tick++) fast.game.advanceFrame(20_000 + tick * 25);

    const submissions = direct.updates.flatMap(update => update.submissions);
    expect(submissions.length).toBeGreaterThan(0);
    expect(submissions[0]?.cmd).toEqual(botDraw);
    expect(submissions.every(({ tick, cmd }) => cmd.player === 'b1' && tick % 3 === submissions[0]!.tick % 3)).toBe(true);
    expect(direct.updates.flatMap(update => update.events).some(event => event.type === 'Captured')).toBe(true);
    expect(direct.game.sim.rejected).toBe(0);
    expect(fast.game.sim.rejected).toBe(0);
    expect(fast.game.sim.tick).toBe(direct.game.sim.tick);
    expect(fast.game.sim.hash()).toBe(direct.game.sim.hash());
    expect(fast.updates.flatMap(update => update.submissions)).toEqual(submissions);

    const record = (direct.game.sim as ReturnType<typeof createReplayRecorder>).record();
    expect(record.commands).toEqual(submissions);
    const replay = playReplay({ metadata, level: utilityLevel }, record);
    expect(replay.ok).toBe(true);
    expect(replay.sim.hash()).toBe(direct.game.sim.hash());
  });

  it('resume is idempotent and does not discard active input or interpolation', () => {
    const game = driver(); game.advanceFrame(0); game.advanceFrame(25);
    game.submit(draw); game.resume();
    expect(game.alpha).toBe(0.5); game.advanceFrame(50);
    expect(game.sim.tick).toBe(1); expect(game.sim.view.lines).toHaveLength(1);
  });

  it('restart resets sim, seed, bot and all timing/queued state', () => {
    const seeds: number[] = [];
    const game = driver({ createBotDriver: (_, seed) => { seeds.push(seed); return { commands: () => [] }; } });
    game.step(3); game.submit(draw); game.advanceFrame(0); game.advanceFrame(25); game.pause();
    game.restart(level, 99);
    expect(game.sim.hash()).toBe(create(level, 99).hash()); expect(game.paused).toBe(false);
    expect(game.alpha).toBe(0); expect(seeds).toEqual([42, 99]);
    game.advanceFrame(10_000); expect(game.sim.tick).toBe(0);
    game.step(1); expect(game.sim.view.lines).toHaveLength(0);
  });

  it('stops immediately at GameOver and exposes its events to tick subscribers', () => {
    const short = { ...level, timeLimitSec: 1 };
    const ticks: TickUpdate[] = [];
    const game = driver({ level: short, onTick: tick => ticks.push(tick) });
    expect(game.step(100)).toBe(20); expect(game.sim.view.over).not.toBeNull();
    expect(ticks.at(-1)?.events.some(event => event.type === 'GameOver')).toBe(true);
    expect(game.submit(draw)).toBeNull(); game.advanceFrame(0); game.advanceFrame(250);
    expect(game.sim.tick).toBe(20); expect(game.alpha).toBe(0);
  });

  it('owns rAF lifecycle and removes visibility listeners on disposal', () => {
    const env = new Environment(); const game = driver({ environment: env, autoStart: true });
    expect(env.frames.size).toBe(1); game.start(); expect(env.frames.size).toBe(1);
    env.frame(0); env.frame(50); expect(game.sim.tick).toBe(1);
    game.stop(); expect(env.frames.size).toBe(0);
    game.start(); env.frame(10_000); expect(game.sim.tick).toBe(1);
    game.dispose(); expect(env.frames.size).toBe(0); expect(env.listeners.size).toBe(0);
    game.start(); expect(env.frames.size).toBe(0); expect(game.step(1)).toBe(0);
    expect(game.submit(draw)).toBeNull(); game.advanceFrame(20_000); expect(game.sim.tick).toBe(1);
  });

  it('manual stepping resets rAF baseline and refuses invalid tick counts', () => {
    const game = driver(); game.advanceFrame(0); game.advanceFrame(25); game.step(2);
    game.advanceFrame(10_000); expect(game.sim.tick).toBe(2); expect(game.alpha).toBe(0);
    expect(() => game.step(-1)).toThrow(); expect(() => game.step(1.5)).toThrow();
    expect(() => game.step(Infinity)).toThrow();
  });

  it('different frame splits produce the same hash as direct ticks and replay playback', () => {
    const metadata = { rulesVersion: '1.0.0', schemaVersion: '1.0.0', contentVersion: '1.0.0' } as const;
    const ticks: number[] = [];
    const make = () => driver({ createSim: (compiled, seed) => createReplayRecorder(compiled, seed, metadata),
      createBotDriver: () => ({ commands: sim => sim.tick === 0 ? [botDraw] : [] }),
      onTick: update => ticks.push(update.tick),
    });
    const split = make(); const batch = make();
    split.submit(draw); batch.submit(draw); split.advanceFrame(0); batch.advanceFrame(0);
    for (let time = 10; time <= 1000; time += 10) split.advanceFrame(time);
    for (let time = 250; time <= 1000; time += 250) batch.advanceFrame(time);
    const direct = create(level, 42); direct.step([draw, botDraw]);
    for (let tick = 1; tick < 20; tick++) direct.step([]);
    expect(split.sim.tick).toBe(20); expect(split.sim.hash()).toBe(batch.sim.hash());
    expect(split.sim.hash()).toBe(direct.hash());
    const rec = (split.sim as ReturnType<typeof createReplayRecorder>).record();
    expect(rec.commands).toEqual([{ tick: 0, cmd: draw }, { tick: 0, cmd: botDraw }]);
    const replay = playReplay({ metadata, level }, rec);
    expect(replay.ok).toBe(true); expect(replay.sim.hash()).toBe(split.sim.hash());
    expect(ticks.slice(0, 20)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });
});
