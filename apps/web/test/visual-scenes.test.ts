import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { captureJobs, frameFile, loadScenes, parseArgs, sceneFrames, PORT } from '../visual/lib/scenes.mjs';

const LEVELS = path.resolve(__dirname, '../../../packages/content/data/levels');
const config = loadScenes();
const byId = Object.fromEntries(config.scenes.map(s => [s.id, s]));

describe('visual scenes.json + capture args (SP01 Task 3)', () => {
  it('has the 9 PRD scenes, seed 1 and the pinned settings', () => {
    expect(config.scenes.map(s => s.id)).toEqual(['l01', 'l10', 'l18', 'clash', 'menu', 'picker', 'buildout', 'cut', 'l10cb']);
    expect(config.seed).toBe(1);
    expect(config.settings).toEqual({ quality: 'high', reducedMotion: true, colorblind: false });
    expect(PORT).toBe(4174);
  });
  it('expands to 9 scenes x 2 viewports + 3 at 1920x1200', () => {
    const jobs = captureJobs(config);
    expect(jobs).toHaveLength(21);
    expect(jobs.filter(j => j.viewport === '1920x1200').map(j => j.scene.id)).toEqual(['l01', 'l10', 'l18']);
    for (const s of config.scenes) for (const v of ['1920x1080', '1366x768']) expect(jobs.some(j => j.scene.id === s.id && j.viewport === v)).toBe(true);
    expect(captureJobs(config, { scenes: ['l01'], viewports: [] }).map(j => j.viewport)).toEqual(['1920x1080', '1366x768', '1920x1200']);
    expect(captureJobs(config, { scenes: ['cut'], viewports: ['1366x768'] })).toHaveLength(1);
    expect(() => captureJobs(config, { scenes: ['nope'], viewports: [] })).toThrow(/unknown scene/);
  });
  it('capture ticks and frames follow the PRD', () => {
    expect(sceneFrames(byId.l01!).map(f => f.tick)).toEqual([240]);
    expect(sceneFrames(byId.l10!).map(f => f.tick)).toEqual([400]);
    expect(sceneFrames(byId.l18!).map(f => f.tick)).toEqual([600]);
    expect(sceneFrames(byId.clash!)).toMatchObject([{ after: { event: 'Clash', plus: 20 }, settle: true }, { label: 'p6', relative: 6, settle: false }]);
    expect(byId.clash!.splitTrace).toEqual({ ticks: 10 });
    expect(sceneFrames(byId.buildout!).map(f => [f.tick, f.settle])).toEqual([[2, false], [6, false], [12, false]]);
    expect(sceneFrames(byId.cut!).map(f => [f.label, f.tick, f.settle])).toEqual([['p1', 121, false], ['p3', 123, false], ['p6', 126, false]]);
    expect(byId.cut!.commands).toEqual([
      { type: 'DrawLine', player: 'p1', from: 't1', to: 't2' },
      { type: 'CutLine', player: 'p1', from: 't1', to: 't2', tick: 120 },
    ]);
    expect(byId.l10cb!.settings).toEqual({ colorblind: true });
    expect(frameFile('cut', '1920x1080', 'p3')).toBe('cut-1920x1080-p3.png');
    expect(frameFile('l01', '1366x768', null)).toBe('l01-1366x768.png');
  });
  it('shipped-level scenes script a tick-0 line from a human-owned tower to an existing tower', () => {
    for (const s of config.scenes.filter(s => s.level && !s.fixture)) {
      const level = JSON.parse(fs.readFileSync(path.join(LEVELS, `${s.level}.json`), 'utf8'));
      const human = level.players.find((p: { kind: string }) => p.kind === 'human').id;
      const first = s.commands![0]!;
      expect(first).toMatchObject({ type: 'DrawLine', player: human });
      expect(first.tick ?? 0).toBe(0);
      expect(level.towers.find((t: { id: string }) => t.id === first.from).owner).toBe(human);
      expect(level.towers.some((t: { id: string }) => t.id === first.to)).toBe(true);
    }
  });
  it('parses capture flags', () => {
    expect(parseArgs([])).toEqual({ scenes: [], viewports: [], headed: false, gpu: false, dev: false, build: true, lod: null });
    expect(parseArgs(['--scene', 'l01', '--viewport=1366x768', '--headed', '--gpu', '--no-build'])).toEqual({ scenes: ['l01'], viewports: ['1366x768'], headed: true, gpu: true, dev: false, build: false, lod: null });
    expect(parseArgs(['--lod', 'low']).lod).toBe('low'); expect(() => parseArgs(['--lod', 'mid'])).toThrow(/low|high/);
    expect(parseArgs(['--dev']).build).toBe(false);
    expect(() => parseArgs(['--viewport', '800x600'])).toThrow(/unknown viewport/);
    expect(() => parseArgs(['--bogus'])).toThrow(/unknown argument/);
  });
});
