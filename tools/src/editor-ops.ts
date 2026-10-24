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
export interface EditorSaveResult { level: NextLevel; warnings: ContentIssue[] }
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
  const root = await realpath(contentDir);
  const previous = pending.get(root) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(() => save(root, id, input, copy));
  pending.set(root, current);
  try { return await current; } finally { if (pending.get(root) === current) pending.delete(root); }
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
  const { level: authored, warnings } = validateEditorDocument(catalog, input, id, copy);
  let campaign: NextCampaign;
  if (originalCampaign === undefined) campaign = { $schema: '../../schemas/campaign.schema.json', schemaVersion: '2.0.0', id: 'custom', entries: [] };
  else campaign = JSON.parse(originalCampaign) as NextCampaign;
  if (!campaign.entries.some(entry => entry.level === id)) campaign.entries.push({ level: id, position: Math.max(0, ...campaign.entries.map(entry => entry.position)) + 1 });
  const positions = new Set<number>();
  for (const entry of campaign.entries) {
    if (positions.has(entry.position)) throw new ContentLoadError([{ file: campaignFile, pointer: '/entries', message: 'Campaign positions must be unique' }]);
    positions.add(entry.position);
  }
  const levelText = serializeLevel(authored as unknown as Record<string, unknown>);
  const campaignText = serializeCampaign(campaign as unknown as Record<string, unknown>);
  // Validate the entire staged dataset (including campaign refs) before the first write.
  loadContent({ ...files, [file]: levelText, [campaignFile]: campaignText }, options);
  const token = randomUUID(), levelTemp = `${target}.${token}.tmp`, campaignTemp = `${campaignTarget}.${token}.tmp`;
  let levelWritten = false;
  const unchanged = async () => {
    await regularTarget(target); await regularTarget(campaignTarget);
    if (await optionalText(target) !== originalLevel || await optionalText(campaignTarget) !== originalCampaign) throw new EditorSaveError(409, 'Content changed during Save; reopen and retry');
  };
  try {
    await writeFile(levelTemp, levelText, { flag: 'wx' });
    await writeFile(campaignTemp, campaignText, { flag: 'wx' });
    await unchanged();
    await rename(levelTemp, target); levelWritten = true;
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
  return { level: JSON.parse(levelText) as NextLevel, warnings };
}
