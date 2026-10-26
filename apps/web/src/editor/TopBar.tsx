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
  const { locked, saveState } = useEditor();
  return <>
    <button type="button" class="ed-btn" data-testid="back" disabled={locked} onClick={onBack}>← Back</button>
    <FileMenu {...file} />
    <span class="ed-top-spacer" />
    <SaveStatus {...status} saveState={saveState} />
    <button type="button" class="ed-btn" disabled={locked} onClick={onPlay}>Play</button>
    {share}
  </>;
}
