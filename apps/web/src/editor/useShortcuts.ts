import { useEffect, useRef } from 'preact/hooks';
import type { RefObject } from 'preact';
import { useEditor } from './EditorContext.js';

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName));

/** Window-level editing shortcuts plus hold-Space panning (only over the canvas). */
export function useShortcuts(host: RefObject<HTMLElement>) {
  const ctx = useEditor(), latest = useRef(ctx); latest.current = ctx;
  useEffect(() => {
    let over = false, held = false;
    const el = host.current!, engine = () => latest.current.viewport.current;
    const release = () => { if (held) { held = false; engine()?.setSpace(false); } };
    const enter = () => { over = true; }, leave = () => { over = false; };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space' && held) { e.preventDefault(); release(); } };
    const down = (e: KeyboardEvent) => {
      const c = latest.current;
      if (typing(e.target)) return;
      if (e.code === 'Space') {
        if (c.locked || document.querySelector('[aria-modal=true]')) return;
        if (!over && !held) return;
        e.preventDefault(); if (!held) { held = true; engine()?.setSpace(true); }
        return;
      }
      if (c.locked || document.querySelector('[aria-modal=true]')) return;
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (!mod && !e.altKey && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); c.deleteSelection(); }
      else if (!mod && e.key === 'Escape') { if (!engine()?.cancelPlacement() && c.selection.length) c.select([]); }
      else if (mod && !e.altKey && k === 'c') { e.preventDefault(); c.copy(); }
      else if (mod && !e.altKey && k === 'v') { e.preventDefault(); c.paste(); }
      else if (mod && !e.altKey && k === 's') { e.preventDefault(); void c.save('manual'); }
      else if (mod && !e.altKey && k === 'z') { e.preventDefault(); c.dispatch({ type: e.shiftKey ? 'redo' : 'undo' }); }
      else if (mod && !e.altKey && !e.shiftKey && k === 'y') { e.preventDefault(); c.dispatch({ type: 'redo' }); }
    };
    el.addEventListener('pointerenter', enter); el.addEventListener('pointerleave', leave);
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', release);
    return () => {
      el.removeEventListener('pointerenter', enter); el.removeEventListener('pointerleave', leave);
      window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', release);
    };
  }, []);
}
