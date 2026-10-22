import type { LoadedContent } from './content.js';
import { ContentLoadError } from './fixed-point.js';
import { canonicalJson } from './hash.js';
import { parseAndConvert, type ContentSource } from './issues.js';
import type { ContentMeta } from './schemas.js';

export const RULES_VERSION = '2.0.0';
export interface ReplayHeader {
  rulesVersion: string;
  schemaVersion: string;
  contentVersion: string;
  levelId: string;
  simHash: string;
  seed: number;
}
/** `levels`: level id -> simHash; `bots`: `<levelId>#<playerId>` -> botHash. */
export interface HashesLock { levels: Record<string, string>; bots: Record<string, string> }
/** Baseline metadata only needs the version; older baselines carry other envelope fields. */
export interface ContentBaseline { metadata: Pick<ContentMeta, 'contentVersion'>; hashes: HashesLock }

const sorted = (record: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

export function generateHashes(content: Pick<LoadedContent, 'compiled'>): HashesLock {
  const levels: Record<string, string> = {}; const bots: Record<string, string> = {};
  for (const level of Object.values(content.compiled)) {
    levels[level.id] = level.simHash;
    Object.assign(bots, level.botHash);
  }
  return { levels: sorted(levels), bots: sorted(bots) };
}

/** Validate a `content.json` source against the content schema (throws `ContentLoadError`). */
export function parseContentMeta(source: ContentSource, file = 'content.json'): ContentMeta {
  const parsed = parseAndConvert<ContentMeta>(file, source, 'content');
  if (!parsed.value) throw new ContentLoadError(parsed.issues);
  return parsed.value;
}

/** Baseline `content.json` may predate this schema; only `contentVersion` is read. */
export function readBaselineVersion(source: string): Pick<ContentMeta, 'contentVersion'> {
  const value = JSON.parse(source) as { contentVersion?: unknown };
  if (typeof value.contentVersion !== 'string') throw new Error('Baseline content.json has no contentVersion');
  return { contentVersion: value.contentVersion };
}

/** Compare against baseline metadata AND lock, never the newly regenerated lock. */
export function checkContentVersion(metadata: Pick<ContentMeta, 'contentVersion'>, hashes: HashesLock, baseline?: ContentBaseline): void {
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
