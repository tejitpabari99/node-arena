import Type from 'typebox';
import { fx3 } from '../params.js';
import { defineModule } from './define.js';

export const growsDef = defineModule({
  id: 'grows',
  appliesTo: 'building',
  params: Type.Object({ growTime: fx3({ exclusiveMinimum: 0 }) }, { additionalProperties: false }),
  ruleIds: ['R-GRW-01', 'R-GRW-02', 'R-TCK-06'],
  phases: ['growth'],
});
