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

/** Top-right cards of zoom/view controls over the canvas. */
export function CanvasControls({ view, hand, grid, onHand, onGrid }: { view: ViewState; hand: boolean; grid: boolean; onHand: (on: boolean) => void; onGrid: (on: boolean) => void }) {
  const { viewport } = useEditor();
  return <div class="canvas-controls" role="group" aria-label="Canvas controls" data-testid="canvas-controls">
    <div class="canvas-card canvas-card-zoom">
      <Btn label="Zoom in" disabled={view.atMax} onClick={() => viewport.current?.zoomBy(STEP)}><path d="M12 5v14M5 12h14" /></Btn>
      <Btn label="Zoom out" disabled={view.atMin} onClick={() => viewport.current?.zoomBy(1 / STEP)}><path d="M5 12h14" /></Btn>
    </div>
    <div class="canvas-card">
      <Btn label="Fit area" onClick={() => viewport.current?.fitArea()}><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /></Btn>
    </div>
    <div class="canvas-card">
      <Btn label="Game camera" onClick={() => viewport.current?.gameCamera()}><rect x="3" y="7" width="13" height="10" rx="2" /><path d="M16 11l5-3v8l-5-3" /></Btn>
    </div>
    <div class="canvas-card">
      <Btn label="Hand" pressed={hand} onClick={() => onHand(!hand)}><path d="M8 13V6a1.5 1.5 0 013 0v5M11 11V4.5a1.5 1.5 0 013 0V11M14 11V6a1.5 1.5 0 013 0v7a7 7 0 01-7 7c-2.5 0-4-1-5.5-3L4 14a1.5 1.5 0 012.5-1.5L8 14" /></Btn>
    </div>
    <div class="canvas-card">
      <Btn label="Show grid" pressed={grid} onClick={() => onGrid(!grid)}><path d="M4 4h16v16H4zM4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16" /></Btn>
    </div>
  </div>;
}
