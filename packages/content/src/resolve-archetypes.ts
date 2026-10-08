import type { Archetype } from './core.schema.js';
import { ContentLoadError, escapePointerSegment, type ContentIssue } from './fixed-point.js';
import { COMPONENT_REGISTRY, validateComponents, type ComponentRegistry } from './component-registry.js';

/** Resolve schema-checked, loaded-unit archetypes; keys remain source file paths.
 * A variant patches existing component params, never the component set. Arrays
 * replace whole, and the cloned results share no mutable data with the inputs.
 */
export function resolveArchetypes(files: Record<string, Archetype>, registry: ComponentRegistry = COMPONENT_REGISTRY, issues?: ContentIssue[]): Record<string, Archetype> {
  const byId = new Map<string, Archetype>();
  const errors: ContentIssue[] = [];
  for (const [file, archetype] of Object.entries(files)) {
    if (byId.has(archetype.id)) errors.push({ file, pointer: '/id', message: 'Duplicate archetype id' });
    else byId.set(archetype.id, archetype);
  }
  const resolved: Record<string, Archetype> = Object.create(null);
  for (const [file, archetype] of Object.entries(files)) {
    errors.push(...validateComponents(archetype.components, file, registry, archetype.extends !== undefined));
    let base: Archetype | undefined;
    if (archetype.extends !== undefined) {
      base = byId.get(archetype.extends);
      if (!base || base === archetype || base.extends !== undefined) {
        errors.push({ file, pointer: '/extends', message: !base ? 'Unknown extends archetype' : 'Archetype extends must have depth at most one and no cycles' });
        continue;
      }
      for (const name of Object.keys(archetype.components)) {
        if (!Object.hasOwn(base.components, name)) errors.push({ file, pointer: `/components/${escapePointerSegment(name)}`, message: 'A variant cannot add components' });
      }
    }
    const components = structuredClone(base?.components ?? {});
    for (const [name, params] of Object.entries(archetype.components)) {
      components[name] = { ...components[name], ...structuredClone(params) };
    }
    resolved[file] = { ...structuredClone(archetype), components };
    // Keep authored extends metadata as provenance; components are fully resolved.
  }
  if (issues) issues.push(...errors);
  else if (errors.length) throw new ContentLoadError(errors);
  return resolved;
}
