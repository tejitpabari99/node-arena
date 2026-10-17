import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { canonicalJson, checkContentVersion, checkRulesVersion, generateHashes, loadContent, type Content, type ContentBaseline, type ContentFileMap, type HashesLock } from '@node-arena/content';
import { checkBotVersion, readBotVersion } from '../../packages/content/scripts/bot-version.js';
import { LocatedError, readJson, readText } from './files.js';
// The baseline always refers to committed repository content, including when --dir supplies a fixture.
export function readBaseline(root: string, ref: string): ContentBaseline | undefined {
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    const revision = git('rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`);
    const prefix = 'packages/content/';
    const names = new Set(git('ls-tree', '-r', '--name-only', revision, '--', `${prefix}content.json`, `${prefix}hashes.lock.json`).split('\n'));
    if (!names.has(`${prefix}content.json`)) {
      if (names.has(`${prefix}hashes.lock.json`) && canonicalJson(JSON.parse(git('show', `${revision}:${prefix}hashes.lock.json`))) !== canonicalJson({levels: {}, bots: {}})) throw new Error('Baseline has hashes without metadata');
      return undefined;
    }
    if (!names.has(`${prefix}hashes.lock.json`)) throw new Error('Baseline lock is missing');
    const metadata = loadContent({ 'content.json': git('show', `${revision}:${prefix}content.json`) }, { partial: true })['content.json'] as Content;
    return { metadata, hashes: JSON.parse(git('show', `${revision}:${prefix}hashes.lock.json`)) as HashesLock };
  } catch (error) { throw new LocatedError('content.json', `Invalid baseline ${ref}: ${(error as Error).message}`); }
}
export async function checkLock(files: ContentFileMap, dir: string, root: string, base: string): Promise<string> {
  const loaded = loadContent(files); const metadata = loaded['content.json'] as Content;
  try { checkRulesVersion(await readText(resolve(root, 'docs/GAME_RULES.md')), metadata.rulesVersion); }
  catch (error) { throw new LocatedError('content.json', (error as Error).message, '/rulesVersion'); }
  const hashes = generateHashes(loaded);
  if (canonicalJson(await readJson(resolve(dir, 'hashes.lock.json'), 'hashes.lock.json')) !== canonicalJson(hashes)) throw new LocatedError('hashes.lock.json', 'hashes.lock.json is stale; run pnpm content:lock');
  const baseline = readBaseline(root, base);
  try { checkContentVersion(metadata, hashes, baseline); }
  catch (error) { if (error instanceof LocatedError) throw error; throw new LocatedError('content.json', (error as Error).message, '/contentVersion'); }
  try { checkBotVersion(hashes.bots, baseline?.hashes.bots, readBotVersion(root), readBotVersion(root, base)); }
  catch (error) { throw new LocatedError('packages/bots/src/version.ts', (error as Error).message); }
  return `Content valid; hashes current (${Object.keys(hashes.levels).length} levels, ${Object.keys(hashes.bots).length} bots); rules/content/BOT_VERSION gates agree.`;
}
