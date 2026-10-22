import Type from 'typebox';
import { count } from '../params.js';
import { defineModule } from './define.js';

export const levelDef = defineModule({
  id: 'level',
  appliesTo: 'building',
  params: Type.Object({ maxLevel: count({ minimum: 1 }) }, { additionalProperties: false }),
  ruleIds: ['R-CAP-01', 'R-GRW-01'],
  phases: [],
});
