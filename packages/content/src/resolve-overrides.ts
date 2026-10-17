import type { Archetype, Balance, Level } from './core.schema.js';
import type { Troop } from './troop.schema.js';
import type { LoadedContent } from './parse-content.js';
import { ContentLoadError, escapePointerSegment as esc, type ContentIssue } from './fixed-point.js';

export interface ResolvedLevelData { archetypes: Record<string, Archetype>; troops: Record<string, Troop>; globals: Balance['defaults'] }
/** Param patches operate on already resolved, loaded-unit entities. No inputs mutate. */
export function resolveLevelOverrides(files: LoadedContent, level: Level, file = level.id, issues?: ContentIssue[]): ResolvedLevelData {
  const archetypes: Record<string, Archetype> = Object.create(null); const troops: Record<string, Troop> = Object.create(null);
  let globals: Balance['defaults'] | undefined;
  for (const entity of Object.values(files)) {
    if ('components' in entity) archetypes[entity.id] = structuredClone(entity);
    else if ('speed' in entity) troops[entity.id] = structuredClone(entity);
    else if ('defaults' in entity) globals = structuredClone(entity.defaults);
  }
  const errors: ContentIssue[] = [];
  const issue = (pointer: string) => errors.push({ file, pointer, message: 'Override target does not exist' });
  for (const [id, patch] of Object.entries(level.overrides.troops ?? {})) {
    const pointer = `/overrides/troops/${esc(id)}`; const target = troops[id];
    if (!target) { issue(pointer); continue; }
    for (const [key, value] of Object.entries(patch)) {
      if (!Object.hasOwn(target, key)) issue(`${pointer}/${esc(key)}`);
      else Object.assign(target, { [key]: structuredClone(value) });
    }
  }
  for (const [id, patch] of Object.entries(level.overrides.archetypes ?? {})) {
    const pointer = `/overrides/archetypes/${esc(id)}`; const target = archetypes[id];
    if (!target) { issue(pointer); continue; }
    for (const [name, params] of Object.entries(patch.components)) {
      const componentPointer = `${pointer}/components/${esc(name)}`; const component = target.components[name];
      if (!Object.hasOwn(target.components, name) || !component) { issue(componentPointer); continue; }
      for (const [key, value] of Object.entries(params)) {
        if (!Object.hasOwn(component, key)) issue(`${componentPointer}/${esc(key)}`);
        else Object.assign(component, { [key]: structuredClone(value) });
      }
    }
  }
  for (const [key, value] of Object.entries(level.overrides.globals ?? {})) {
    if (!globals || !Object.hasOwn(globals, key)) issue(`/overrides/globals/${esc(key)}`);
    else Object.assign(globals, { [key]: value });
  }
  if (!globals) errors.push({ file, pointer: '/timeLimitSec', message: 'Missing balance defaults' });
  if (issues) issues.push(...errors);
  else if (errors.length) throw new ContentLoadError(errors);
  return { archetypes, troops, globals: globals! };
}
