import { Menu } from './Menu.js';
import { useEditor } from './EditorContext.js';

export interface FileMenuProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  onCreate(): void;
  onOpen(): void;
  onDuplicate(): void;
}
export function FileMenu(p: FileMenuProps) {
  const { history, savedDoc, locked, dispatch } = useEditor();
  return <Menu id="editor-file-menu" label="File ▾" open={p.open} onOpenChange={p.onOpenChange} disabled={locked} triggerTestId="file-menu-button" testId="file-menu" items={[
    { id: 'menu-create', label: 'Create…', disabled: locked, onSelect: p.onCreate },
    { id: 'menu-duplicate', label: 'Duplicate', disabled: locked || savedDoc === null, onSelect: p.onDuplicate },
    { id: 'menu-open', label: 'Open…', disabled: locked, onSelect: p.onOpen },
    { id: 'file-history-separator', separator: true },
    { id: 'menu-undo', label: 'Undo', kbd: 'Ctrl+Z', disabled: locked || !history.past.length, onSelect: () => dispatch({ type: 'undo' }) },
    { id: 'menu-redo', label: 'Redo', kbd: 'Ctrl+Y', disabled: locked || !history.future.length, onSelect: () => dispatch({ type: 'redo' }) },
  ]} />;
}
