import { h, render } from 'preact';
import { useState } from 'preact/hooks';
import { blankDocument } from '../../src/editor/document.js';
import { EditorCtx, type EditorContext } from '../../src/editor/EditorContext.js';
import { LevelSection } from '../../src/editor/LevelSection.js';
import { createHistory, historyReducer, type DocOp } from '../../src/editor/model.js';

export const ops: DocOp[] = [];

export function mount() {
  const host = document.createElement('div');
  host.id = 'level-section-fixture';
  Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '1000', background: 'white' });
  document.body.append(host);
  function Fixture() {
    const [history, setHistory] = useState(() => createHistory(blankDocument('na-level-section', 'green', 'small')));
    const edit: EditorContext['edit'] = (op, merge) => setHistory(state => {
      const actual = typeof op === 'function' ? op(state.present) : op;
      ops.push(actual);
      return historyReducer(state, { type: 'edit', op: actual, ...(merge ? { merge } : {}) });
    });
    const context = {
      doc: history.present, edit, endEditBurst: () => setHistory(state => historyReducer(state, { type: 'end-edit' })),
      themes: ['green', 'snow'], colors: ['blue', 'red', 'green', 'yellow'], palettes: {}, locked: false,
    } satisfies Pick<EditorContext, 'doc' | 'edit' | 'endEditBurst' | 'themes' | 'colors' | 'palettes' | 'locked'>;
    return h(EditorCtx.Provider, { value: context as EditorContext }, h(LevelSection, {}));
  }
  render(h(Fixture, {}), host);
}
