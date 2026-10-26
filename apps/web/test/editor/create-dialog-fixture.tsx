import { render } from 'preact';
import { useState } from 'preact/hooks';
import { CreateDialog } from '../../src/editor/CreateDialog.js';
import { OpenDialog } from '../../src/editor/OpenDialog.js';
import { StartScreen } from '../../src/editor/StartScreen.js';
import type { LevelDoc } from '../../src/editor/document.js';
import '../../src/editor/style.css';

const listings = [{ id: 'na-custom-1', name: 'Existing' }, { id: 'levelview-1', name: 'Campaign' }];
function Fixture() {
  const [mode, setMode] = useState<'create' | 'open' | 'start' | null>(null);
  const [empty, setEmpty] = useState(false), [loading, setLoading] = useState(false);
  const [hold, setHold] = useState(false), [result, setResult] = useState('');
  async function replace(doc: LevelDoc, saved: boolean) {
    setResult(JSON.stringify({ doc, saved }));
    if (hold) await new Promise<void>((resolve, reject) => {
      Reflect.set(window, 'finishCreate', (success: boolean) => { if (success) resolve(); else reject(new Error('Replacement failed')); });
    });
  }
  const props = { levels: empty ? [] : listings, loading, currentId: 'na-custom-2', onReplace: replace };
  return <main class="editor-shell">
    <button onClick={() => setMode('create')}>Show Create</button>
    <button onClick={() => setMode('open')}>Show Open</button>
    <button onClick={() => setMode('start')}>Show Start</button>
    <label><input type="checkbox" checked={empty} onChange={event => setEmpty(event.currentTarget.checked)} />Empty listings</label>
    <label><input type="checkbox" checked={loading} onChange={event => setLoading(event.currentTarget.checked)} />Loading listings</label>
    <label><input type="checkbox" checked={hold} onChange={event => setHold(event.currentTarget.checked)} />Hold replacement</label>
    <output data-testid="result">{result}</output>
    {mode === 'create' && <CreateDialog {...props} onClose={() => setMode(null)} />}
    {mode === 'open' && <OpenDialog {...props} onClose={() => setMode(null)} />}
    {mode === 'start' && <StartScreen {...props} />}
  </main>;
}
render(<Fixture />, document.getElementById('app')!);
