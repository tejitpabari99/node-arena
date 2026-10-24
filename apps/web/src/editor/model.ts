import type { LevelDoc } from './document.js';
import { roundCoordinate, type Point, type Selection } from './picking.js';
export type LibraryItem = 'house-wt1' | 'house-wt2' | 'tower' | 'obstacle-small' | 'obstacle-big';
export type DocOp = { type: 'place'; item: LibraryItem; pos: Point } | { type: 'move'; target: Selection; pos: Point } | { type: 'delete'; target: Selection };
export interface DocHistory { past: LevelDoc[]; present: LevelDoc; future: LevelDoc[] }
export type HistoryAction = { type: 'edit'; op: DocOp } | { type: 'undo' } | { type: 'redo' };
export const createHistory = (present: LevelDoc): DocHistory => ({ past: [], present, future: [] });
/** Pure structural edits; drag previews never enter this reducer. */
export function reduceDocument(doc: LevelDoc, op: DocOp): LevelDoc {
  if (op.type === 'place') {
    const ids = new Set([...doc.buildings, ...doc.elements].map(item => item.id));
    const obstacle = op.item.startsWith('obstacle-');
    const prefix = obstacle ? 'e' : 'b';
    let index = 0; while (ids.has(`${prefix}${index}`)) index++;
    const id = `${prefix}${index}`, pos = { x: roundCoordinate(op.pos.x), z: roundCoordinate(op.pos.z) };
    if (obstacle) return { ...doc, elements: [...doc.elements, { id, archetype: 'obstacle', variant: op.item === 'obstacle-big' ? 'big' : 'small', pos, yawDeg: 0 }] };
    return { ...doc, buildings: [...doc.buildings, { id, archetype: op.item, pos, owner: null, level: 1, ignoreForWin: false }] };
  }
  const key = op.target.kind === 'building' ? 'buildings' : 'elements';
  const entries = doc[key], index = entries.findIndex(item => item.id === op.target.id);
  if (index < 0) return doc;
  if (op.type === 'delete') return { ...doc, [key]: entries.filter((_, i) => i !== index) };
  const pos = { x: roundCoordinate(op.pos.x), z: roundCoordinate(op.pos.z) };
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
  const present = reduceDocument(state.present, action.op);
  return present === state.present ? state : { past: [...state.past, state.present].slice(-100), present, future: [] };
}
