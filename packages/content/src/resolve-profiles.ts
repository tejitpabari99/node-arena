import type { BotProfile } from './bot.schema.js';
import type { LoadedContent } from './parse-content.js';
import { ContentLoadError, type ContentIssue } from './fixed-point.js';

/** Loaded-unit profiles keyed by source path, independently cloned for the compiler. */
export function resolveProfiles(files: LoadedContent): Record<string, BotProfile> {
  const profiles = Object.entries(files).filter((entry): entry is [string, BotProfile] => 'kind' in entry[1] && 'params' in entry[1]);
  const byId = new Map(profiles.map(([file, profile]) => [profile.id, { file, profile }]));
  const errors: ContentIssue[] = []; const resolved: Record<string, BotProfile> = Object.create(null);
  const seen = new Set<string>();
  for (const [file, profile] of profiles) {
    if (seen.has(profile.id)) errors.push({ file, pointer: '/id', message: 'Duplicate bot profile id' });
    seen.add(profile.id);
    const base = profile.params.extends === undefined ? undefined : byId.get(profile.params.extends)?.profile;
    if (profile.params.extends !== undefined) {
      if (!base || base === profile || base.params.extends !== undefined) errors.push({ file, pointer: '/params/extends', message: !base ? 'Unknown bot base' : 'Bot inheritance must have depth at most one and no cycles' });
      if (base && base.kind !== profile.kind) errors.push({ file, pointer: '/kind', message: 'Bot kind must match its base' });
      for (const key of Object.keys(profile.params)) if (key !== 'extends' && key !== 'skill') errors.push({ file, pointer: `/params/${key}`, message: 'Bot variants may override only skill' });
    }
    resolved[file] = { ...structuredClone(profile), params: { ...structuredClone(base?.params ?? {}), ...structuredClone(profile.params) } };
  }
  if (errors.length) throw new ContentLoadError(errors);
  return resolved;
}
