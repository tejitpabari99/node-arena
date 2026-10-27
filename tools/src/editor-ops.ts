import { lstat, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ContentLoadError, loadCatalog, loadContent, type ContentIssue, type ManifestV2, type NextCampaign, type NextLevel } from '@node-arena/content';
import { validateEditorDocument } from './editor-validation.js';
import { loadFiles } from './files.js';
import { serializeCampaign, serializeLevel } from './import-tw/serialize.js';

export class EditorSaveError extends Error {
  constructor(readonly status: number, message: string, readonly issues: ContentIssue[] = []) { super(message); }
}
export interface EditorSaveResult { level: NextLevel; warnings: ContentIssue[]; changed: boolean }
const pending = new Map<string, Promise<unknown>>();
const missing = (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT';
async function optionalText(path: string): Promise<string | undefined> {
  try { return await readFile(path, 'utf8'); } catch (error) { if (missing(error)) return undefined; throw error; }
}
async function regularTarget(path: string): Promise<void> {
  try { if (!(await lstat(path)).isFile()) throw new EditorSaveError(403, 'Save target must be a regular file'); }
  catch (error) { if (!missing(error)) throw error; }
}

/** Shared save seam for future jobs: synchronous content checks only, never proxy matches or shell commands. */
export async function saveEditorLevel(contentDir: string, id: string, input: unknown, copy = false): Promise<EditorSaveResult> {
  if (!/^na-[a-z0-9-]{1,40}$/.test(id)) throw new EditorSaveError(400, 'Invalid writable level id');
  return queued(contentDir, root => save(root, id, input, copy));
}

async function queued<T>(contentDir: string, operation: (root: string) => Promise<T>): Promise<T> {
  const root = await realpath(contentDir);
  const previous = pending.get(root) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(() => operation(root));
  pending.set(root, current);
  try { return await current; } finally { if (pending.get(root) === current) pending.delete(root); }
}

/** Allocate and save under the same root queue, without re-entering the queued save API. */
export async function duplicateEditorLevel(contentDir: string, sourceId: string): Promise<Pick<EditorSaveResult, 'level' | 'warnings'>> {
  if (!/^(?:na-[a-z0-9-]{1,40}|levelview-[a-z0-9-]+)$/.test(sourceId)) throw new EditorSaveError(400, 'Invalid source level id');
  return queued(contentDir, async root => {
    const sourceTarget = resolve(root, `data/levels/${sourceId}.json`);
    if (await realpath(dirname(sourceTarget)) !== dirname(sourceTarget)) throw new EditorSaveError(403, 'Level directories must not be symlinks');
    const info = await lstat(sourceTarget);
    if (!info.isFile()) throw new EditorSaveError(403, 'Source must be a regular file');
    if (info.size > 1024 * 1024) throw new EditorSaveError(413, 'Level exceeds 1 MiB');
    const source = JSON.parse(await readFile(sourceTarget, 'utf8')) as NextLevel;
    if (!source || source.id !== sourceId || typeof source.name !== 'string') throw new EditorSaveError(422, 'Invalid level identity');
    const files = await loadFiles(root);
    const reserved = new Set<string>();
    for (const [file, text] of Object.entries(files)) {
      if (file.startsWith('data/campaigns/') && file.endsWith('.json')) {
        const campaign = (typeof text === 'string' ? JSON.parse(text) : text) as NextCampaign;
        for (const entry of campaign.entries) reserved.add(entry.level);
      }
    }
    const base = sourceId.startsWith('na-') ? sourceId.slice(3) : sourceId;
    for (let index = 1; ; index++) {
      const suffix = index === 1 ? '-copy' : `-copy-${index}`;
      const stem = base.slice(0, 40 - suffix.length).replace(/-+$/, '');
      const id = `na-${stem}${suffix}`;
      if (reserved.has(id)) continue;
      try { await lstat(resolve(root, `data/levels/${id}.json`)); continue; }
      catch (error) { if (!missing(error)) throw error; }
      const { level, warnings } = await save(root, id, source, true);
      return { level, warnings };
    }
  });
}

async function save(root: string, id: string, input: unknown, copy: boolean): Promise<EditorSaveResult> {
  const file = `data/levels/${id}.json`, campaignFile = 'data/campaigns/custom.json';
  const target = resolve(root, file), campaignTarget = resolve(root, campaignFile);
  // Refuse symlinked parent directories as well as file aliases.
  for (const path of [dirname(target), dirname(campaignTarget)]) if (await realpath(path) !== path) throw new EditorSaveError(403, 'Save directories must not be symlinks');
  await regularTarget(target); await regularTarget(campaignTarget);
  const originalLevel = await optionalText(target), originalCampaign = await optionalText(campaignTarget);
  const { 'content.json': _meta, ...files } = await loadFiles(root);
  const manifest = JSON.parse(await readFile(new URL('../../apps/web/assets/manifest.json', import.meta.url), 'utf8')) as ManifestV2;
  const options = { themes: Object.keys(manifest.themes), colorKeys: Object.keys(manifest.palettes) };
  const catalog = loadCatalog(files, options);
  // The client never owns this metadata, including its shape during validation.
  const candidate = structuredClone(input);
  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) delete (candidate as Record<string, unknown>).editorVersion;
  const { level: authored, warnings } = validateEditorDocument(catalog, candidate, id, copy);
  const onDisk = originalLevel === undefined ? undefined : JSON.parse(originalLevel) as NextLevel;
  const contentText = (level: NextLevel) => {
    const { editorVersion: _version, ...content } = level;
    return serializeLevel(content);
  };
  const changed = onDisk === undefined || contentText(authored) !== contentText(onDisk);
  if (changed) {
    const [major, minor, patch] = (onDisk?.editorVersion ?? '0.0.0').split('.');
    authored.editorVersion = `${major}.${minor}.${BigInt(patch!) + 1n}`;
  }
  let campaign: NextCampaign;
  if (originalCampaign === undefined) campaign = { $schema: '../../schemas/campaign.schema.json', schemaVersion: '2.0.0', id: 'custom', entries: [] };
  else campaign = JSON.parse(originalCampaign) as NextCampaign;
  const campaignChanged = !campaign.entries.some(entry => entry.level === id);
  if (campaignChanged) campaign.entries.push({ level: id, position: Math.max(0, ...campaign.entries.map(entry => entry.position)) + 1 });
  const positions = new Set<number>();
  for (const entry of campaign.entries) {
    if (positions.has(entry.position)) throw new ContentLoadError([{ file: campaignFile, pointer: '/entries', message: 'Campaign positions must be unique' }]);
    positions.add(entry.position);
  }
  const levelText = changed ? serializeLevel(authored as unknown as Record<string, unknown>) : originalLevel!;
  const campaignText = serializeCampaign(campaign as unknown as Record<string, unknown>);
  // Validate the entire staged dataset (including campaign refs) before the first write.
  loadContent({ ...files, [file]: levelText, [campaignFile]: campaignText }, options);
  const token = randomUUID(), levelTemp = `${target}.${token}.tmp`, campaignTemp = `${campaignTarget}.${token}.tmp`;
  let levelWritten = false;
  const unchanged = async () => {
    await regularTarget(target); await regularTarget(campaignTarget);
    if (await optionalText(target) !== originalLevel || await optionalText(campaignTarget) !== originalCampaign) throw new EditorSaveError(409, 'Content changed during Save; reopen and retry');
  };
  if (!changed && !campaignChanged) {
    await unchanged();
    return { level: onDisk!, warnings, changed };
  }
  try {
    if (changed) await writeFile(levelTemp, levelText, { flag: 'wx' });
    await writeFile(campaignTemp, campaignText, { flag: 'wx' });
    await unchanged();
    if (changed) { await rename(levelTemp, target); levelWritten = true; }
    // A sibling writer's new campaign must never be replaced by our earlier snapshot.
    if (await optionalText(campaignTarget) !== originalCampaign) throw new EditorSaveError(409, 'Custom campaign changed during Save; retry');
    await rename(campaignTemp, campaignTarget);
  } catch (error) {
    if (levelWritten && await optionalText(target) === levelText) {
      if (originalLevel === undefined) await rm(target);
      else { await writeFile(levelTemp, originalLevel); await rename(levelTemp, target); }
    }
    throw error;
  } finally { await rm(levelTemp, { force: true }); await rm(campaignTemp, { force: true }); }
  return { level: JSON.parse(levelText) as NextLevel, warnings, changed };
}
