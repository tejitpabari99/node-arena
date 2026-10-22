import Type from 'typebox';
import { fx3, unitId } from '../params.js';
import { defineModule } from './define.js';

export const spawnsDef = defineModule({
  id: 'spawns',
  appliesTo: 'building',
  params: Type.Object({
    troop: unitId(),
    spawnSpeed: fx3({ exclusiveMinimum: 0 }),
    lineSpawnPenalty: fx3(),
  }, { additionalProperties: false }),
  ruleIds: ['R-SPN-01', 'R-SPN-02', 'R-SPN-03', 'R-TCK-06'],
  phases: ['spawn'],
});
