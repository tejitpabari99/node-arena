import type { TObject } from 'typebox';
import type { Phase } from '../phases.js';

export interface ModuleDef<Id extends string = string, P extends TObject = TObject> {
  readonly id: Id;
  readonly appliesTo: 'building' | 'element';
  /** Param bag schema (full). Instance overrides validate against `Type.Partial(params)`. */
  readonly params: P;
  /** Rule ids (GAME_RULES.md headings) this module implements. */
  readonly ruleIds: readonly string[];
  /** Phases the module may run in. */
  readonly phases: readonly Phase[];
  /** Capability name a level `requires` when it uses this module. */
  readonly feature: Id;
}

export function defineModule<const Id extends string, P extends TObject>(def: Omit<ModuleDef<Id, P>, 'feature'>): ModuleDef<Id, P> {
  return { ...def, feature: def.id };
}
