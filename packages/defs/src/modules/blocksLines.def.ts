import { noParams } from '../params.js';
import { defineModule } from './define.js';

export const blocksLinesDef = defineModule({
  id: 'blocksLines',
  appliesTo: 'element',
  params: noParams(),
  ruleIds: ['R-OBS-01', 'R-OBS-02'],
  phases: ['commands'],
});
