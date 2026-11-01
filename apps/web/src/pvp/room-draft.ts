import type { SeatConfig } from '@node-arena/net';
import type { PvpMapInfo } from '@node-arena/content';

export type RoomType = 'pvp' | 'team';
export type RowKind = 'human' | 'bot';
export type Difficulty = 'easy' | 'normal' | 'hard';
export interface DraftRow { kind: RowKind; difficulty: Difficulty; team: number }
/** Pre-room create form state. rows.length === players; row 0 is the host (always human). */
export interface CreateDraft { type: RoomType; mapId: string; players: number; teams: number; rows: DraftRow[] }

export const MIN_PLAYERS = 2, MAX_PLAYERS = 8, MIN_TEAMS = 2, MAX_TEAMS = 4;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.trunc(Number.isFinite(n) ? n : lo)));

export const playersMax = (map: Pick<PvpMapInfo, 'maxPlayers'>): number => Math.max(MIN_PLAYERS, Math.min(map.maxPlayers, MAX_PLAYERS));
export const teamsMax = (players: number): number => Math.max(MIN_TEAMS, Math.min(MAX_TEAMS, players));
/** Default team for row i: identity in PvP, round-robin in Team. */
export const defaultTeam = (i: number, type: RoomType, teams: number): number => type === 'pvp' ? i : i % teams;
const humanRow = (i: number, type: RoomType, teams: number): DraftRow => ({ kind: 'human', difficulty: 'normal', team: defaultTeam(i, type, teams) });

/** Normalises any draft against its map: clamps players/teams, resizes rows, host human, valid teams. */
export function clampDraft(d: CreateDraft, map: Pick<PvpMapInfo, 'maxPlayers'>): CreateDraft {
  const players = clamp(d.players, MIN_PLAYERS, playersMax(map));
  const teams = clamp(d.teams, MIN_TEAMS, teamsMax(players));
  const rows = Array.from({ length: players }, (_, i): DraftRow => {
    const r = d.rows[i];
    if (!r) return humanRow(i, d.type, teams);
    const row: DraftRow = { kind: i === 0 ? 'human' : r.kind, difficulty: r.difficulty, team: d.type === 'pvp' ? i : clamp(r.team, 0, teams - 1) };
    return row;
  });
  return { type: d.type, mapId: d.mapId, players, teams, rows };
}

/** Defaults: PvP, first map, 2 players, host + one Open human row. */
export function newDraft(maps: readonly PvpMapInfo[]): CreateDraft | null {
  const m = maps[0];
  return m ? clampDraft({ type: 'pvp', mapId: m.id, players: MIN_PLAYERS, teams: MIN_TEAMS, rows: [] }, m) : null;
}

export function setType(d: CreateDraft, type: RoomType, map: PvpMapInfo): CreateDraft {
  const rows = d.rows.map((r, i) => ({ ...r, team: defaultTeam(i, type, d.teams) }));
  return clampDraft({ ...d, type, rows }, map);
}
/** Map change keeps players/teams/rows where valid, clamping to the new map. */
export function setMap(d: CreateDraft, map: PvpMapInfo): CreateDraft { return clampDraft({ ...d, mapId: map.id }, map); }
export function setPlayers(d: CreateDraft, players: number, map: PvpMapInfo): CreateDraft { return clampDraft({ ...d, players }, map); }
export function setTeams(d: CreateDraft, teams: number, map: PvpMapInfo): CreateDraft {
  // Reassign round-robin so shrinking/growing stays balanced; keep explicit picks that still fit.
  const t = clamp(teams, MIN_TEAMS, teamsMax(d.players));
  return clampDraft({ ...d, teams: t, rows: d.rows.map((r) => r.team < t ? r : { ...r, team: r.team % t }) }, map);
}
export function setRow(d: CreateDraft, index: number, patch: Partial<DraftRow>, map: PvpMapInfo): CreateDraft {
  if (index < 1 || index >= d.rows.length) return d;
  return clampDraft({ ...d, rows: d.rows.map((r, i) => i === index ? { ...r, ...patch } : r) }, map);
}

/** "Bot1", "Bot2"... numbered by order among bot rows; null for human rows. */
export function botLabels(rows: readonly Pick<DraftRow, 'kind'>[]): Array<string | null> {
  let n = 0;
  return rows.map((r) => r.kind === 'bot' ? `Bot${++n}` : null);
}

export function draftToSeats(d: CreateDraft, map: PvpMapInfo): SeatConfig[] {
  const c = clampDraft(d, map);
  return c.rows.map((r, i): SeatConfig => r.kind === 'bot'
    ? { kind: 'bot', difficulty: r.difficulty, team: c.type === 'pvp' ? i : r.team }
    : { kind: 'human', team: c.type === 'pvp' ? i : r.team });
}

/** Team iff any two seats share a team (D3). */
export function deriveType(seats: readonly Pick<SeatConfig, 'team'>[]): RoomType {
  return new Set(seats.map((s) => s.team)).size < seats.length ? 'team' : 'pvp';
}

const isDifficulty = (x: unknown): x is Difficulty => x === 'easy' || x === 'normal' || x === 'hard';
/** Live round trip: lobby state -> draft. Empty seats (no longer offered) are read as open human rows. */
export function seatsToDraft(lobby: { levelId: string; seats: readonly SeatConfig[] }, map: PvpMapInfo): CreateDraft {
  const type = deriveType(lobby.seats);
  const rows: DraftRow[] = lobby.seats.map((s) => ({ kind: s.kind === 'bot' ? 'bot' : 'human', difficulty: isDifficulty(s.difficulty) ? s.difficulty : 'normal', team: s.team }));
  const teams = type === 'team' ? new Set(lobby.seats.map((s) => s.team)).size : MIN_TEAMS;
  return clampDraft({ type, mapId: lobby.levelId, players: rows.length, teams, rows }, map);
}

/** Team type needs at least 2 distinct teams in use (PvP is always satisfied with >=2 players). */
export const distinctTeams = (d: CreateDraft): number => new Set(d.type === 'pvp' ? d.rows.map((_, i) => i) : d.rows.map((r) => r.team)).size;
export const canCreate = (d: CreateDraft): boolean => distinctTeams(d) >= 2;

type LiveSeat = { kind: string; occupant?: unknown };
/** "-" Players is locked while the last row is held by another human (host row 0 never counts). */
export const lastRowHeld = (seats: readonly LiveSeat[]): boolean => {
  const i = seats.length - 1;
  return i > 0 && seats[i]!.kind === 'human' && !!seats[i]!.occupant;
};
/** Players moved to spectators between two lobby states: occupied seats lost AND spectators gained. */
export function movedToSpectators<S extends LiveSeat>(prev: { seats: readonly S[]; spectators: number } | null, next: { seats: readonly S[]; spectators: number }): number {
  if (!prev) return 0;
  const occ = (s: readonly S[]) => s.filter((x) => x.occupant).length;
  return Math.max(0, Math.min(occ(prev.seats) - occ(next.seats), next.spectators - prev.spectators));
}
export const movedToast = (n: number): string => `${n} player${n === 1 ? '' : 's'} moved to spectators`;
