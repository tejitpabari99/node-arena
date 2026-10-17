import { createReplayRecorder, playReplay, type ReplayMetadata, type ReplayRecord, type SimEvent } from '../../src/index.js';
import { WordHash } from '../../src/math.js';
import { scenarios, type Scenario } from './scenarios.js';
export interface GoldenResult { name: string; replay: ReplayRecord; eventLogHash: string; events: SimEvent[] }
export function eventLogHash(events: readonly SimEvent[]): string {
  const hash = new WordHash();
  hash.text('sim-golden-events-v1');
  hash.text(JSON.stringify(events));
  return hash.finish();
}
export function runScenario(scenario: Scenario, metadata: ReplayMetadata): GoldenResult {
  const recorder = createReplayRecorder(scenario.level, scenario.seed, metadata);
  const events: SimEvent[] = [];
  for (let i = 0; i < scenario.ticks && !recorder.view.over; i++) {
    events.push(...recorder.step(scenario.commands.filter(c => c.tick === recorder.tick).map(c => c.cmd)));
  }
  if (scenario.fullGame && !recorder.view.over) throw new Error(`Incomplete full-game fixture: ${scenario.name}`);
  const replay = recorder.record();
  const played = playReplay({ metadata, level: scenario.level }, replay);
  if (!played.ok) throw new Error(`Golden replay diverged: ${scenario.name} at ${played.divergingTick}`);
  return { name: scenario.name, replay, eventLogHash: eventLogHash(events), events };
}
export function runGoldens(metadata: ReplayMetadata): GoldenResult[] { return scenarios.map(s => runScenario(s, metadata)); }
