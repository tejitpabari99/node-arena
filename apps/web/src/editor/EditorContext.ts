import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { LevelDoc } from './document.js';
import type { Area, Clipboard, DocHistory, DocOp, HistoryAction } from './model.js';
import type { Selection } from './picking.js';
import type { EditorViewport, ViewportStatus } from './viewport-engine.js';

export type EditorArea = Area;

/** Shared editor state: Editor.tsx provides it; Viewport and panels consume it. */
export interface EditorContext {
  doc: LevelDoc;
  history: DocHistory;
  dispatch(a: HistoryAction): void;
  edit(op: DocOp): void;
  deleteSelection(): void;
  area: EditorArea;
  selection: Selection[];
  select(next: Selection[]): void;
  clipboard?: Clipboard | undefined;
  copy(): void;
  paste(): void;
  viewport: { current?: EditorViewport | undefined };
  locked: boolean;
  save(source?: 'manual' | 'auto'): Promise<void>;
  saveState: 'saved' | 'saving' | 'unsaved' | 'error';
  dirty: boolean;
  themes: string[];
  colors: string[];
  /** manifest palette colorKey -> CSS color */
  palettes: Record<string, string>;
  /** temp: engine -> Editor routing for LegacyPanel/tests */
  viewportStatus: ViewportStatus;
  losStatus: string;
}

export const EditorCtx = createContext<EditorContext | null>(null);

export function useEditor(): EditorContext {
  const value = useContext(EditorCtx);
  if (!value) throw new Error('useEditor must be used inside the editor provider.');
  return value;
}
