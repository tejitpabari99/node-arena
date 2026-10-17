// Optional authoring helper: expands one seat's towers (a "fundamental domain") into a full
// symmetric level. Output is plain level JSON that is committed; nothing at runtime depends on this.
import type { Level } from '@node-arena/content';

export type Symmetry = 'mirror' | 'rot3' | 'rot4';
export const SEAT_COUNT: Record<Symmetry, number> = { mirror: 2, rot3: 3, rot4: 4 };
export const MIN_SPACING = 18;

export interface LayoutTower {
  id: string; archetype: string; pos: { x: number; y: number };
  /** 'seat' = owned by the seat the copy belongs to; null = neutral. */
  owner: 'seat' | null; garrison: number;
  /** Emit once, unreplicated (e.g. a central neutral on the symmetry centre). Must be neutral. */
  single?: boolean;
}
export interface LayoutInput {
  symmetry: Symmetry;
  /** Map centre in world coordinates (default 0,0); rotation/reflection happens around it. */
  centre?: { x: number; y: number };
  /** Level envelope; `bounds` defaults to 120x80. */
  level: Pick<Level, 'id' | 'name' | 'order' | 'band'> & Partial<Pick<Level, 'bounds' | 'timeLimitSec' | 'visual'>>;
  /** One player per seat in seat order; seat 0 is the authored (left/bottom) seat. */
  seats: Level['players'];
  towers: LayoutTower[];
}

const round3 = (n: number): number => { const r = Math.round(n * 1000) / 1000; return r === 0 ? 0 : r; };

function transform(symmetry: Symmetry, seat: number, dx: number, dy: number): [number, number] {
  if (symmetry === 'mirror') return seat === 0 ? [dx, dy] : [-dx, dy];
  const angle = (2 * Math.PI * seat) / SEAT_COUNT[symmetry];
  const c = round3(Math.cos(angle)), s = round3(Math.sin(angle));
  return [dx * c - dy * s, dx * s + dy * c];
}

export function generateLayout(input: LayoutInput): Level {
  const { symmetry } = input;
  const count = SEAT_COUNT[symmetry];
  if (!count) throw new Error(`Unknown symmetry ${String(symmetry)}`);
  if (input.seats.length !== count) throw new Error(`${symmetry} requires ${count} seats, got ${input.seats.length}`);
  const bounds = input.level.bounds ?? { w: 120, h: 80 };
  const centre = input.centre ?? { x: 0, y: 0 };
  const towers: Level['towers'] = [];
  for (const t of input.towers) {
    if (t.single && t.owner !== null) throw new Error(`Tower ${t.id}: single towers must be neutral`);
    const copies = t.single ? 1 : count;
    for (let seat = 0; seat < copies; seat++) {
      const [tx, ty] = transform(symmetry, seat, t.pos.x - centre.x, t.pos.y - centre.y);
      const x = round3(centre.x + tx), y = round3(centre.y + ty);
      const id = t.single ? t.id : `${t.id}-${seat + 1}`;
      if (Math.abs(x) > bounds.w / 2 || Math.abs(y) > bounds.h / 2) throw new Error(`Tower ${id} at (${x}, ${y}) is outside bounds ${bounds.w}x${bounds.h}`);
      towers.push({ id, archetype: t.archetype, pos: { x, y }, owner: t.owner === 'seat' ? input.seats[seat]!.id : null, garrison: t.garrison });
    }
  }
  const ids = new Set(towers.map(t => t.id));
  if (ids.size !== towers.length) throw new Error('Generated tower ids are not unique');
  for (let i = 0; i < towers.length; i++) for (let j = i + 1; j < towers.length; j++) {
    const d = Math.hypot(towers[i]!.pos.x - towers[j]!.pos.x, towers[i]!.pos.y - towers[j]!.pos.y);
    if (d < MIN_SPACING) throw new Error(`Towers ${towers[i]!.id} and ${towers[j]!.id} are closer than ${MIN_SPACING} units (${round3(d)})`);
  }
  const { id, name, order, band, timeLimitSec, visual } = input.level;
  return {
    $schema: '../../schemas/level.schema.json', schemaVersion: '1.0.0', id, name, order, band,
    ...(visual !== undefined ? { visual } : {}), ...(timeLimitSec !== undefined ? { timeLimitSec } : {}),
    bounds, players: input.seats, towers, obstacles: [], mapObjects: [], overrides: {},
  } as Level;
}
