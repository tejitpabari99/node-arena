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
