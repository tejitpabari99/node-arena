import { describe, expect, it } from 'vitest';
import { compileLevel, loadContent, validateContent } from '@node-arena/content';
import type { SimEvent } from '@node-arena/sim';
import { createAppController } from '../src/app/state';
import { contentFiles } from '../src/app/boot';
import { parseManifest } from '../src/manifest/load';
import { createSaveStore } from '../src/save';
import type { CommandSubmission } from '../src/driver';
import { fixtureFiles } from '../src/test-harness/fixtures';
import manifestJSON from './fixtures/greybox-manifest.json';

const manifest = parseManifest(manifestJSON);
const SCRIPT = [
  { type: 'DrawLine', player: 'p1', from: 'a', to: 'b' },
  { type: 'DrawLine', player: 'p2', from: 'b', to: 'a' },
  { type: 'DrawLine', player: 'p1', from: 'c', to: 'd' },
] as const;
const cross = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);

/** Load fixture-1, script the three lanes at tick 0, step to first Clash + 20. */
async function run() {
  const files = fixtureFiles(contentFiles(), 'visual-clash');
  const app = createAppController({ files, loadManifest: async () => manifest, save: createSaveStore({ storage: null }), autoStart: false });
  await app.boot();
  const events: SimEvent[] = [], submissions: CommandSubmission[] = [];
  app.subscribeEvents(update => { events.push(...update.events); submissions.push(...update.submissions); });
  await app.startLevel('fixture-1', 1);
  const scripted = new Set(SCRIPT.map(cmd => app.driver!.submit({ ...cmd })));
  let clashTick: number | null = null;
  for (let i = 0; i < 2000 && clashTick === null; i++) {
    app.step(1);
    clashTick = events.find(e => e.type === 'Clash')?.tick ?? null;
  }
  expect(clashTick).not.toBeNull();
  app.step(clashTick! + 20 - app.driver!.sim.tick);
  const result = {
    clashTick, tick: app.driver!.sim.tick, hash: app.driver!.sim.hash(), over: app.driver!.sim.view.over,
    botCommands: submissions.filter(s => !scripted.has(s)).map(s => s.cmd),
    rejected: events.filter(e => e.type === 'CommandRejected'),
    drawn: events.filter(e => e.type === 'LineDrawn').length,
  };
  app.dispose();
  return result;
}

describe('visual-clash fixture (SP01 Task 2)', () => {
  const files = fixtureFiles(contentFiles(), 'visual-clash');
  it('validates and compiles 20 four-tower levels: A(p1)/B(p2) hostile, C(p1)/D(neutral), C-D crosses A-B', () => {
    expect(validateContent(files).errors).toEqual([]);
    const loaded = loadContent(files);
    for (let i = 1; i <= 20; i++) expect(compileLevel(loaded, `fixture-${i}`).id).toBe(`fixture-${i}`);
    const level = JSON.parse(files['data/levels/01-fixture.json'] as string);
    expect(level.towers.map((t: { id: string; owner: string | null }) => [t.id, t.owner])).toEqual([['a', 'p1'], ['b', 'p2'], ['c', 'p1'], ['d', null]]);
    expect(level.players.find((p: { id: string }) => p.id === 'p2')).toMatchObject({ kind: 'bot', botProfile: 'idle' });
    const [A, B, C, D] = level.towers.map((t: { pos: { x: number; y: number } }) => t.pos);
    expect(Math.sign(cross(A, B, C)) * Math.sign(cross(A, B, D))).toBe(-1);
    expect(Math.sign(cross(C, D, A)) * Math.sign(cross(C, D, B))).toBe(-1);
  });
  it('a Clash occurs and no bot command is emitted through clash tick + 20 (deterministic across runs)', async () => {
    const first = await run();
    expect(first.drawn).toBe(3);
    expect(first.rejected).toEqual([]);
    expect(first.botCommands).toEqual([]);
    expect(first.over).toBeNull();
    expect(first.clashTick).toBe(100); // seed 1; scenes.json clash capture tick = 120
    expect(first.tick).toBe(first.clashTick! + 20);
    expect(await run()).toEqual(first);
  });
});
