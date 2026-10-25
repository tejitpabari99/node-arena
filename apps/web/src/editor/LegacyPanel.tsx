import { useEffect, useState } from 'preact/hooks';
import { ItemProperties, LevelPropertiesForm } from './Properties.js';
import { snapYaw, type DocOp, type LibraryItem } from './model.js';
import type { Point, Selection } from './picking.js';
import { useEditor } from './EditorContext.js';

/** Temporary pre-redesign sidebar; consumes EditorContext. SP02 deletes this file. */
export function LegacyPanel({ pointer }: { pointer: Point | null }) {
  const { doc, edit, deleteSelection, selection, select, clipboard, copy, paste, viewport, locked, themes, colors, losStatus } = useEditor();
  const [snap, setSnap] = useState(true);
  const [axis, setAxis] = useState<'vertical' | 'horizontal'>('vertical');
  const [center, setCenter] = useState('');
  const [swapOwners, setSwapOwners] = useState(false);
  const [losFrom, setLosFrom] = useState(''), [losTo, setLosTo] = useState('');
  const centerValue = center === '' ? axis === 'vertical' ? (doc.bounds.minX + doc.bounds.maxX) / 2 : (doc.bounds.minZ + doc.bounds.maxZ) / 2 : Number(center);
  function apply(op: DocOp) { if (!locked) edit(op.type === 'obstacle-properties' ? { ...op, value: op.value.yawDeg === undefined ? op.value : { ...op.value, yawDeg: snapYaw(op.value.yawDeg, snap) } } : op); }
  useEffect(() => { viewport.current?.setSnap(snap); }, [snap]);
  useEffect(() => { viewport.current?.setLos({ from: losFrom, to: losTo }); }, [losFrom, losTo]);
  useEffect(() => { setCenter(''); setLosFrom(''); setLosTo(''); }, [doc.id]);
  return <>
    <LevelPropertiesForm doc={doc} onEdit={edit} themes={themes} colors={colors} disabled={locked} />
    <aside class="editor-view-tools" aria-label="Viewport tools">
      <h3>Library</h3>
      {(['house-wt1', 'house-wt2', 'tower', 'obstacle-small', 'obstacle-big'] as LibraryItem[]).map(item => <button key={item} class="editor-library-item" disabled={locked} aria-label={`Place ${item}`} onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault(); viewport.current?.beginPlacement(item, event.pointerId);
      }}>{item.replace('obstacle-', 'Obstacle ')}</button>)}
      <p>Drag an item onto the view. Drag a selected item to move it.</p>
      <button disabled={locked || selection.length !== 1} onClick={deleteSelection}>Delete selected</button>
      <label>Selected item<select aria-label="Selected item" value={selection.length === 1 ? `${selection[0]!.kind}:${selection[0]!.id}` : ''} onChange={event => {
        const [kind, id] = event.currentTarget.value.split(':');
        select(id ? [{ kind: kind as Selection['kind'], id }] : []);
      }}><option value="">No single selection</option>{doc.buildings.map(item => <option key={item.id} value={`building:${item.id}`}>Building {item.id}</option>)}{doc.elements.map(item => <option key={item.id} value={`obstacle:${item.id}`}>Obstacle {item.id}</option>)}</select></label>
      <h3>Layout</h3>
      <button onClick={() => select([...doc.buildings.map(item => ({ kind: 'building' as const, id: item.id })), ...doc.elements.map(item => ({ kind: 'obstacle' as const, id: item.id }))])}>Select all</button>{' '}
      <button onClick={() => select([])}>Clear selection</button>
      <button disabled={locked || !selection.length} onClick={copy}>Copy selected</button>{' '}
      <button disabled={locked || !clipboard} onClick={paste}>Paste</button>
      <label>Grid snap<input type="checkbox" checked={snap} onChange={event => setSnap(event.currentTarget.checked)} /></label>
      <p>Positions: 0.25 units. Yaw: 15°. Shift + click to add/remove selection.</p>
      <label>Mirror axis<select value={axis} onChange={event => { setAxis(event.currentTarget.value as typeof axis); setCenter(''); }}><option value="vertical">Vertical (reflect x)</option><option value="horizontal">Horizontal (reflect z)</option></select></label>
      <label>Mirror centre<input type="number" step=".01" value={center} placeholder={String(centerValue)} onInput={event => setCenter(event.currentTarget.value)} /></label>
      <label>Swap p1 and p2 owners<input type="checkbox" checked={swapOwners} onChange={event => setSwapOwners(event.currentTarget.checked)} /></label>
      <button disabled={locked || !Number.isFinite(centerValue)} onClick={() => apply({ type: 'mirror', targets: selection, axis, center: centerValue, swapOwners })}>Mirror</button>
      <p>Mirror {selection.length ? 'selected items' : 'the whole level'}.</p>
      <button disabled={locked || !doc.buildings.length && !doc.elements.length} onClick={() => apply({ type: 'auto-fit' })}>Auto-fit bounds</button>
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
    </aside>
    <ItemProperties doc={doc} selection={selection} onEdit={apply} disabled={locked} />
  </>;
}
