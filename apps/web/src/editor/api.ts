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

/** NDJSON arrives as runs finish; Save is independent and never called here. */
export async function checkSolvable(level: LevelDoc, onEvent: (event: import('../../../../tools/src/editor-solvable.js').EditorProxyEvent) => void, signal?: AbortSignal): Promise<void> {
  const response = await fetch('/__editor/solvable', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NA-Editor': '1' },
    body: JSON.stringify({ id: level.id, level }), signal: signal ?? null,
  });
  if (!response.ok) {
    const body = await response.json() as { error?: string; issues?: ContentIssue[] };
    throw new EditorApiError(body.error ?? `Proxy check failed (${response.status})`, body.issues);
  }
  if (!response.body) throw new Error('Proxy response has no stream');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let pending = '', complete = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      let newline: number;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
        const event = JSON.parse(line) as import('../../../../tools/src/editor-solvable.js').EditorProxyEvent;
        onEvent(event);
        if (event.type === 'error') throw new Error(event.error);
        if (event.type === 'result') complete = true;
      }
      if (done) break;
    }
    if (!complete || pending.trim()) throw new Error('Proxy stream ended without a complete result');
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

export interface FinalizeStatus { unfinalized: boolean; exitCode: number; output: string }
export const readFinalizeStatus = (): Promise<FinalizeStatus> => get('status');

export async function finalizeLevel(level: LevelDoc, onEvent: (event: import('../../../../tools/src/editor-finalize.js').EditorFinalizeEvent) => void): Promise<void> {
  const response = await fetch('/__editor/finalize', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NA-Editor': '1' },
    body: JSON.stringify({ id: level.id, level }),
  });
  if (!response.ok) {
    const body = await response.json() as { error?: string };
    throw new EditorApiError(body.error ?? `Finalize failed (${response.status})`);
  }
  if (!response.body) throw new Error('Finalize response has no stream');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let pending = '', complete = false;
  try {
    for (;;) {
      const { value, done } = await reader.read(); pending += decoder.decode(value, { stream: !done });
      let newline: number;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
        const event = JSON.parse(line) as import('../../../../tools/src/editor-finalize.js').EditorFinalizeEvent;
        onEvent(event);
        if (event.type === 'error') throw new Error(event.error);
        if (event.type === 'result') complete = true;
      }
      if (done) break;
    }
    if (!complete || pending.trim()) throw new Error('Finalize stream ended without a complete result');
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
