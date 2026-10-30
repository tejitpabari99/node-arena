import type { ComponentChildren } from 'preact';
import { FileMenu, type FileMenuProps } from './FileMenu.js';
import { SaveStatus, type SaveStatusProps } from './SaveStatus.js';
import { useEditor } from './EditorContext.js';

export interface TopBarProps extends Omit<SaveStatusProps, 'saveState'> {
  file: FileMenuProps;
  onBack(): void;
  onPlay(): void;
  share: ComponentChildren;
}
/** Minimal toolbar; controlled surfaces and job state live in Editor. */
export function TopBar({ file, onBack, onPlay, share, ...status }: TopBarProps) {
  const { doc, locked, saveState, save } = useEditor();
  return <>
    <button type="button" class="ed-btn" data-testid="back" disabled={locked} onClick={onBack}>← Back</button>
    <FileMenu {...file} />
    <span class="ed-top-spacer" />
    <SaveStatus {...status} saveState={saveState} />
    <button type="button" class="ed-btn ed-btn-primary" disabled={locked} onClick={() => { void save('manual'); }}>Save</button>
    {doc.objective !== 'pvp' && <button type="button" class="ed-btn ed-btn-icon" aria-label="Play" title="Play" disabled={locked} onClick={onPlay}><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 2.5v11L13 8z" /></svg></button>}
    {share}
  </>;
}
