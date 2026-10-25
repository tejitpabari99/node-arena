import { boundsFromPositions } from '@node-arena/content';
import type { SeatBot } from '@node-arena/content';
import type { LevelDoc } from './document.js';
import { playerLabel } from './labels.js';
import { roundCoordinate, type Point, type Selection } from './picking.js';
export type LibraryItem = 'house-wt1' | 'house-wt2' | 'tower' | 'obstacle-small' | 'obstacle-big';
export type LevelProperties = Pick<LevelDoc, 'name' | 'theme' | 'timeLimitSec' | 'players'>;
export type Clipboard = Pick<LevelDoc, 'buildings' | 'elements'>;
export type DocOp =
  | { type: 'move-selection'; targets: Selection[]; delta: Point }
  | { type: 'paste'; clipboard: Clipboard; offset: Point }
  | { type: 'level-properties'; value: LevelProperties }
  | { type: 'building-properties'; id: string; value: Partial<Pick<LevelDoc['buildings'][number], 'owner' | 'level' | 'ignoreForWin'> & { params: LevelDoc['buildings'][number]['params'] | undefined }> }
  | { type: 'obstacle-properties'; id: string; value: Partial<{ variant: LevelDoc['elements'][number]['variant'] | undefined; yawDeg: number; footprint: LevelDoc['elements'][number]['footprint'] | undefined }> }
  | { type: 'place'; item: LibraryItem; pos: Point }
  | { type: 'move'; target: Selection; pos: Point }
  | { type: 'delete'; target: Selection }
  | { type: 'delete-many'; targets: Selection[] };
export interface Area { minX: number; maxX: number; minZ: number; maxZ: number }
export const AREA_W = 40, AREA_H = 30;
const quarter = (v: number) => Math.round(v * 4) / 4;
/** Fixed 40x30 buildable rectangle centred on the bounds centre, rounded to 0.25. */
export function buildableArea(bounds: Area): Area {
  const cx = quarter((bounds.minX + bounds.maxX) / 2), cz = quarter((bounds.minZ + bounds.maxZ) / 2);
  return { minX: cx - AREA_W / 2, maxX: cx + AREA_W / 2, minZ: cz - AREA_H / 2, maxZ: cz + AREA_H / 2 };
}
export const clampPoint = (p: Point, area: Area): Point => ({ x: Math.min(area.maxX, Math.max(area.minX, p.x)), z: Math.min(area.maxZ, Math.max(area.minZ, p.z)) });
/** Per-axis delta keeping the group's extent inside the area; 0 on an axis where the group is wider than the area. */
export function clampDelta(points: Point[], delta: Point, area: Area): Point {
  if (!points.length) return delta;
  const axis = (vals: number[], d: number, lo: number, hi: number) => {
    const min = Math.min(...vals), max = Math.max(...vals);
    if (max - min > hi - lo) return 0;
    return Math.min(hi - max, Math.max(lo - min, d));
  };
  return { x: axis(points.map(q => q.x), delta.x, area.minX, area.maxX), z: axis(points.map(q => q.z), delta.z, area.minZ, area.maxZ) };
}
export interface DocHistory { past: LevelDoc[]; present: LevelDoc; future: LevelDoc[] }
export type HistoryAction = { type: 'edit'; op: DocOp; area?: Area } | { type: 'undo' } | { type: 'redo' };
export const createHistory = (present: LevelDoc): DocHistory => ({ past: [], present, future: [] });
const GROWING: ReadonlySet<DocOp['type']> = new Set(['place', 'move', 'move-selection', 'paste']);
/** Grow-only bounds: only items outside the bounds drive growth (2-unit pad); never shrinks; same doc when nothing is outside. */
export function growBounds(doc: LevelDoc): LevelDoc {
  const b = doc.bounds;
  const out = [...doc.buildings, ...doc.elements].map(item => item.pos).filter(p => p.x < b.minX || p.x > b.maxX || p.z < b.minZ || p.z > b.maxZ);
  if (!out.length) return doc;
  const g = boundsFromPositions(out);
  return { ...doc, bounds: { minX: Math.min(b.minX, g.minX), maxX: Math.max(b.maxX, g.maxX), minZ: Math.min(b.minZ, g.minZ), maxZ: Math.max(b.maxZ, g.maxZ) } };
}
/** Pure structural edits; drag previews never enter this reducer. */
export function reduceDocument(doc: LevelDoc, op: DocOp, area?: Area): LevelDoc {
  const next = applyOp(doc, op, area);
  return next !== doc && GROWING.has(op.type) ? growBounds(next) : next;
}
function applyOp(doc: LevelDoc, op: DocOp, area?: Area): LevelDoc {
  if (op.type === 'paste') {
    const ids = new Set([...doc.buildings, ...doc.elements].map(item => item.id));
    const clone = <T extends { id: string; pos: Point }>(item: T, prefix: string): T => {
      let i = 0; while (ids.has(`${prefix}${i}`)) i++;
      const id = `${prefix}${i}`; ids.add(id);
      return { ...structuredClone(item), id, pos: { x: roundCoordinate(item.pos.x + op.offset.x), z: roundCoordinate(item.pos.z + op.offset.z) } };
    };
    let buildings = op.clipboard.buildings.map(item => clone(item, 'b')), elements = op.clipboard.elements.map(item => clone(item, 'e'));
    if (area) {
      const d = clampDelta([...buildings, ...elements].map(item => item.pos), { x: 0, z: 0 }, area);
      if (d.x || d.z) {
        const shift = <T extends { pos: Point }>(item: T): T => ({ ...item, pos: { x: roundCoordinate(item.pos.x + d.x), z: roundCoordinate(item.pos.z + d.z) } });
        buildings = buildings.map(shift); elements = elements.map(shift);
      }
    }
    return { ...doc, buildings: [...doc.buildings, ...buildings], elements: [...doc.elements, ...elements] };
  }
  if (op.type === 'move-selection') {
    const selected = (kind: Selection['kind'], id: string) => op.targets.some(target => target.kind === kind && target.id === id);
    const chosen = [...doc.buildings.filter(i => selected('building', i.id)), ...doc.elements.filter(i => selected('obstacle', i.id))].map(i => i.pos);
    const delta = area ? clampDelta(chosen, op.delta, area) : op.delta;
    const position = (pos: Point): Point => ({ x: roundCoordinate(pos.x + delta.x), z: roundCoordinate(pos.z + delta.z) });
    return { ...doc,
      buildings: doc.buildings.map(item => selected('building', item.id) ? { ...item, pos: position(item.pos) } : item),
      elements: doc.elements.map(item => selected('obstacle', item.id) ? { ...item, pos: position(item.pos) } : item),
    };
  }
  if (op.type === 'level-properties') {
    const ids = new Set(op.value.players.map(player => player.id));
    return { ...doc, ...op.value, buildings: doc.buildings.map(item => item.owner !== null && !ids.has(item.owner) ? { ...item, owner: null } : item) };
  }
  if (op.type === 'delete-many') {
    const next = op.targets.reduce((acc, target) => reduceDocument(acc, { type: 'delete', target }, area), doc);
    return next === doc ? doc : next;
  }
  if (op.type === 'building-properties') return { ...doc, buildings: doc.buildings.map(item => item.id === op.id ? cleanOptional({ ...item, ...op.value }) as LevelDoc['buildings'][number] : item) };
  if (op.type === 'obstacle-properties') return { ...doc, elements: doc.elements.map(item => item.id === op.id ? cleanOptional({ ...item, ...op.value }) as LevelDoc['elements'][number] : item) };
  if (op.type === 'place') {
    const ids = new Set([...doc.buildings, ...doc.elements].map(item => item.id));
    const obstacle = op.item.startsWith('obstacle-');
    const prefix = obstacle ? 'e' : 'b';
    let index = 0; while (ids.has(`${prefix}${index}`)) index++;
    const at = area ? clampPoint(op.pos, area) : op.pos;
    const id = `${prefix}${index}`, pos = { x: roundCoordinate(at.x), z: roundCoordinate(at.z) };
    if (obstacle) return { ...doc, elements: [...doc.elements, { id, archetype: 'obstacle', variant: op.item === 'obstacle-big' ? 'big' : 'small', pos, yawDeg: 0 }] };
    return { ...doc, buildings: [...doc.buildings, { id, archetype: op.item, pos, owner: null, level: 1, ignoreForWin: false }] };
  }
  const key = op.target.kind === 'building' ? 'buildings' : 'elements';
  const entries = doc[key], index = entries.findIndex(item => item.id === op.target.id);
  if (index < 0) return doc;
  if (op.type === 'delete') {
    const players = op.target.kind === 'building' ? doc.players.map(player => {
      const sourceBot = player.bot as SeatBot | undefined;
      if (!sourceBot?.script?.some(command => command.op === 'line' ? command.own === op.target.id || command.target === op.target.id : command.op === 'steps' && stepReferences(command.root, op.target.id))) return player;
      const bot = { ...sourceBot }; delete bot.script;
      return { ...player, bot };
    }) : doc.players;
    return { ...doc, players, [key]: entries.filter((_, i) => i !== index) };
  }
  const to = area ? clampPoint(op.pos, area) : op.pos;
  const pos = { x: roundCoordinate(to.x), z: roundCoordinate(to.z) };
  if (entries[index]!.pos.x === pos.x && entries[index]!.pos.z === pos.z) return doc;
  return { ...doc, [key]: entries.map((item, i) => i === index ? { ...item, pos } : item) };
}

/** D8: at most 100 undo snapshots; immutable docs also make redo exact. */
export function historyReducer(state: DocHistory, action: HistoryAction): DocHistory {
  if (action.type === 'undo') {
    const present = state.past.at(-1);
    return present ? { past: state.past.slice(0, -1), present, future: [state.present, ...state.future].slice(0, 100) } : state;
  }
  if (action.type === 'redo') {
    const present = state.future[0];
    return present ? { past: [...state.past, state.present].slice(-100), present, future: state.future.slice(1) } : state;
  }
  const present = reduceDocument(state.present, action.op, action.area);
  return present === state.present ? state : { past: [...state.past, state.present].slice(-100), present, future: [] };
}

function stepReferences(node: { own?: string | null; target?: string | null; then?: unknown[] }, id: string): boolean {
  return node.own === id || node.target === id || !!node.then?.some(child => stepReferences(child as typeof node, id));
}

/** Derive notices from the same snapshots as undo: no UI state can outlive its edit. */
export function scriptRemovalMessages(state: DocHistory): string[] {
  const before = state.past.at(-1);
  if (!before) return [];
  return state.present.players.flatMap(player => (before.players.find(p => p.id === player.id)?.bot as SeatBot | undefined)?.script?.length && player.bot && !(player.bot as SeatBot).script ? [`${playerLabel(state.present.players, player.id)} script removed`] : []);
}

function cleanOptional<T extends object>(value: T): T {
  for (const key of Object.keys(value) as (keyof T)[]) if (value[key] === undefined) delete value[key];
  return value;
}

export function copySelection(doc: LevelDoc, targets: Selection[]): Clipboard {
  return structuredClone({ buildings: doc.buildings.filter(item => targets.some(t => t.kind === 'building' && t.id === item.id)), elements: doc.elements.filter(item => targets.some(t => t.kind === 'obstacle' && t.id === item.id)) });
}
const normalizeYaw = (value: number) => roundCoordinate(((roundCoordinate(value) % 360) + 360) % 360);
export function snapPosition(point: Point, enabled = true): Point {
  const snap = (n: number) => roundCoordinate(enabled ? Math.round(n / .25) * .25 : n);
  return { x: snap(point.x), z: snap(point.z) };
}
export function snapYaw(value: number, enabled = true): number {
  return normalizeYaw(enabled ? Math.round(value / 15) * 15 : value);
}
