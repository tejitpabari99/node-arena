import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalJson, checkContentVersion, generateHashes, loadContent, parseContentMeta } from '@node-arena/content';
import { checkBotVersion, readBotVersion } from '../../packages/content/scripts/bot-version.js';
import { loadFiles } from './files.js';
import { readBaseline, splitFiles } from './content.js';
import { prepareEditorProxy } from './editor-solvable.js';
import { playProxy, validateLevel } from './levels.js';
import { readUnsolved } from './unsolved.js';
import { runEditorCommand } from './editor-finalize.js';

const root = process.cwd(), contentDir = resolve(root, 'packages/content');
const [step, id] = process.argv.slice(2);
const bumpPatch = (version: string) => { const parts = version.split('.').map(Number); return `${parts[0]}.${parts[1]}.${parts[2]! + 1}`; };
try {
  if (!id || !/^na-[a-z0-9-]{1,40}$/.test(id)) throw new Error('Invalid writable level id');
  if (step === 'validate') {
    const level = JSON.parse(await readFile(resolve(contentDir, 'data/levels', `${id}.json`), 'utf8'));
    const input = await prepareEditorProxy(contentDir, id, level);
    const unsolved = (await readUnsolved(resolve(root, 'tools/unsolved-by-proxy.json'))).find(entry => entry.id === id) ?? null;
    const report = validateLevel(input.level, undefined, 4, unsolved, undefined, (...args) => {
      const run = playProxy(...args); console.log(`${run.proxy} seed ${run.seed}: ${run.outcome}, ${run.ticks} ticks`); return run;
    });
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  } else if (step === 'sim:golden' || step === 'bots:golden') {
    // Authoring always compares with HEAD, independent of an enclosing CI baseline.
    process.env.VERSION_GUARD_BASE = 'HEAD';
    process.env.SIM_GOLDEN_BASE_REF = 'HEAD';
    const output = (text: string) => process.stdout.write(text);
    const checked = await runEditorCommand(root, 'pnpm', [step], output);
    if (checked !== 0) {
      const updated = await runEditorCommand(root, 'pnpm', [step, '--update'], output);
      if (updated !== 0) process.exitCode = updated;
    }
  } else {
    const { meta, data } = splitFiles(await loadFiles(contentDir));
    const metadata = parseContentMeta(meta), hashes = generateHashes(loadContent(data)), baseline = readBaseline(root, 'HEAD');
    if (step === 'contentVersion') {
      try { checkContentVersion(metadata, hashes, baseline); console.log(`contentVersion ${metadata.contentVersion}: no bump required vs HEAD`); }
      catch (error) {
        if (!baseline || metadata.contentVersion !== baseline.metadata.contentVersion) throw error;
        metadata.contentVersion = bumpPatch(metadata.contentVersion);
        checkContentVersion(metadata, hashes, baseline);
        await writeFile(resolve(contentDir, 'content.json'), JSON.stringify(metadata, null, 2) + '\n');
        console.log(`contentVersion → ${metadata.contentVersion}`);
      }
    } else if (step === 'BOT_VERSION') {
      const current = readBotVersion(root), previous = readBotVersion(root, 'HEAD');
      const envelopeChanged = baseline && metadata.contentVersion !== baseline.metadata.contentVersion;
      try {
        checkBotVersion(hashes.bots, baseline?.hashes.bots, current, previous);
        if (envelopeChanged && current === previous) throw new Error('Bot replay envelopes require a BOT_VERSION bump');
        console.log(`BOT_VERSION ${current}: no bump required vs HEAD`);
      }
      catch (error) {
        if (!current || current !== previous || !baseline || (!envelopeChanged && canonicalJson(hashes.bots) === canonicalJson(baseline.hashes.bots))) throw error;
        const next = bumpPatch(current);
        checkBotVersion(hashes.bots, baseline.hashes.bots, next, previous);
        const file = resolve(root, 'packages/bots/src/version.ts'), source = await readFile(file, 'utf8');
        await writeFile(file, source.replace(/(export\s+const\s+BOT_VERSION\s*=\s*['"])[^'"]+(['"])/, `$1${next}$2`));
        console.log(`BOT_VERSION → ${next}`);
      }
    } else throw new Error('Unknown Finalize step');
  }
} catch (error) { console.error(error); process.exitCode = 1; }
