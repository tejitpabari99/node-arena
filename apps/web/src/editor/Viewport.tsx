import { useEffect, useRef } from 'preact/hooks';
import type { Selection } from './picking.js';
import { useEditor } from './EditorContext.js';
import { createEditorViewport, type ViewportStatus } from './viewport-engine.js';

/** Canvas host only: owns the engine and routes its callbacks to the editor context. */
export function Viewport({ onStatus, onLos, onSelection }: { onStatus: (status: ViewportStatus) => void; onLos: (message: string) => void; onSelection: (items: Selection[]) => void }) {
  const ctx = useEditor(), latest = useRef(ctx); latest.current = ctx;
  const route = useRef({ onStatus, onLos, onSelection }); route.current = { onStatus, onLos, onSelection };
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const current = createEditorViewport(host.current!, {
      status: status => route.current.onStatus(status), los: message => route.current.onLos(message),
      selection: items => route.current.onSelection(items),
      edit: op => { if (!latest.current.locked) latest.current.edit(op); },
    });
    ctx.viewport.current = current;
    return () => { current.dispose(); delete ctx.viewport.current; };
  }, []);
  // Minimal Space-to-pan hook; Task 8 moves this into useShortcuts.
  useEffect(() => {
    let over = false, held = false;
    const el = host.current!, engine = () => ctx.viewport.current;
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName));
    const release = () => { if (held) { held = false; engine()?.setSpace(false); } };
    const enter = () => { over = true; }, leave = () => { over = false; };
    const key = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || typing(e.target)) return;
      if (e.type === 'keydown') { if (!over && !held) return; e.preventDefault(); if (!held) { held = true; engine()?.setSpace(true); } }
      else if (held) { e.preventDefault(); release(); }
    };
    el.addEventListener('pointerenter', enter); el.addEventListener('pointerleave', leave);
    window.addEventListener('keydown', key); window.addEventListener('keyup', key); window.addEventListener('blur', release);
    return () => {
      el.removeEventListener('pointerenter', enter); el.removeEventListener('pointerleave', leave);
      window.removeEventListener('keydown', key); window.removeEventListener('keyup', key); window.removeEventListener('blur', release);
    };
  }, []);
  useEffect(() => { ctx.viewport.current?.setArea(ctx.area); }, [ctx.area]);
  useEffect(() => { delete host.current!.dataset.ready; void ctx.viewport.current?.setDocument(ctx.doc); }, [ctx.doc]);
  useEffect(() => {
    if (ctx.viewportStatus.message === 'Loading preview…') delete host.current!.dataset.ready; else host.current!.dataset.ready = 'true';
  }, [ctx.viewportStatus]);
  const { viewportStatus: status } = ctx;
  return <>
    <div ref={host} class="editor-workspace" aria-label="Edit viewport" />
    {status.error !== undefined && <p role="alert" class="preview-error" data-testid="preview-error">Preview out of date — {status.error}</p>}
    <p role="status" class="sr-only" data-testid="viewport-status">{status.message}{status.rebuildMs !== undefined ? ` · ${status.rebuildMs.toFixed(1)} ms` : ''}</p>
  </>;
}
