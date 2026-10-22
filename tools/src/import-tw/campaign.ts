// Campaign order from the remote-config defaults JSON: position = 1-based index in game_settings.levels
// (tutorials occupy 1-3, so `LevelView 1` is position 4).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CampaignEntry } from './types.js';
import { REMOTE_CONFIG_FILE } from './env.js';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Parse the remote-config JSON text (`game_settings.levels` is a JSON-encoded string holding `{levels:[{id,isTutor?}]}`). */
export function parseCampaign(text: string): CampaignEntry[] {
  const root: unknown = JSON.parse(text.replace(/^﻿/, ''));
  const settings = isRecord(root) ? root['game_settings'] : undefined;
  if (!isRecord(settings)) throw new Error('remote config: game_settings missing');
  let levels: unknown = settings['levels'];
  if (typeof levels === 'string') levels = JSON.parse(levels);
  if (isRecord(levels)) levels = levels['levels'];
  if (!Array.isArray(levels)) throw new Error('remote config: game_settings.levels is not a list');
  const entries: CampaignEntry[] = [];
  const seen = new Set<string>();
  levels.forEach((raw: unknown, index) => {
    if (!isRecord(raw) || typeof raw['id'] !== 'string' || raw['id'] === '') {
      throw new Error(`remote config: levels[${index}] has no string id`);
    }
    const id = raw['id'];
    if (seen.has(id)) throw new Error(`remote config: duplicate level id ${JSON.stringify(id)} at position ${index + 1}`);
    seen.add(id);
    entries.push({ id, position: index + 1, isTutor: raw['isTutor'] === true });
  });
  return entries;
}

export function readCampaign(extractRoot: string): CampaignEntry[] {
  return parseCampaign(readFileSync(join(extractRoot, REMOTE_CONFIG_FILE), 'utf8'));
}

/** Entries for an inclusive 1-based position range (e.g. 4-23). */
export function campaignRange(entries: readonly CampaignEntry[], from: number, to: number): CampaignEntry[] {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) throw new Error(`bad campaign range ${from}-${to}`);
  const out = entries.filter((e) => e.position >= from && e.position <= to);
  if (out.length !== to - from + 1) throw new Error(`campaign range ${from}-${to}: list has only ${entries.length} entries`);
  return out;
}

// ---- committed campaign file (data/campaigns/common.json): merge, never rebuild --------------------------------

/** A level whose id starts with this prefix is hand-authored: the importer never rewrites or removes its campaign entry. */
export const HAND_AUTHORED_PREFIX = 'na-';
export const isHandAuthored = (level: string): boolean => level.startsWith(HAND_AUTHORED_PREFIX);

export interface CampaignFileEntry { level: string; position: number; [extra: string]: unknown }
export interface CampaignDoc { entries: CampaignFileEntry[]; [extra: string]: unknown }

/** Parse the committed common.json text (shape-checked; extra keys are preserved for the merge). */
export function parseCampaignDoc(text: string, label = 'common.json'): CampaignDoc {
  const doc: unknown = JSON.parse(text);
  if (!isRecord(doc) || !Array.isArray(doc['entries'])) throw new Error(`${label}: "entries" array missing`);
  const seen = new Set<number>();
  doc['entries'].forEach((e: unknown, i) => {
    if (!isRecord(e) || typeof e['level'] !== 'string' || !Number.isInteger(e['position'])) throw new Error(`${label}: entries[${i}] needs a string level and an integer position`);
    if (seen.has(e['position'] as number)) throw new Error(`${label}: duplicate position ${String(e['position'])}`);
    seen.add(e['position'] as number);
  });
  return doc as CampaignDoc;
}

export interface MergeRow { slug: string; position: number; importable: boolean }
export interface MergeOptions {
  skipBlocked: boolean;
  /** The whole TW campaign (tutorials included): positions below the first playable level count as contiguous. */
  campaign: readonly CampaignEntry[];
}

/**
 * Merge importer output into the committed campaign by position (PRD 05 R5).
 * - Entries the importer does not own (hand-authored `na-*`) are always kept; an importer row landing on one is an error.
 * - Importer-owned entries at the positions processed this run are replaced; entries at other positions are kept.
 * - Without `skipBlocked`, a blocked row, or a row that would leave a gap relative to the merged campaign, ends the run
 *   (that row and the rest are not touched). With `skipBlocked` blocked rows are removed and later rows still apply.
 */
export function mergeCampaign(existing: readonly CampaignFileEntry[], rows: readonly MergeRow[], o: MergeOptions): CampaignFileEntry[] {
  const byPos = new Map(existing.map((e) => [e.position, e] as const));
  const firstPlayable = Math.min(...o.campaign.filter((c) => !c.isTutor).map((c) => c.position), Number.POSITIVE_INFINITY);
  const sorted = [...rows].sort((a, b) => a.position - b.position);
  for (const r of sorted) {
    const held = byPos.get(r.position);
    if (held && isHandAuthored(held.level)) {
      if (r.importable) throw new Error(`campaign position ${r.position} is held by hand-authored ${JSON.stringify(held.level)}; importer will not overwrite it`);
      continue;
    }
    if (!r.importable) {
      if (!o.skipBlocked) break;
      byPos.delete(r.position);
      continue;
    }
    if (!o.skipBlocked && r.position > firstPlayable && !byPos.has(r.position - 1)) break;
    const prev = held ?? { level: r.slug, position: r.position };
    byPos.set(r.position, { ...prev, level: r.slug, position: r.position });
  }
  return [...byPos.values()].sort((a, b) => a.position - b.position);
}
