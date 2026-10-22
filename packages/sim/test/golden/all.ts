import { scenarios } from './scenarios.js';
import type { Scenario } from './scenarios.js';

/** Golden scenario list. SP04 appends its geometry scenarios here: `[...scenarios, ...geometryScenarios]`. */
export const allScenarios: readonly Scenario[] = [...scenarios];
