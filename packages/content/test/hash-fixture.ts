import type { ContentFileMap } from '../src/index.js';
const envelope = (name: string) => ({ $schema: `${name}.schema.json`, schemaVersion: '1.0.0' });
export function hashFixture(): ContentFileMap {
  return {
    'content.json': { ...envelope('content'), contentVersion: '1.0.0', rulesVersion: '1.0.0' },
    'data/balance.json': { ...envelope('balance'), defaults: { timeLimitSec: 300, theme: 'city' } },
    'data/troops/regular.json': { ...envelope('troop'), id: 'regular', value: 1, speed: 10.125, visual: 'soldier' },
    'data/troops/unused.json': { ...envelope('troop'), id: 'unused', value: 1, speed: 5, visual: 'unused' },
    'data/archetypes/standard.json': { ...envelope('archetype'), id: 'standard', visual: 'tower', footprintRadius: 3, components: { garrison: { cap: 50 }, generates: { troop: 'regular', ratePerSec: 1.125 }, drawsLines: { extraSlotAbove: [10, 30] }, capturable: {} } },
    'data/bots/base.json': { ...envelope('bot'), id: 'base', kind: 'utility', params: { skill: { decisionIntervalSec: 1.25, noise: 0.1, actionsPerDecision: 2 }, bias: { attack: 1.125 } } },
    'data/bots/easy.json': { ...envelope('bot'), id: 'easy', kind: 'utility', params: { extends: 'base', skill: { decisionIntervalSec: 1.25, noise: 0.3, actionsPerDecision: 2 } } },
    'data/levels/sample.json': { ...envelope('level'), id: 'sample', name: 'Sample', order: 1, band: 1, bounds: { w: 120, h: 80 }, players: [{ id: 'p1', kind: 'human', colorKey: 'red' }, { id: 'b1', kind: 'bot', colorKey: 'blue', botProfile: 'easy' }], towers: [{ id: 't1', archetype: 'standard', pos: { x: -40.125, y: 0.001 }, owner: 'p1', garrison: 10 }, { id: 't2', archetype: 'standard', pos: { x: 40, y: -2.125 }, owner: 'b1', garrison: 15 }], obstacles: [], mapObjects: [], overrides: {} },
  };
}
