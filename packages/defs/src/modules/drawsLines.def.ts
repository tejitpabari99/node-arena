import { noParams } from '../params.js';
import { defineModule } from './define.js';

export const drawsLinesDef = defineModule({
  id: 'drawsLines',
  appliesTo: 'building',
  params: noParams(),
  ruleIds: ['R-LIN-01', 'R-LIN-02', 'R-LIN-03', 'R-LIN-05'],
  phases: ['commands'],
});
