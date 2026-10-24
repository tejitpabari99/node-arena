import type { ContentIssue } from '@node-arena/content';
import type { LevelDoc } from './document.js';
export interface LevelListing { id: string; name: string }

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`/__editor/${path}`, { cache: 'no-store' });
  if (!response.ok) {
    const body = await response.json() as { error?: string };
    throw new Error(body.error ?? `Editor request failed (${response.status})`);
  }
  return await response.json() as T;
}
export const listLevels = (): Promise<LevelListing[]> => get('levels');
export const readLevel = (id: string): Promise<LevelDoc> => get(`level/${encodeURIComponent(id)}`);

export class EditorApiError extends Error {
  constructor(message: string, readonly issues: ContentIssue[] = []) { super(message); }
}
export async function saveLevel(level: LevelDoc): Promise<{ level: LevelDoc; warnings: ContentIssue[] }> {
  const response = await fetch('/__editor/save', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NA-Editor': '1' },
    body: JSON.stringify({ id: level.id, level }),
  });
  const body = await response.json() as { level: LevelDoc; warnings: ContentIssue[]; error?: string; issues?: ContentIssue[] };
  if (!response.ok) throw new EditorApiError(body.error ?? `Save failed (${response.status})`, body.issues);
  return body;
}
