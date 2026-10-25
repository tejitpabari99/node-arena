import type { ComponentChildren } from 'preact';
import { LibrarySection } from './LibrarySection.js';
import { SelectionSection } from './SelectionSection.js';
import { LevelSection } from './LevelSection.js';
import { useEditor } from './EditorContext.js';

function Section({ title, id, children }: { title: string; id: string; children: ComponentChildren }) {
  return <details class="ed-section" open data-section={id}><summary class="ed-section-title">{title}</summary><div class="ed-section-body">{children}</div></details>;
}

/** Left sidebar: Level, Library, Selection. */
export function LeftPanel() {
  const { selection } = useEditor();
  return <div class="ed-leftpanel">
    <Section title="Level" id="level"><LevelSection /></Section>
    <Section title="Library" id="library"><LibrarySection /></Section>
    <Section title="Selection" id="selection"><SelectionSection /></Section>
    <p class="sr-only" data-testid="viewport-selection">{selection.length ? selection.map(item => `${item.kind}: ${item.id}`).join(', ') : 'No selection'}</p>
  </div>;
}
