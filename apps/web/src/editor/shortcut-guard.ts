/** True when a real text selection exists, so Ctrl/Cmd+C must stay native instead of copying map items. */
export function nativeCopyWins(selection: Pick<Selection, 'isCollapsed' | 'toString'> | null): boolean {
  return !!selection && !selection.isCollapsed && selection.toString().trim() !== '';
}
