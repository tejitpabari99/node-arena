import { escapePointerSegment, type ContentIssue } from './fixed-point.js';
import type { Archetype } from './core.schema.js';

/** Numeric bounds describe loaded units: fx3 is milli-units, integer is unscaled. */
export type ParamRule = (
  | { readonly type: 'number'; readonly unit: 'integer' | 'fx3'; readonly minimum: number; readonly maximum: number }
  | { readonly type: 'string'; readonly values?: readonly string[]; readonly pattern?: string }
  | { readonly type: 'boolean' }
  | { readonly type: 'array'; readonly items: ParamRule; readonly strictlyAscending?: boolean }
) & { readonly optional?: boolean };
export interface ComponentDefinition {
  readonly params: Readonly<Record<string, ParamRule>>;
  readonly ruleIds: readonly string[];
}
export interface ComponentRegistry {
  readonly components: Readonly<Record<string, ComponentDefinition>>;
  readonly troopValue: { readonly minimum: number; readonly maximum: number; readonly ruleIds: readonly string[] };
}

const count: ParamRule = { type: 'number', unit: 'integer', minimum: 0, maximum: 2147483647 };
/** The supported mechanics contract; SP02 compares component names at startup. */
export const COMPONENT_REGISTRY: ComponentRegistry = {
  components: {
    garrison: { params: { cap: count }, ruleIds: ['R-ENT-01', 'R-CAP-01', 'R-CAP-02', 'R-CMB-02', 'R-CMB-03'] },
    generates: { params: { troop: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*$' }, ratePerSec: { type: 'number', unit: 'fx3', minimum: 1, maximum: 2147483647 } }, ruleIds: ['R-ENT-01', 'R-GEN-01', 'R-GEN-02', 'R-SND-01', 'R-SND-02', 'R-CAP-02'] },
    drawsLines: { params: { extraSlotAbove: { type: 'array', items: count, strictlyAscending: true } }, ruleIds: ['R-ENT-03', 'R-LIN-01', 'R-LIN-02', 'R-LIN-03', 'R-LIN-04', 'R-LIN-05', 'R-SND-02'] },
    capturable: { params: {}, ruleIds: ['R-ENT-01', 'R-CMB-03', 'R-CPT-01', 'R-CPT-02'] },
  },
  troopValue: { minimum: 1, maximum: 1, ruleIds: ['R-ENT-02', 'R-CMB-01', 'R-CMB-03'] },
};

function validateParam(value: unknown, rule: ParamRule, file: string, pointer: string): ContentIssue[] {
  const error = (message: string): ContentIssue[] => [{ file, pointer, message }];
  if (rule.type === 'number') {
    return typeof value === 'number' && Number.isInteger(value) && value >= rule.minimum && value <= rule.maximum
      ? [] : error(`Expected ${rule.unit} integer in supported range ${rule.minimum}..${rule.maximum}`);
  }
  if (rule.type === 'string') {
    return typeof value === 'string' && (!rule.values || rule.values.includes(value)) && (!rule.pattern || new RegExp(rule.pattern).test(value))
      ? [] : error('Unsupported string parameter');
  }
  if (rule.type === 'boolean') return typeof value === 'boolean' ? [] : error('Expected boolean parameter');
  if (!Array.isArray(value)) return error('Expected array parameter');
  return value.flatMap((item, index) => {
    const errors = validateParam(item, rule.items, file, `${pointer}/${index}`);
    if (rule.strictlyAscending && index > 0 && typeof item === 'number' && typeof value[index - 1] === 'number' && item <= value[index - 1]) {
      errors.push({ file, pointer: `${pointer}/${index}`, message: 'Thresholds must be strictly ascending' });
    }
    return errors;
  });
}

/** Validate loaded param bags. Partial patches may omit required params. */
export function validateComponents(components: Archetype['components'], file: string, registry = COMPONENT_REGISTRY, partial = false, pointer = '/components'): ContentIssue[] {
  return Object.entries(components).flatMap(([name, params]) => {
    const componentPointer = `${pointer}/${escapePointerSegment(name)}`;
    if (!Object.hasOwn(registry.components, name)) return [{ file, pointer: componentPointer, message: 'Unknown component' }];
    const definition = registry.components[name]!;
    const errors: ContentIssue[] = [];
    for (const [param, value] of Object.entries(params)) {
      const paramPointer = `${componentPointer}/${escapePointerSegment(param)}`;
      if (!Object.hasOwn(definition.params, param)) errors.push({ file, pointer: paramPointer, message: 'Unknown component parameter' });
      else errors.push(...validateParam(value, definition.params[param]!, file, paramPointer));
    }
    if (!partial) {
      for (const [param, rule] of Object.entries(definition.params)) {
        if (!rule.optional && !Object.hasOwn(params, param)) errors.push({ file, pointer: `${componentPointer}/${escapePointerSegment(param)}`, message: 'Missing required component parameter' });
      }
    }
    return errors;
  });
}

export function validateTroopValue(value: number, file: string, registry = COMPONENT_REGISTRY, pointer = '/value'): ContentIssue[] {
  return Number.isInteger(value) && value >= registry.troopValue.minimum && value <= registry.troopValue.maximum
    ? [] : [{ file, pointer, message: `Unsupported troop value: expected ${registry.troopValue.minimum}..${registry.troopValue.maximum}` }];
}
