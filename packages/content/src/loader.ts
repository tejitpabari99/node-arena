import { ContentLoadError } from './fixed-point.js';
import { parseContent, type ContentFileMap, type LoadedContent } from './parse-content.js';
import { COMPONENT_REGISTRY, validateTroopValue, type ComponentRegistry } from './component-registry.js';
import { resolveArchetypes } from './resolve-archetypes.js';
import { validateLoadedContent } from './validate-content.js';
import type { Archetype } from './core.schema.js';
export type { ContentFileMap, LoadedContent } from './parse-content.js';
export interface LoadContentOptions {
  registry?: ComponentRegistry;
  /** Explicit schema/registry-only mode for isolated tooling; public default checks every reference. */
  partial?: boolean;
}

/** Path-keyed clones in milli-units; all supplied content is validated by default. */
export function loadContent(fileMap: ContentFileMap, opts: LoadContentOptions = {}): LoadedContent {
  const parsed = parseContent(fileMap);
  if (!opts.partial) {
    const result = validateLoadedContent(parsed.files, opts);
    const errors = [...parsed.errors, ...result.errors];
    if (errors.length) throw new ContentLoadError(errors);
    return result.files;
  }
  const errors = [...parsed.errors]; const registry = opts.registry ?? COMPONENT_REGISTRY;
  const archetypes: Record<string, Archetype> = {};
  for (const [file, entity] of Object.entries(parsed.files)) {
    if ('components' in entity) archetypes[file] = entity;
    if ('speed' in entity) errors.push(...validateTroopValue(entity.value, file, registry));
  }
  const resolved = resolveArchetypes(archetypes, registry, errors);
  if (errors.length) throw new ContentLoadError(errors);
  return { ...parsed.files, ...resolved };
}
