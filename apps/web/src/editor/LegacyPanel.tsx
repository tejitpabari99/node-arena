import { useEffect, useState } from 'preact/hooks';
import { snapYaw, type DocOp } from './model.js';
import type { Point } from './picking.js';
import { useEditor } from './EditorContext.js';

/** Temporary pre-redesign sidebar; consumes EditorContext. SP02 deletes this file. */
export function LegacyPanel({ pointer }: { pointer: Point | null }) {
  const { doc, edit, selection, viewport, locked } = useEditor();
  const [snap, setSnap] = useState(true);
  function apply(op: DocOp) { if (!locked) edit(op.type === 'obstacle-properties' ? { ...op, value: op.value.yawDeg === undefined ? op.value : { ...op.value, yawDeg: snapYaw(op.value.yawDeg, snap) } } : op); }
  useEffect(() => { viewport.current?.setSnap(snap); }, [snap]);
  return <>
    <aside class="editor-view-tools" aria-label="Viewport tools">
      <h3>Layout</h3>
      <label>Grid snap<input type="checkbox" checked={snap} onChange={event => setSnap(event.currentTarget.checked)} /></label>
      <p>Positions: 0.25 units. Yaw: 15°. Shift + click to add/remove selection.</p>
      <button disabled={locked || !doc.buildings.length && !doc.elements.length} onClick={() => apply({ type: 'auto-fit' })}>Auto-fit bounds</button>
      <p>2-unit margin around all item positions. Draft bounds; Save writes them.</p>
      <p data-testid="bounds-preview">x {String(doc.bounds.minX).replace('-', '−')}…{doc.bounds.maxX} · z {String(doc.bounds.minZ).replace('-', '−')}…{doc.bounds.maxZ}</p>
      <h3>View</h3>
      <button onClick={() => viewport.current?.zoomBy(1.2)} aria-label="Zoom in">+</button>{' '}
      <button onClick={() => viewport.current?.zoomBy(1 / 1.2)} aria-label="Zoom out">−</button>
      <p><button onClick={() => viewport.current?.gameCamera()}>Game camera</button></p>
      <p>Wheel to zoom. Middle/right drag or Alt + drag to pan.</p>
      <p>Click to select. Drag on empty ground for marquee.</p>
      <p data-testid="viewport-selection">{selection.length ? selection.map(item => `${item.kind}: ${item.id}`).join(', ') : 'No selection'}</p>
      <p aria-live="off">{pointer ? `x ${pointer.x.toFixed(2)} · z ${pointer.z.toFixed(2)}` : 'Ground coordinates'}</p>
    </aside>
  </>;
}
