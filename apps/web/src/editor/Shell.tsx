import type { ComponentChildren } from 'preact';

export interface ShellCounts { buildings: number; obstacles: number; players: number }

/** Editor page grid: top bar row, scrolling left slot, canvas slot. Counts are exposed as root data attributes for tests. */
export function Shell({ counts, inert, top, left, children }: { counts: ShellCounts; inert?: boolean; top: ComponentChildren; left: ComponentChildren; children: ComponentChildren }) {
  return <main class="ed-shell" inert={inert} data-buildings={counts.buildings} data-obstacles={counts.obstacles} data-players={counts.players}>
    <header class="ed-top">{top}</header>
    <aside class="ed-left" aria-label="Editor panel">{left}</aside>
    <section class="ed-canvas" aria-label="Canvas">{children}</section>
  </main>;
}
