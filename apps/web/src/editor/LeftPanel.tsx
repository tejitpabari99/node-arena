import type { ComponentChildren } from 'preact';
import { LibrarySection } from './LibrarySection.js';
import { SelectionSection } from './SelectionSection.js';
import { LevelSection } from './LevelSection.js';
import { useEditor } from './EditorContext.js';

function Section({ title, id, children }: { title: string; id: string; children: ComponentChildren }) {
  return <details class="ed-section" open data-section={id}><summary class="ed-section-title">{title}</summary><div class="ed-section-body">{children}</div></details>;
}

/** Left sidebar: Level, Library, Selection. Zoom/camera buttons are a minimal stand-in until the canvas controls (SP03) replace them. */
export function LeftPanel() {
  const { selection, viewport } = useEditor();
  return <div class="ed-leftpanel">
    <Section title="Level" id="level"><LevelSection /></Section>
    <Section title="Library" id="library"><LibrarySection /></Section>
    <Section title="Selection" id="selection"><SelectionSection /></Section>
    <div class="ed-view-tools" role="group" aria-label="View">
      <button type="button" aria-label="Zoom in" onClick={() => viewport.current?.zoomBy(1.2)}>+</button>{' '}
      <button type="button" aria-label="Zoom out" onClick={() => viewport.current?.zoomBy(1 / 1.2)}>−</button>{' '}
      <button type="button" onClick={() => viewport.current?.gameCamera()}>Game camera</button>
    </div>
    <p class="sr-only" data-testid="viewport-selection">{selection.length ? selection.map(item => `${item.kind}: ${item.id}`).join(', ') : 'No selection'}</p>
  </div>;
}
