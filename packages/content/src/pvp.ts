import type { Catalog } from './catalog.js';
import type { CompiledLevel } from './compile.js';

export interface PvpMapInfo {
  id: string; name: string; seats: number;
  /** Team id per seat (dense); identity when the level authors no teams. */
  teams: number[];
  timeLimitSec: number | null; theme: string;
}

/** Authoritative PvP map list (server validation + lobby picker): `campaigns/pvp.json` order, compiled defaults. */
export function listPvpMaps(content: { catalog: Pick<Catalog, 'campaigns'>; levels: Record<string, { level: { name: string } }>; compiled: Record<string, CompiledLevel> }): PvpMapInfo[] {
  const campaign = content.catalog.campaigns['pvp'];
  if (!campaign) return [];
  return campaign.entries.map((e) => {
    const c = content.compiled[e.level];
    const l = content.levels[e.level];
    if (!c || !l) throw new Error(`listPvpMaps: unknown level "${e.level}"`);
    return {
      id: c.id, name: l.level.name, seats: c.players.length,
      teams: c.players.map((p, i) => p.team ?? i),
      timeLimitSec: c.timeLimitSec, theme: c.theme,
    };
  });
}
