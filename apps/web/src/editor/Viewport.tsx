import { useEffect, useRef, useState } from 'preact/hooks';
import type { DocOp, LibraryItem } from './model.js';
import type { LevelDoc } from './document.js';
import type { Point, Selection } from './picking.js';
import { createEditorViewport, type EditorViewport, type ViewportStatus } from './viewport.js';

export function Viewport({ doc, onEdit, disabled = false }: { doc: LevelDoc; onEdit?: (op: DocOp) => void; disabled?: boolean }) {
  const edit = useRef(onEdit), locked = useRef(disabled); edit.current = onEdit; locked.current = disabled;
  const host = useRef<HTMLDivElement>(null), viewport = useRef<EditorViewport>();
  const [status, setStatus] = useState<ViewportStatus>({ message: 'Loading preview…' });
  const [selection, setSelection] = useState<Selection[]>([]);
  const [pointer, setPointer] = useState<Point | null>(null);
  useEffect(() => {
    const current = createEditorViewport(host.current!, { status: setStatus, selection: setSelection, pointer: setPointer, edit: op => { if (!locked.current) edit.current?.(op); } });
    viewport.current = current;
    return () => { current.dispose(); viewport.current = undefined; };
  }, []);
  useEffect(() => { void viewport.current?.setDocument(doc); }, [doc]);
  return <div class="editor-view-layout">
    <aside class="editor-view-tools" aria-label="Viewport tools">
      <h3>Library</h3>
      {(['house-wt1', 'house-wt2', 'tower', 'obstacle-small', 'obstacle-big'] as LibraryItem[]).map(item => <button key={item} class="editor-library-item" disabled={disabled} aria-label={`Place ${item}`} onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault(); viewport.current?.beginPlacement(item, event.pointerId);
      }}>{item.replace('obstacle-', 'Obstacle ')}</button>)}
      <p>Drag an item onto the view. Drag a selected item to move it.</p>
      <button disabled={disabled || selection.length !== 1} onClick={() => { if (selection[0]) onEdit?.({ type: 'delete', target: selection[0] }); }}>Delete selected</button>
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
    <div ref={host} class="editor-workspace" aria-label="Edit viewport" />
  </div>;
}
