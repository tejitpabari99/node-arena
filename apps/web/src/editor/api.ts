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
