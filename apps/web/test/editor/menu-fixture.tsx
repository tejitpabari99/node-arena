import { render } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { Menu } from '../../src/editor/Menu.js';
import { useDismiss } from '../../src/editor/useDismiss.js';
import '../../src/editor/style.css';

function Layers() {
  const [parent, setParent] = useState(false), [child, setChild] = useState(false);
  const parentRef = useRef<HTMLDivElement>(null), childRef = useRef<HTMLDivElement>(null);
  const parentTrigger = useRef<HTMLButtonElement>(null), childTrigger = useRef<HTMLButtonElement>(null);
  const [reason, setReason] = useState('');
  useDismiss({ enabled: parent, escapeEnabled: !child, refs: [parentRef, childRef, parentTrigger], triggerRef: parentTrigger, onDismiss: why => { setReason(why); setParent(false); } });
  useDismiss({ enabled: child, refs: [childRef, childTrigger], triggerRef: childTrigger, onDismiss: why => { setReason(why); setChild(false); } });
  return <>
    <button ref={parentTrigger} onClick={() => setParent(true)}>Parent</button>
    {parent && <div ref={parentRef} role="dialog" aria-label="Parent surface"><button ref={childTrigger} onClick={() => setChild(true)}>Child</button></div>}
    {child && <div ref={childRef} role="dialog" aria-label="Child surface"><button>Child content</button></div>}
    <output data-testid="dismiss-reason">{reason}</output>
  </>;
}
function Fixture() {
  const [open, setOpen] = useState(false), [selected, setSelected] = useState('');
  return <main class="ed-shell">
    <button>Before</button>
    <Menu id="fixture-menu" label="File" open={open} onOpenChange={setOpen} testId="file-menu" triggerTestId="file-menu-button" items={[
      { id: 'create', label: 'Create', onSelect: () => setSelected('create') },
      { id: 'disabled', label: 'Disabled', disabled: true, onSelect: () => setSelected('disabled') },
      { id: 'separator', separator: true },
      { id: 'undo', label: 'Undo', kbd: 'Ctrl+Z', onSelect: () => setSelected('undo') },
      { id: 'redo', label: 'Redo', onSelect: () => setSelected('redo') },
    ]} />
    <button>Outside</button>
    <output data-testid="selected">{selected}</output>
    <Menu id="disabled-menu" label="Locked" open={false} disabled onOpenChange={() => {}} items={[]} />
    <Layers />
  </main>;
}
render(<Fixture />, document.getElementById('app')!);
