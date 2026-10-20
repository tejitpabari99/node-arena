import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio, UI_TOKENS as T } from '../src/ui/tokens';

// Task 5 palette contrast. All text pairs below are normal-size or bold >= 14px; we require the strict WCAG AA 4.5:1 for every pair
// (no large-text 3:1 allowance used). Headings are white fill with a dark-blue outline over the navy panel, so the fill/panel pair is checked.
const pairs: Array<[string, string, string]> = [
  ['primary button text', T.white, T.blueDeep],
  ['heading (white fill) on panel', T.white, T.navy],
  ['body text on panel', T.white, T.navy],
  ['eyebrow/subtle (sand) on panel', T.sand, T.navy],
  ['secondary button text', T.ink, T.sand],
  ['level number on sand card', T.blueDeep, T.sand],
  ['brand subtitle on sand', T.ink, T.sand],
  ['heading outline vs fill', T.white, T.blueDark],
];

describe('UI palette contrast (R4)', () => {
  // Panel h2 headings are 44px bold (WCAG large text): white fill on the --c-blue ribbon only needs 3:1 (dark outline adds edge contrast).
  it('large heading white on blue ribbon >= 3:1 (large-text rule)', () => {
    expect(contrastRatio(T.white, T.blue)).toBeGreaterThanOrEqual(3);
  });
  for (const [name, fg, bg] of pairs) {
    it(`${name} >= 4.5:1`, () => {
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
    });
  }
  it('style.css :root custom properties mirror UI_TOKENS', () => {
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    const map: Record<string, string> = {
      '--c-blue': T.blue, '--c-blue-deep': T.blueDeep, '--c-blue-dark': T.blueDark, '--c-navy': T.navy,
      '--c-sand': T.sand, '--c-sand-dark': T.sandDark, '--c-grass': T.grass, '--c-ink': T.ink, '--c-white': T.white,
    };
    for (const [k, v] of Object.entries(map)) {
      const m = new RegExp(`${k}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
      expect(m?.[1]?.toLowerCase(), k).toBe(v.toLowerCase());
    }
  });
});
