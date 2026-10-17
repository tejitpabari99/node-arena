import { lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { compileLevel, hashCompiledLevel, loadContent, type CompiledLevel, type LoadedContent } from '@node-arena/content';
import { playReplay, type ReplayMetadata, type ReplayRecord } from '@node-arena/sim';
import { loadFiles, readJson, LocatedError } from './files.js';
import { walkFiles } from './walk.js';
import type { Diagnostic } from './output.js';

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
interface GoldenBundle {
  metadata: ReplayMetadata;
  scenarios: { name: string; level: CompiledLevel }[];
  results: { name: string; replay: ReplayRecord }[];
}
/** Standalone records resolve only against authored content. Golden fixture levels
 * are read as JSON data, hashed again, and never import executable fixture/bot code. */
export async function verifyReplays(target: string, contentDir: string, root: string): Promise<{ summary: string; errors: Diagnostic[] }> {
  const files = await loadFiles(contentDir);
  const metadata = JSON.parse(files['content.json'] as string) as ReplayMetadata;
  let loaded: LoadedContent | undefined;
  const resolveLevel = (id: string) => compileLevel(loaded ??= loadContent(files), id);
  const paths: string[] = [];
  if (target === 'golden') {
    for (const directory of ['packages/sim/test/golden', 'packages/bots/test/golden']) {
      const path = resolve(root, directory);
      try { await lstat(path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' && directory.includes('/bots/')) continue; throw new LocatedError(path, (error as Error).message); }
      paths.push(...await walkFiles(path, file => file.endsWith('.json')));
    }
  } else paths.push(...await walkFiles(resolve(target), file => file.endsWith('.json')));
  if (!paths.length) throw new LocatedError(target, 'No replay JSON files found');
  const errors: Diagnostic[] = []; let verified = 0, total = 0;
  function play(rec: ReplayRecord, file: string, pointer: string, level?: CompiledLevel): void {
    total++;
    try {
      if (level && hashCompiledLevel(level) !== level.simHash) throw new Error('Embedded compiled level hash is stale');
      const result = playReplay(level ? {metadata, level} : {metadata, resolveLevel}, rec);
      if (!result.ok) throw new Error(`Replay mismatch; first diverging tick: ${result.divergingTick}`);
      verified++;
    } catch (error) { errors.push({file, pointer, message: (error as Error).message}); }
  }
  for (const file of paths) {
    try {
      const document = await readJson(file);
      if (object(document) && Object.hasOwn(document, 'header')) play(document as unknown as ReplayRecord, file, '');
      else if (object(document) && Array.isArray(document.results) && Array.isArray(document.scenarios)) {
        const bundle = document as unknown as GoldenBundle;
        if (!object(bundle.metadata) || ['rulesVersion', 'schemaVersion', 'contentVersion'].some(key => bundle.metadata[key as keyof ReplayMetadata] !== metadata[key as keyof ReplayMetadata])) throw new Error('Golden metadata differs from authoritative content metadata');
        if (!bundle.results.length) throw new Error('Golden bundle contains no replays');
        const levels = new Map<string, CompiledLevel>();
        for (const scenario of bundle.scenarios) {
          if (!object(scenario) || typeof scenario.name !== 'string' || !object(scenario.level)) throw new Error('Malformed golden scenario');
          if (levels.has(scenario.name)) throw new Error(`Duplicate golden scenario ${scenario.name}`);
          levels.set(scenario.name, scenario.level);
        }
        for (const [i, entry] of bundle.results.entries()) {
          if (!object(entry) || typeof entry.name !== 'string' || !Object.hasOwn(entry, 'replay')) throw new Error('Malformed golden result');
          const level = levels.get(entry.name);
          if (!level) throw new Error(`Missing golden compiled level for ${entry.name}`);
          play(entry.replay, file, `/results/${i}/replay`, level);
        }
      } else if (object(document) && Object.hasOwn(document, 'replay')) play(document.replay as ReplayRecord, file, '/replay');
      else if (!file.endsWith('.replay.json') && object(document) && Array.isArray(document.commands) && !['checkpoints', 'finalTick', 'finalHash', 'outcome'].some(key => Object.hasOwn(document, key))) {
        // Command-only golden logs are checked by bots:golden, not replay playback.
      } else throw new Error('JSON file contains no recognized replay record or golden bundle');
    } catch (error) { errors.push({ file, pointer: '', message: (error as Error).message }); }
  }
  if (!total && !errors.length) errors.push({file: target, pointer: '', message: 'No replay records found'});
  return { summary: `${verified} replays verified of ${total}; header, checkpoints and final hash checked without running bots.`, errors };
}
