import type { ComponentChildren } from 'preact';
import { LibrarySection } from './LibrarySection.js';
import { LegacyPanel } from './LegacyPanel.js';
import { SelectionSection } from './SelectionSection.js';
import { LevelSection } from './LevelSection.js';
import type { Point } from './picking.js';

function Section({ title, id, children }: { title: string; id: string; children: ComponentChildren }) {
  return <details class="ed-section" open data-section={id}><summary class="ed-section-title">{title}</summary><div class="ed-section-body">{children}</div></details>;
}

/** Left sidebar: Level, Library, Selection. */
export function LeftPanel({ pointer }: { pointer: Point | null }) {
  return <div class="ed-leftpanel">
    <Section title="Level" id="level"><LevelSection /></Section>
    <Section title="Library" id="library"><LibrarySection /></Section>
    <Section title="Selection" id="selection"><SelectionSection /></Section>
    <LegacyPanel pointer={pointer} />
  </div>;
}
