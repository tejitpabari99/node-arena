import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compileLevel, loadCatalog, loadLevel, type CompiledLevel, type ManifestV2 } from '@node-arena/content';
import { loadFiles } from './files.js';
import { validateEditorDocument } from './editor-validation.js';
import type { LevelReport, LevelRunReport } from './levels.js';
import { readUnsolved, type UnsolvedEntry } from './unsolved.js';

export type EditorProxyEvent = { type: 'started'; id: string } | { type: 'progress'; run: LevelRunReport } | { type: 'result'; report: LevelReport } | { type: 'error'; error: string };
export interface EditorProxyInput { level: CompiledLevel; unsolved: UnsolvedEntry | null }
export type EditorProxyRunner = (input: EditorProxyInput, emit: (event: EditorProxyEvent) => void, signal: AbortSignal) => Promise<void>;

/** Compile the working copy only. Never save it or change campaign membership. */
export async function prepareEditorProxy(contentDir: string, id: string, input: unknown): Promise<EditorProxyInput> {
  const { 'content.json': _meta, ...files } = await loadFiles(contentDir);
  const manifest = JSON.parse(await readFile(new URL('../../apps/web/assets/manifest.json', import.meta.url), 'utf8')) as ManifestV2;
  const catalog = loadCatalog(files, { themes: Object.keys(manifest.themes), colorKeys: Object.keys(manifest.palettes) });
  const checked = validateEditorDocument(catalog, input, id);
  const level = compileLevel(catalog, loadLevel(catalog, checked.level).level);
  const unsolved = (await readUnsolved(fileURLToPath(new URL('../unsolved-by-proxy.json', import.meta.url)))).find(entry => entry.id === id) ?? null;
  return { level, unsolved };
}

/** Fixed executable/argv, JSON stdin: authored text never becomes a process argument or shell code. */
export const runEditorProxy: EditorProxyRunner = (input, emit, signal) => new Promise((resolve, reject) => {
  const require = createRequire(import.meta.url);
  const child = execFile(process.execPath, ['--import', require.resolve('tsx'), fileURLToPath(new URL('./editor-proxy-worker.ts', import.meta.url))], { maxBuffer: 1024 * 1024 });
  let pending = '', result = false, failure: Error | undefined;
  const abort = () => { child.kill(); };
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  child.stdout!.on('data', (chunk: Buffer | string) => {
    pending += String(chunk);
    let newline: number;
    while ((newline = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
      try {
        const event = JSON.parse(line) as EditorProxyEvent;
        if (event.type === 'result') result = true;
        if (event.type === 'error') failure = new Error(event.error);
        if (!signal.aborted) emit(event);
      } catch { failure = new Error('Invalid proxy output'); child.kill(); }
    }
  });
  child.stdin!.on('error', () => { /* close/error below settles the job */ });
  child.on('error', error => { failure = error; });
  child.on('close', code => {
    signal.removeEventListener('abort', abort);
    if (signal.aborted) reject(new Error('Proxy check cancelled'));
    else if (failure || code !== 0 || !result) reject(failure ?? new Error('Proxy check failed'));
    else resolve();
  });
  child.stdin!.end(JSON.stringify(input));
});
