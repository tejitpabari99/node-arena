import { render } from 'preact';
import { useState } from 'preact/hooks';
import { blankDocument } from '../../src/editor/document.js';
import { createHistory, historyReducer, type HistoryAction } from '../../src/editor/model.js';
import { LiveFieldError, useLiveField } from '../../src/editor/useLiveField.js';

function Field({ id, history, dispatch }: { id: string; history: ReturnType<typeof createHistory>; dispatch(action: HistoryAction): void }) {
  const field = useLiveField({ value: history.present.name, mergeKey: `level:${id}`, validate: text => text.trim() ? undefined : 'Name is required', commit: (name, merge) => dispatch({ type: 'edit', merge, op: { type: 'level-properties', value: { ...history.present, name } } }), endBurst: () => dispatch({ type: 'end-edit' }) });
  return <><input aria-label="Name" {...field.inputProps} /><LiveFieldError field={field} /></>;
}

function Fixture() {
  const [history, setHistory] = useState(() => createHistory(blankDocument('na-live', 'green', 'medium')));
  const [item, setItem] = useState('name'), [visible, setVisible] = useState(true);
  const dispatch = (action: HistoryAction) => setHistory(state => historyReducer(state, action));
  return <><button onClick={() => setItem(item === 'name' ? 'other' : 'name')}>Switch selection</button>
    <button onClick={() => setVisible(false)}>Unmount</button>
    <button onClick={() => dispatch({ type: 'undo' })}>Undo</button>
    {visible && <Field id={item} history={history} dispatch={dispatch} />}<output data-testid="document">{history.present.name}</output><output data-testid="past">{history.past.length}</output></>;
}
render(<Fixture />, document.getElementById('app')!);
