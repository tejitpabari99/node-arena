import type { ComponentChildren } from 'preact';
import { LibrarySection } from './LibrarySection.js';
import { LegacyPanel } from './LegacyPanel.js';
import { LevelSection } from './LevelSection.js';
import type { Point } from './picking.js';

function Section({ title, id, children }: { title: string; id: string; children: ComponentChildren }) {
  return <details class="ed-section" open data-section={id}><summary class="ed-section-title">{title}</summary><div class="ed-section-body">{children}</div></details>;
}

/** Left sidebar: Level, Library, Selection. Selection still renders legacy content until SP02 tasks 7-8. */
export function LeftPanel({ pointer }: { pointer: Point | null }) {
  const selection = (c: ComponentChildren) => <Section title="Selection" id="selection">{c}</Section>;
  return <div class="ed-leftpanel">
    <Section title="Level" id="level"><LevelSection /></Section>
    <Section title="Library" id="library"><LibrarySection /></Section>
    <LegacyPanel pointer={pointer} wrapSelection={selection} />
  </div>;
}
