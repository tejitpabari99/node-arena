import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';
import { ContentLoadError } from '@node-arena/content';
import { EditorSaveError, saveEditorLevel } from '../../../../tools/src/editor-ops.js';

const MAX_BYTES = 1024 * 1024;
const WRITABLE_ID = /^na-[a-z0-9-]{1,40}$/;
const READABLE_ID = /^(?:na-[a-z0-9-]{1,40}|levelview-[a-z0-9-]+)$/;
export const isWritableLevelId = (id: string): boolean => WRITABLE_ID.test(id);

export class EditorHttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** Reused by future write endpoints: never accept a filesystem path from the browser. */
export async function editorLevelPath(levelsDir: string, id: string, writable = false): Promise<string> {
  if (!(writable ? WRITABLE_ID : READABLE_ID).test(id)) throw new EditorHttpError(400, 'Invalid level id');
  const root = await realpath(levelsDir);
  const path = resolve(root, `${id}.json`);
  const inside = (candidate: string) => {
    const rel = relative(root, candidate);
    return rel !== '' && rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel);
  };
  if (!inside(path)) throw new EditorHttpError(400, 'Level path escapes levels directory');
  try {
    const target = await realpath(path);
    if (!inside(target)) throw new EditorHttpError(403, 'Level path escapes levels directory');
    if (writable && target !== path) throw new EditorHttpError(403, 'Writable level path must not be a symlink');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  return path;
}

/** Loopback binding plus Host validation blocks DNS rebinding. POST also requires an exact Origin. */
export function checkEditorRequest(req: IncomingMessage): void {
  const host = req.headers.host;
  if (!host || !/^(localhost|127\.0\.0\.1)(?::[0-9]{1,5})?$/i.test(host)) {
    throw new EditorHttpError(403, 'Editor requires a localhost Host');
  }
  if (req.method === 'POST' && (req.headers['x-na-editor'] !== '1' || req.headers.origin !== `http://${host}`)) {
    throw new EditorHttpError(403, 'Editor POST requires X-NA-Editor: 1 and same Origin');
  }
}

/** Bounded streaming read also covers chunked requests (Content-Length alone is insufficient). */
export async function readEditorBody(req: IncomingMessage): Promise<string> {
  if (Number(req.headers['content-length']) > MAX_BYTES) throw new EditorHttpError(413, 'Editor body exceeds 1 MiB');
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_BYTES) throw new EditorHttpError(413, 'Editor body exceeds 1 MiB');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(value));
}

export function createEditorMiddleware(levelsDir: string): Connect.NextHandleFunction {
  async function readLevel(id: string): Promise<{ id: string; name: string }> {
    const path = await editorLevelPath(levelsDir, id);
    if ((await stat(path)).size > MAX_BYTES) throw new EditorHttpError(413, 'Level exceeds 1 MiB');
    const level = JSON.parse(await readFile(path, 'utf8')) as { id: string; name: string };
    if (level.id !== id || typeof level.name !== 'string') throw new EditorHttpError(422, 'Invalid level identity');
    return level;
  }
  return (req, res, next) => {
    const path = (req.url ?? '').split('?')[0]!;
    if (path !== '/__editor' && !path.startsWith('/__editor/')) { next(); return; }
    void (async () => {
      checkEditorRequest(req);
      if (req.method === 'POST') {
        const body = await readEditorBody(req);
        if (path === '/__editor/save') {
          let value: { id?: unknown; level?: unknown; copy?: unknown };
          try { value = JSON.parse(body) as typeof value; }
          catch { throw new EditorHttpError(400, 'Invalid JSON'); }
          if (!value || typeof value.id !== 'string' || (value.copy !== undefined && typeof value.copy !== 'boolean')) throw new EditorHttpError(400, 'Save requires an id, level and optional copy flag');
          await editorLevelPath(levelsDir, value.id, true);
          json(res, 200, await saveEditorLevel(resolve(levelsDir, '../..'), value.id, value.level, value.copy === true));
          return;
        }
      }
      if (req.method !== 'GET') throw new EditorHttpError(405, 'Editor endpoint is read-only');
      if (path === '/__editor/levels') {
        const files = (await readdir(levelsDir)).filter(file => file.endsWith('.json') && READABLE_ID.test(file.slice(0, -5))).sort();
        const levels = await Promise.all(files.map(async file => {
          const { id, name } = await readLevel(file.slice(0, -5));
          return { id, name };
        }));
        json(res, 200, levels);
      } else if (path.startsWith('/__editor/level/')) {
        let id: string;
        try { id = decodeURIComponent(path.slice('/__editor/level/'.length)); }
        catch { throw new EditorHttpError(400, 'Invalid level id'); }
        json(res, 200, await readLevel(id));
      } else throw new EditorHttpError(404, 'Unknown editor endpoint');
    })().catch((error: unknown) => {
      if (error instanceof ContentLoadError) json(res, 422, { error: 'Level validation failed', issues: error.errors });
      else if (error instanceof EditorSaveError) json(res, error.status, { error: error.message, issues: error.issues });
      else if (error instanceof EditorHttpError) json(res, error.status, { error: error.message });
      else if (error instanceof Error && 'code' in error && error.code === 'ENOENT') json(res, 404, { error: 'Level not found' });
      else json(res, 500, { error: 'Could not read editor levels' });
    });
  };
}

export function editorPlugin(levelsDir: string): Plugin {
  return {
    name: 'node-arena-editor',
    apply: 'serve',
    configureServer(server) { server.middlewares.use(createEditorMiddleware(levelsDir)); },
  };
}
