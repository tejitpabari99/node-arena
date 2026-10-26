import { render } from 'preact';
import { useState } from 'preact/hooks';
import { blankDocument } from '../../src/editor/document.js';
import { EditorCtx, type EditorContext } from '../../src/editor/EditorContext.js';
import { LevelSection } from '../../src/editor/LevelSection.js';
import { createHistory, historyReducer, type HistoryAction } from '../../src/editor/model.js';

function Fixture() {
  const [history, setHistory] = useState(() => {
    const doc = blankDocument('na-live-level', 'green', 'medium');
    doc.buildings = ['house-wt1', 'house-wt2', 'tower'].map((archetype, i) => ({ id: `b${i}`, archetype, owner: null, pos: { x: i * 4, z: 0 }, level: 1, ignoreForWin: false }));
    return createHistory(doc);
  });
  const dispatch = (action: HistoryAction) => setHistory(state => historyReducer(state, action));
  const edit: EditorContext['edit'] = (op, merge) => setHistory(state => historyReducer(state, { type: 'edit', op: typeof op === 'function' ? op(state.present) : op, ...(merge ? { merge } : {}) }));
  const context = { doc: history.present, history, edit, dispatch, endEditBurst: () => dispatch({ type: 'end-edit' }), themes: ['green', 'snow'], colors: ['blue', 'red', 'green', 'yellow'], palettes: {}, locked: false } as EditorContext;
  return <EditorCtx.Provider value={context}><LevelSection /><button onClick={() => dispatch({ type: 'undo' })}>Undo</button><output data-testid="doc">{JSON.stringify(history.present)}</output><output data-testid="past">{history.past.length}</output></EditorCtx.Provider>;
}
render(<Fixture />, document.getElementById('app')!);
