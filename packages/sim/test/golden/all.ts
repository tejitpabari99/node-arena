import { geometryScenarios } from './scenarios-geometry.js';
import { scenarios } from './scenarios.js';
import type { Scenario } from './scenarios.js';

/** Single Node/browser golden scenario list. */
export const allScenarios: readonly Scenario[] = [...scenarios, ...geometryScenarios];
