import { describe, expect, it, vi } from 'vitest';
import type { VNode } from 'preact';
import type { PvpMapInfo } from '@node-arena/content';
import { RoomForm, type RoomFormProps } from '../../src/ui/pvp/RoomForm';
import { LevelThumb } from '../../src/ui/Picker';
import { clampDraft, newDraft, setPlayers, setType, setRow, setTeams } from '../../src/pvp/room-draft';

type N = VNode<Record<string, unknown>>;
function find(node: unknown, test: (n: N) => boolean, out: N[] = []): N[] {
  if (Array.isArray(node)) node.forEach((n) => find(n, test, out));
  else if (node && typeof node === 'object' && 'props' in node) { const n = node as N; if (test(n)) out.push(n); find(n.props.children, test, out); }
  return out;
}
const byId = (root: unknown, id: string) => find(root, (n) => n.props['data-testid'] === id)[0];
const text = (n: unknown): string => Array.isArray(n) ? n.map(text).join('') : n && typeof n === 'object' && 'props' in n ? text((n as N).props.children) : typeof n === 'string' || typeof n === 'number' ? String(n) : '';
const maps: PvpMapInfo[] = [{ id: 'duel-s', name: 'Duel S', maxPlayers: 2 } as PvpMapInfo, { id: 'cross', name: 'Cross', maxPlayers: 4 } as PvpMapInfo];
const noop = () => {};
const props = (o: Partial<RoomFormProps> = {}): RoomFormProps => ({ nick: 'Ann', draft: newDraft(maps)!, maps, onNick: noop, onType: noop, onMap: noop, onPlayers: noop, onTeams: noop, onRow: noop, onCreate: noop, ...o });
const cross = (f: (d: ReturnType<typeof newDraft> & object) => ReturnType<typeof newDraft> & object = (d) => d) => f(clampDraft({ ...newDraft(maps)!, mapId: 'cross' }, maps[1]!));

describe('RoomForm', () => {
  it('defaults: PvP, first map, 2 players, host + Open human row, + disabled on duel', () => {
    const v = RoomForm(props());
    expect(byId(v, 'type-pvp')!.props['aria-pressed']).toBe(true); expect(byId(v, 'type-team')!.props['aria-pressed']).toBe(false);
    expect(byId(v, 'map-duel-s')!.props['aria-pressed']).toBe(true);
    expect(text(byId(v, 'players-value'))).toBe('2');
    expect(byId(v, 'players-minus')!.props.disabled).toBe(true); expect(byId(v, 'players-plus')!.props.disabled).toBe(true);
    expect(byId(v, 'teams-value')).toBeUndefined();
    expect(text(byId(v, 'lobby-seat-0'))).toContain('Player 1 (you)'); expect(text(byId(v, 'lobby-seat-1'))).toContain('Open');
    expect(byId(v, 'seat-kind-0')).toBeUndefined(); expect(byId(v, 'seat-team-1')).toBeUndefined();
    expect(byId(v, 'pvp-create')!.props.disabled).toBe(false);
  });
  it('map tiles: thumbnail, name only in aria-label, no number', () => {
    const t = { request: vi.fn() } as never, v = RoomForm(props({ thumbs: t }));
    const tile = byId(v, 'map-cross')!;
    expect(tile.props['aria-label']).toBe('Cross'); expect(text(tile)).toBe('');
    expect(find(tile, (n) => n.type === LevelThumb)).toHaveLength(1);
  });
  it('cross: max 4 players; Team shows teams stepper and team selects', () => {
    let d = setType(setPlayers(cross(), 4, maps[1]!), 'team', maps[1]!);
    const v = RoomForm(props({ draft: d }));
    expect(byId(v, 'players-plus')!.props.disabled).toBe(true);
    expect(byId(v, 'teams-plus')!.props.disabled).toBe(false); expect(byId(v, 'teams-minus')!.props.disabled).toBe(true);
    for (let i = 0; i < 4; i++) expect(byId(v, `seat-team-${i}`)).toBeTruthy();
    d = setTeams(d, 4, maps[1]!); expect(byId(RoomForm(props({ draft: d })), 'teams-plus')!.props.disabled).toBe(true);
  });
  it('bot rows: label BotN, difficulty select; human stays Open', () => {
    let d = setPlayers(cross(), 4, maps[1]!);
    d = setRow(setRow(d, 1, { kind: 'bot' }, maps[1]!), 3, { kind: 'bot' }, maps[1]!);
    const v = RoomForm(props({ draft: d }));
    expect(text(byId(v, 'lobby-seat-1'))).toContain('Bot1'); expect(text(byId(v, 'lobby-seat-2'))).toContain('Open'); expect(text(byId(v, 'lobby-seat-3'))).toContain('Bot2');
    expect(byId(v, 'seat-difficulty-1')).toBeTruthy(); expect(byId(v, 'seat-difficulty-2')).toBeUndefined();
  });
  it('wires callbacks', () => {
    const o = { onType: vi.fn(), onMap: vi.fn(), onPlayers: vi.fn(), onTeams: vi.fn(), onRow: vi.fn(), onCreate: vi.fn() };
    const d = setType(setPlayers(cross(), 3, maps[1]!), 'team', maps[1]!);
    const v = RoomForm(props({ draft: d, ...o }));
    (byId(v, 'type-pvp')!.props.onClick as () => void)(); (byId(v, 'map-duel-s')!.props.onClick as () => void)();
    (byId(v, 'players-plus')!.props.onClick as () => void)(); (byId(v, 'players-minus')!.props.onClick as () => void)(); (byId(v, 'teams-plus')!.props.onClick as () => void)();
    expect(o.onType).toHaveBeenCalledWith('pvp'); expect(o.onMap).toHaveBeenCalledWith('duel-s'); expect(o.onPlayers.mock.calls).toEqual([[4], [2]]); expect(o.onTeams).toHaveBeenCalledWith(3);
    (byId(v, 'seat-kind-1')!.props.onChange as (e: unknown) => void)({ currentTarget: { value: 'bot' } });
    expect(o.onRow).toHaveBeenCalledWith(1, { kind: 'bot' });
    (find(v, (n) => n.type === 'form')[0]!.props.onSubmit as (e: unknown) => void)({ preventDefault: noop });
    expect(o.onCreate).toHaveBeenCalledOnce();
  });
  it('Create disabled: bad nick, unavailable, Team with one distinct team', () => {
    expect(byId(RoomForm(props({ nick: ' ' })), 'pvp-create')!.props.disabled).toBe(true);
    expect(byId(RoomForm(props({ unavailable: true })), 'pvp-create')!.props.disabled).toBe(true);
    const d = setRow(setType(cross(), 'team', maps[1]!), 1, { team: 0 }, maps[1]!);
    expect(byId(RoomForm(props({ draft: d })), 'pvp-create')!.props.disabled).toBe(true);
  });
});
