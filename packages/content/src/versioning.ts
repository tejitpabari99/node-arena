import type { Content, Level } from './core.schema.js';
import type { LoadedContent } from './parse-content.js';
import { compileLevel } from './compile.js';
import { canonicalJson, hashBotProfile } from './hash.js';
import { resolveProfiles } from './resolve-profiles.js';

export const RULES_VERSION = '1.0.0';
export interface ReplayHeader {
  rulesVersion: string;
  schemaVersion: string;
  contentVersion: string;
  levelId: string;
  simHash: string;
  seed: number;
}
export interface HashesLock { levels: Record<string, string>; bots: Record<string, string> }
export interface ContentBaseline { metadata: Content; hashes: HashesLock }

export function generateHashes(content: LoadedContent): HashesLock {
  const levels = Object.values(content).filter((entity): entity is Level => 'towers' in entity).sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const profiles = Object.values(resolveProfiles(content)).sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return {
    levels: Object.fromEntries(levels.map(level => [level.id, compileLevel(content, level.id).simHash])),
    bots: Object.fromEntries(profiles.map(profile => {
      const params = structuredClone(profile.params); delete params.extends;
      return [profile.id, hashBotProfile({ id: profile.id, kind: profile.kind, params })];
    })),
  };
}

/** Compare against baseline metadata AND lock, never the newly regenerated lock.
 * Bot hash changes remain visible, but BOT_VERSION enforcement belongs to SP04.
 */
export function checkContentVersion(metadata: Content, hashes: HashesLock, baseline?: ContentBaseline): void {
  if (!baseline || canonicalJson(hashes.levels) === canonicalJson(baseline.hashes.levels)) return;
  const current = metadata.contentVersion.split('.').map(Number);
  const previous = baseline.metadata.contentVersion.split('.').map(Number);
  const firstDifference = current.findIndex((n, i) => n !== previous[i]);
  if (firstDifference < 0 || current[firstDifference]! <= previous[firstDifference]!) {
    throw new Error('Simulation hashes changed: contentVersion must increase from the baseline; run pnpm content:lock after bumping it');
  }
}
export function checkRulesVersion(rules: string, contentRulesVersion?: string): void {
  const headers = [...rules.matchAll(/^RULES_VERSION:\s*(\d+\.\d+\.\d+)\s*$/gm)];
  if (headers.length !== 1 || headers[0]![1] !== RULES_VERSION) throw new Error('GAME_RULES.md RULES_VERSION must equal the exported RULES_VERSION');
  if (contentRulesVersion !== undefined && contentRulesVersion !== RULES_VERSION) throw new Error('content.json rulesVersion must equal RULES_VERSION');
}
