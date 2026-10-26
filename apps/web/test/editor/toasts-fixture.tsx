import { render } from 'preact';
import { useState } from 'preact/hooks';
import { Toasts, type ToastNotice } from '../../src/editor/Toasts.js';
import '../../src/editor/style.css';

function Fixture() {
  const [notices, setNotices] = useState<ToastNotice[]>([]), [dismissed, setDismissed] = useState<string[]>([]), [actions, setActions] = useState(0), [error, setError] = useState('Manifest unavailable'), [shown, setShown] = useState(true);
  const add = (id: string) => setNotices(value => [...value, { id, kind: id === 'second' ? 'error' : 'success', message: `Notice ${id}`, testId: `${id}-toast`, action: { label: 'Details', onClick: () => setActions(value => value + 1) } }]);
  return <main class="ed-shell">
    <button onClick={() => add('first')}>Add first</button><button onClick={() => add('second')}>Add second</button>
    <button onClick={() => setNotices([])}>Remove notices</button><button onClick={() => setShown(value => !value)}>Toggle stack</button>
    <output data-testid="dismissed">{dismissed.join(',')}</output><output data-testid="actions">{actions}</output>
    {shown && <Toasts banners={['Scripts removed']} error={error} onDismissError={() => setError('')} notices={notices} onDismissNotice={id => { setDismissed(value => [...value, id]); setNotices(value => value.filter(notice => notice.id !== id)); }} />}
  </main>;
}
render(<Fixture />, document.getElementById('app')!);
