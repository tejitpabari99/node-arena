import { readFileSync, globSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createAppController, isLevelUnlocked } from '../../src/app/state.js';
import { createSaveStore } from '../../src/save/index.js';
import { editorPlayOptions } from '../../src/editor/play-content.js';
import { blankDocument } from '../../src/editor/document.js';

const files = Object.fromEntries(globSync('packages/content/data/**/*.json', { cwd: '../..' }).map(path => [path.slice('packages/content/'.length), readFileSync('../../' + path, 'utf8')]));
const manifest = JSON.parse(readFileSync('assets/manifest.json', 'utf8'));
function draft() {
  const level = blankDocument('na-play-test', 'green', 'medium');
  level.buildings = [
    { id: 'b0', archetype: 'house-wt1', pos: { x: -3, z: 0 }, owner: 'p1', level: 1, ignoreForWin: false },
    { id: 'b1', archetype: 'house-wt1', pos: { x: 3, z: 0 }, owner: 'p1', level: 1, ignoreForWin: false },
  ];
  return level;
}
it('overlays the real draft id and a single unlocked custom entry without changing shipped files or the draft', async () => {
  const doc = draft(), before = JSON.stringify(doc), original = JSON.stringify(files);
  const options = editorPlayOptions(files, doc);
  expect(JSON.parse(options.files[`data/levels/${doc.id}.json`] as string).id).toBe(doc.id);
  expect(JSON.parse(options.files['data/campaigns/custom.json'] as string).entries).toEqual([{ level: doc.id, position: 1 }]);
  const app = createAppController({ ...options, loadManifest: async () => manifest, autoStart: false, resultDelayMs: 0 });
  await app.boot();
  expect(app.snapshot().error).toBeNull(); expect(isLevelUnlocked(app.snapshot(), doc.id)).toBe(true);
  await app.startLevel(doc.id, 47); app.step();
  expect(app.snapshot().screen).toBe('result'); expect(app.snapshot().result).toEqual({ outcome: 'won', winner: 0 });
  expect(app.snapshot().save.completed[doc.id]).toBeDefined();
  app.updateSettings({ musicMute: true, sfxMute: true });
  expect(editorPlayOptions(files, doc).save.snapshot().completed).toEqual({});
  expect(editorPlayOptions(files, doc).save.snapshot().settings.musicMute).toBe(false);
  expect(JSON.stringify(doc)).toBe(before); expect(JSON.stringify(files)).toBe(original); app.dispose();
});
it('same-seed normal main-game and Play controller starts have identical state hashes', async () => {
  const doc = draft(), options = editorPlayOptions(files, doc);
  const common = { files: options.files, loadManifest: async () => manifest, autoStart: false };
  const main = createAppController({ ...common, save: createSaveStore({ storage: null }) });
  const play = createAppController({ ...common, ...options });
  await Promise.all([main.boot(), play.boot()]);
  await Promise.all([main.startLevel(doc.id, 113), play.startLevel(doc.id, 113)]);
  expect(play.driver).not.toBeNull(); expect(main.driver).not.toBeNull();
  expect(play.driver!.sim.hash()).toBe(main.driver!.sim.hash());
  main.dispose(); play.dispose();
});
