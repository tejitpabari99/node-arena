import { render } from 'preact';
import { useState } from 'preact/hooks';
import { SaveStatus } from '../../src/editor/SaveStatus.js';
import type { ChipKind } from '../../src/editor/save-core.js';
import '../../src/editor/style.css';

function Fixture() {
  const [state, setState] = useState<ChipKind>('saved');
  const [issues, setIssues] = useState(false), [message, setMessage] = useState(''), [warnings, setWarnings] = useState(false), [failureSeq, setFailureSeq] = useState(0);
  return <main class="ed-shell" style={{ padding: '40px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
    {(['saved', 'saving', 'unsaved'] as const).map(value => <button onClick={() => { setState(value); setIssues(false); setMessage(''); }}>{value}</button>)}
    <button onClick={() => { setState('error'); setIssues(true); }}>Issues</button>
    <button onClick={() => { setState('error'); setIssues(false); setMessage('Disk full'); }}>Message</button>
    <button onClick={() => { setState('error'); setIssues(true); setFailureSeq(value => value + 1); }}>Manual failure</button>
    <button onClick={() => setWarnings(value => !value)}>Warnings</button>
    <SaveStatus saveState={state} issues={issues ? [{ file: 'level.json', pointer: '/buildings', message: 'Invalid building' }] : []} warnings={warnings ? [{ file: 'level.json', pointer: '/scripts', message: 'Ignored script' }] : []} saveMessage={message} failureSeq={failureSeq} issueLabel={issue => `Field ${issue.pointer}`} />
    <button>Outside</button>
  </main>;
}
render(<Fixture />, document.getElementById('app')!);
