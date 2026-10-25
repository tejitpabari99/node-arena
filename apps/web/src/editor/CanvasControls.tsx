import type { ComponentChildren } from 'preact';
import { useEditor } from './EditorContext.js';
import type { ViewState } from './viewport-engine.js';

const GRID_KEY = 'node-arena.editor.grid';
const STEP = 1.25;
export function readGrid(): boolean { try { return localStorage.getItem(GRID_KEY) === '1'; } catch { return false; } }
export function writeGrid(on: boolean): void { try { localStorage.setItem(GRID_KEY, on ? '1' : '0'); } catch { /* storage unavailable */ } }

function Btn({ label, onClick, disabled, pressed, children }: { label: string; onClick: () => void; disabled?: boolean; pressed?: boolean; children: ComponentChildren }) {
  return <button type="button" class="canvas-btn" aria-label={label} title={label} disabled={disabled} aria-pressed={pressed} onClick={onClick}>
    <svg viewBox="0 0 24 24" aria-hidden="true">{children}</svg>
  </button>;
}

/** Top-right pill of zoom/view controls over the canvas. */
export function CanvasControls({ view, hand, grid, onHand, onGrid }: { view: ViewState; hand: boolean; grid: boolean; onHand: (on: boolean) => void; onGrid: (on: boolean) => void }) {
  const { viewport } = useEditor();
  return <div class="canvas-controls" role="group" aria-label="Canvas controls" data-testid="canvas-controls">
    <Btn label="Zoom out" disabled={view.atMin} onClick={() => viewport.current?.zoomBy(1 / STEP)}><circle cx="11" cy="11" r="7" /><path d="M8 11h6M16.5 16.5L21 21" /></Btn>
    <Btn label="Zoom in" disabled={view.atMax} onClick={() => viewport.current?.zoomBy(STEP)}><circle cx="11" cy="11" r="7" /><path d="M8 11h6M11 8v6M16.5 16.5L21 21" /></Btn>
    <Btn label="Fit area" onClick={() => viewport.current?.fitArea()}><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /></Btn>
    <Btn label="Game camera" onClick={() => viewport.current?.gameCamera()}><rect x="3" y="7" width="13" height="10" rx="2" /><path d="M16 11l5-3v8l-5-3" /></Btn>
    <Btn label="Hand" pressed={hand} onClick={() => onHand(!hand)}><path d="M8 13V6a1.5 1.5 0 013 0v5M11 11V4.5a1.5 1.5 0 013 0V11M14 11V6a1.5 1.5 0 013 0v7a7 7 0 01-7 7c-2.5 0-4-1-5.5-3L4 14a1.5 1.5 0 012.5-1.5L8 14" /></Btn>
    <Btn label="Show grid" pressed={grid} onClick={() => onGrid(!grid)}><path d="M4 4h16v16H4zM4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16" /></Btn>
  </div>;
}
