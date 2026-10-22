import envelope from '../../../../content/content.json';
import baseline from '../baseline.json';
import { allScenarios } from '../all.js';
import { runGoldens } from '../run.js';
import { playReplay, type ReplayRecord, type ReplayMetadata } from '../../../src/index.js';
import type { CompiledLevel } from '@node-arena/content';

const metadata = envelope as ReplayMetadata;
// Fresh run in the browser: compiles every level from inline JSON and records every scenario.
const results = runGoldens(metadata, allScenarios);
// Playback of the committed Node-recorded replays against the committed compiled levels.
const played = baseline.results.map(r => {
  const level = baseline.scenarios.find(s => s.name === r.name)!.level as unknown as CompiledLevel;
  const result = playReplay({ metadata, level }, r.replay as unknown as ReplayRecord);
  return { name: r.name, ok: result.ok, finalHash: result.sim.hash() };
});
document.querySelector('#result')!.textContent = JSON.stringify({
  results, played,
  nodeGlobals: [typeof (globalThis as Record<string, unknown>).process, typeof (globalThis as Record<string, unknown>).Buffer, typeof (globalThis as Record<string, unknown>).require],
});
