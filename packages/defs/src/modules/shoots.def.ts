import Type from 'typebox';
import { fx3 } from '../params.js';
import { defineModule } from './define.js';

export const shootsDef = defineModule({
  id: 'shoots',
  appliesTo: 'building',
  params: Type.Object({
    attackDelay: fx3({ exclusiveMinimum: 0 }),
    attackRadius: fx3(),
    speedUpByLevel: fx3(),
    radiusUpByLevel: fx3(),
    radiusUnit: fx3(),
    minRadius: fx3(),
    neutralFires: Type.Boolean(),
    troopPad: fx3(),
    hitsNeutralHouses: Type.Boolean(),
    /** Presentation only: not hashed. */
    bulletSpeed: fx3({ exclusiveMinimum: 0, 'x-presentation': true }),
  }, { additionalProperties: false }),
  ruleIds: ['R-TWR-01', 'R-TWR-02', 'R-TWR-03', 'R-TWR-04'],
  phases: ['towers'],
});
