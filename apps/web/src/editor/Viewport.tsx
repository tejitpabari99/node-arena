import { useEffect, useRef, useState } from 'preact/hooks';
import type { Selection } from './picking.js';
import { useEditor } from './EditorContext.js';
import { createEditorViewport, type ViewportStatus, type ViewState } from './viewport-engine.js';
import { useShortcuts } from './useShortcuts.js';
import { CanvasControls, readGrid, writeGrid } from './CanvasControls.js';

/** Canvas host only: owns the engine and routes its callbacks to the editor context. */
export function Viewport({ onStatus, onLos, onSelection }: { onStatus: (status: ViewportStatus) => void; onLos: (message: string) => void; onSelection: (items: Selection[]) => void }) {
  const ctx = useEditor(), latest = useRef(ctx); latest.current = ctx;
  const route = useRef({ onStatus, onLos, onSelection }); route.current = { onStatus, onLos, onSelection };
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewState>({ zoom: 1, min: 1, max: 1, atMin: false, atMax: false });
  const [hand, setHand] = useState(false), [grid, setGrid] = useState(readGrid);
  useEffect(() => {
    const current = createEditorViewport(host.current!, {
      status: status => route.current.onStatus(status), los: message => route.current.onLos(message),
      selection: items => route.current.onSelection(items),
      view: next => setView(next),
      edit: op => { if (!latest.current.locked) latest.current.edit(op); },
    });
    ctx.viewport.current = current;
    current.setGrid(grid);
    return () => { current.dispose(); delete ctx.viewport.current; };
  }, []);
  useShortcuts(host);
  useEffect(() => { ctx.viewport.current?.setHand(hand); }, [hand]);
  useEffect(() => { ctx.viewport.current?.setGrid(grid); }, [grid]);
  useEffect(() => { ctx.viewport.current?.setArea(ctx.area); }, [ctx.area]);
  useEffect(() => { delete host.current!.dataset.ready; void ctx.viewport.current?.setDocument(ctx.doc); }, [ctx.doc]);
  useEffect(() => {
    if (ctx.viewportStatus.message === 'Loading preview…') delete host.current!.dataset.ready; else host.current!.dataset.ready = 'true';
  }, [ctx.viewportStatus]);
  const { viewportStatus: status } = ctx;
  return <>
    <div ref={host} class="editor-workspace" aria-label="Edit viewport" />
    <CanvasControls view={view} hand={hand} grid={grid} onHand={setHand} onGrid={on => { setGrid(on); writeGrid(on); }} />
    {status.error !== undefined && <p role="alert" class="preview-error" data-testid="preview-error">Preview out of date — {status.error}</p>}
    <p role="status" class="sr-only" data-testid="viewport-status">{status.message}{status.rebuildMs !== undefined ? ` · ${status.rebuildMs.toFixed(1)} ms` : ''}</p>
  </>;
}
