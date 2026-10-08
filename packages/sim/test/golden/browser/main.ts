import envelope from '../../../../content/content.json';
import baseline from '../baseline.json';
import { runGoldens } from '../run.js';
import { playReplay, type ReplayRecord, type ReplayMetadata } from '../../../src/index.js';
import type { CompiledLevel } from '@node-arena/content';

const metadata = envelope as ReplayMetadata;
const results = runGoldens(metadata);
const played = baseline.results.map(r => {
  const level = baseline.scenarios.find(s => s.name === r.name)!.level as CompiledLevel;
  const result = playReplay({ metadata, level }, r.replay as ReplayRecord);
  return { name: r.name, ok: result.ok, finalHash: result.sim.hash() };
});
document.querySelector('#result')!.textContent = JSON.stringify({
  results, played,
  nodeGlobals: [typeof (globalThis as Record<string, unknown>).process, typeof (globalThis as Record<string, unknown>).Buffer, typeof (globalThis as Record<string, unknown>).require],
});
