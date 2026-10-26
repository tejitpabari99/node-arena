import { render } from 'preact';
import { useState } from 'preact/hooks';
import { EditorCtx, type EditorContext } from '../../src/editor/EditorContext.js';
import { SelectionSection } from '../../src/editor/SelectionSection.js';
import { blankDocument } from '../../src/editor/document.js';
import { createHistory, historyReducer, type HistoryAction } from '../../src/editor/model.js';
import type { Selection } from '../../src/editor/picking.js';

const initial = blankDocument('na-selection', 'green', 'medium');
initial.buildings = [
  { id: 'house', archetype: 'house-wt1', pos: { x: 0, z: 0 }, owner: 'p1', level: 10, ignoreForWin: false, params: { level: { maxLevel: 32 }, grows: { growTime: 2 }, spawns: { lineSpawnPenalty: .7 } } },
  { id: 'tower', archetype: 'tower', pos: { x: 4, z: 0 }, owner: null, level: 5, ignoreForWin: false },
];
initial.elements = [{ id: 'rock', archetype: 'obstacle', pos: { x: -4, z: 0 }, yawDeg: 0, variant: 'small' }];

function Fixture() {
  const [history, setHistory] = useState(() => createHistory(initial));
  const [selection, select] = useState<Selection[]>([{ kind: 'building', id: 'house' }]);
  const dispatch = (action: HistoryAction) => setHistory(state => historyReducer(state, action));
  const context: EditorContext = {
    doc: history.present, savedDoc: initial, history, dispatch,
    edit: (op, merge) => setHistory(state => historyReducer(state, { type: 'edit', op: typeof op === 'function' ? op(state.present) : op, ...(merge ? { merge } : {}) })),
    endEditBurst: () => dispatch({ type: 'end-edit' }),
    selection, select, area: initial.bounds, locked: false, dirty: true,
    deleteSelection() {}, copy() {}, paste() {}, viewport: {},
    async save() {}, saveState: 'unsaved', themes: ['green', 'snow'], colors: ['blue', 'red'], palettes: {}, viewportStatus: { message: '' }, losStatus: '',
  };
  return <EditorCtx.Provider value={context}><SelectionSection /><button onClick={() => dispatch({ type: 'undo' })}>Undo</button><output data-testid="document">{JSON.stringify(history.present)}</output><output data-testid="past">{history.past.length}</output><output data-testid="selection">{selection.map(item => `${item.kind}:${item.id}`).join(',')}</output></EditorCtx.Provider>;
}
render(<Fixture />, document.getElementById('app')!);
