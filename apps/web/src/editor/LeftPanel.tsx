import type { ComponentChildren } from 'preact';
import { LegacyPanel } from './LegacyPanel.js';
import { LevelSection } from './LevelSection.js';
import type { Point } from './picking.js';

function Section({ title, id, children }: { title: string; id: string; children: ComponentChildren }) {
  return <details class="ed-section" open data-section={id}><summary class="ed-section-title">{title}</summary><div class="ed-section-body">{children}</div></details>;
}

/** Left sidebar: Level, Library, Selection. Library/Selection still render legacy content until SP02 tasks 6-8. */
export function LeftPanel({ pointer }: { pointer: Point | null }) {
  const library = (c: ComponentChildren) => <Section title="Library" id="library">{c}</Section>;
  const selection = (c: ComponentChildren) => <Section title="Selection" id="selection">{c}</Section>;
  return <div class="ed-leftpanel">
    <Section title="Level" id="level"><LevelSection /></Section>
    <LegacyPanel pointer={pointer} wrapLibrary={library} wrapSelection={selection} />
  </div>;
}
