import { useEffect, useRef, useState } from 'preact/hooks';
import { ItemProperties } from './Properties.js';
import { copySelection, snapYaw, type Clipboard, type DocOp, type LibraryItem } from './model.js';
import type { LevelDoc } from './document.js';
import type { Point, Selection } from './picking.js';
import { createEditorViewport, type EditorViewport, type ViewportStatus } from './viewport.js';

export function Viewport({ doc, onEdit, disabled = false }: { doc: LevelDoc; onEdit?: (op: DocOp) => void; disabled?: boolean }) {
  const edit = useRef(onEdit), locked = useRef(disabled); edit.current = onEdit; locked.current = disabled;
  const host = useRef<HTMLDivElement>(null), viewport = useRef<EditorViewport>();
  const [status, setStatus] = useState<ViewportStatus>({ message: 'Loading preview…' });
  const [selection, setSelection] = useState<Selection[]>([]);
  const [snap, setSnap] = useState(true);
  const [clipboard, setClipboard] = useState<Clipboard>();
  const pasteCount = useRef(0);
  const [axis, setAxis] = useState<'vertical' | 'horizontal'>('vertical');
  const [center, setCenter] = useState('');
  const [swapOwners, setSwapOwners] = useState(false);
  const [losFrom, setLosFrom] = useState(''), [losTo, setLosTo] = useState('');
  const [losStatus, setLosStatus] = useState('Choose two buildings to preview line of sight.');
  const centerValue = center === '' ? axis === 'vertical' ? (doc.bounds.minX + doc.bounds.maxX) / 2 : (doc.bounds.minZ + doc.bounds.maxZ) / 2 : Number(center);
  function apply(op: DocOp) { if (!disabled) onEdit?.(op.type === 'obstacle-properties' ? { ...op, value: { ...op.value, yawDeg: snapYaw(op.value.yawDeg, snap) } } : op); }
  const [pointer, setPointer] = useState<Point | null>(null);
  useEffect(() => {
    const current = createEditorViewport(host.current!, { status: setStatus, los: setLosStatus, selection: setSelection, pointer: setPointer, edit: op => { if (!locked.current) edit.current?.(op); } });
    viewport.current = current;
    return () => { current.dispose(); viewport.current = undefined; };
  }, []);
  useEffect(() => { void viewport.current?.setDocument(doc); }, [doc]);
  useEffect(() => { viewport.current?.setSnap(snap); }, [snap]);
  useEffect(() => { viewport.current?.setLos({ from: losFrom, to: losTo }); }, [losFrom, losTo]);
  useEffect(() => { setClipboard(undefined); pasteCount.current = 0; setCenter(''); setLosFrom(''); setLosTo(''); }, [doc.id]);
  return <div class="editor-view-layout">
    <aside class="editor-view-tools" aria-label="Viewport tools">
      <h3>Library</h3>
      {(['house-wt1', 'house-wt2', 'tower', 'obstacle-small', 'obstacle-big'] as LibraryItem[]).map(item => <button key={item} class="editor-library-item" disabled={disabled} aria-label={`Place ${item}`} onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault(); viewport.current?.beginPlacement(item, event.pointerId);
      }}>{item.replace('obstacle-', 'Obstacle ')}</button>)}
      <p>Drag an item onto the view. Drag a selected item to move it.</p>
      <button disabled={disabled || selection.length !== 1} onClick={() => { if (selection[0]) onEdit?.({ type: 'delete', target: selection[0] }); }}>Delete selected</button>
      <label>Selected item<select aria-label="Selected item" value={selection.length === 1 ? `${selection[0]!.kind}:${selection[0]!.id}` : ''} onChange={event => {
        const [kind, id] = event.currentTarget.value.split(':');
        viewport.current?.select(id ? [{ kind: kind as Selection['kind'], id }] : []);
      }}><option value="">No single selection</option>{doc.buildings.map(item => <option key={item.id} value={`building:${item.id}`}>Building {item.id}</option>)}{doc.elements.map(item => <option key={item.id} value={`obstacle:${item.id}`}>Obstacle {item.id}</option>)}</select></label>
      <h3>Layout</h3>
      <button onClick={() => viewport.current?.select([...doc.buildings.map(item => ({ kind: 'building' as const, id: item.id })), ...doc.elements.map(item => ({ kind: 'obstacle' as const, id: item.id }))])}>Select all</button>{' '}
      <button onClick={() => viewport.current?.select([])}>Clear selection</button>
      <button disabled={disabled || !selection.length} onClick={() => { setClipboard(copySelection(doc, selection)); pasteCount.current = 0; }}>Copy selected</button>{' '}
      <button disabled={disabled || !clipboard} onClick={() => { if (clipboard) { pasteCount.current++; apply({ type: 'paste', clipboard, offset: { x: .5 * pasteCount.current, z: .5 * pasteCount.current } }); } }}>Paste</button>
      <label>Grid snap<input type="checkbox" checked={snap} onChange={event => setSnap(event.currentTarget.checked)} /></label>
      <p>Positions: 0.25 units. Yaw: 15°. Shift + click to add/remove selection.</p>
      <label>Mirror axis<select value={axis} onChange={event => { setAxis(event.currentTarget.value as typeof axis); setCenter(''); }}><option value="vertical">Vertical (reflect x)</option><option value="horizontal">Horizontal (reflect z)</option></select></label>
      <label>Mirror centre<input type="number" step=".01" value={center} placeholder={String(centerValue)} onInput={event => setCenter(event.currentTarget.value)} /></label>
      <label>Swap p1 and p2 owners<input type="checkbox" checked={swapOwners} onChange={event => setSwapOwners(event.currentTarget.checked)} /></label>
      <button disabled={disabled || !Number.isFinite(centerValue)} onClick={() => apply({ type: 'mirror', targets: selection, axis, center: centerValue, swapOwners })}>Mirror</button>
      <p>Mirror {selection.length ? 'selected items' : 'the whole level'}.</p>
      <button disabled={disabled || !doc.buildings.length && !doc.elements.length} onClick={() => apply({ type: 'auto-fit' })}>Auto-fit bounds</button>
      <p>2-unit margin around all item positions. Draft bounds; Save writes them.</p>
      <p data-testid="bounds-preview">x {String(doc.bounds.minX).replace('-', '−')}…{doc.bounds.maxX} · z {String(doc.bounds.minZ).replace('-', '−')}…{doc.bounds.maxZ}</p>
      <h3>Line of sight</h3>
      <label>LOS from<select value={losFrom} onChange={event => setLosFrom(event.currentTarget.value)}><option value="">Choose source</option>{doc.buildings.map(item => <option key={item.id} value={item.id}>{item.id}</option>)}</select></label>
      <label>LOS to<select value={losTo} onChange={event => setLosTo(event.currentTarget.value)}><option value="">Choose target</option>{doc.buildings.map(item => <option key={item.id} value={item.id}>{item.id}</option>)}</select></label>
      <p data-testid="los-status">{losStatus}</p>
      <h3>View</h3>
      <button onClick={() => viewport.current?.zoomBy(1.2)} aria-label="Zoom in">+</button>{' '}
      <button onClick={() => viewport.current?.zoomBy(1 / 1.2)} aria-label="Zoom out">−</button>
      <p><button onClick={() => viewport.current?.gameCamera()}>Game camera</button></p>
      <p>Wheel to zoom. Middle/right drag or Alt + drag to pan.</p>
      <p>Click to select. Drag on empty ground for marquee.</p>
      <p data-testid="viewport-selection">{selection.length ? selection.map(item => `${item.kind}: ${item.id}`).join(', ') : 'No selection'}</p>
      <p aria-live="off">{pointer ? `x ${pointer.x.toFixed(2)} · z ${pointer.z.toFixed(2)}` : 'Ground coordinates'}</p>
      <p role="status" data-testid="viewport-status">{status.message}{status.rebuildMs !== undefined ? ` · ${status.rebuildMs.toFixed(1)} ms` : ''}</p>
    </aside>
    <div><div ref={host} class="editor-workspace" aria-label="Edit viewport" /><ItemProperties doc={doc} selection={selection} onEdit={apply} disabled={disabled} /></div>
  </div>;
}
