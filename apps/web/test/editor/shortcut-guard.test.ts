import { describe, expect, it } from 'vitest';
import { nativeCopyWins } from '../../src/editor/shortcut-guard.js';

const sel = (text: string, collapsed = text === '') => ({ isCollapsed: collapsed, toString: () => text });
describe('copy shortcut guard', () => {
  it('lets native copy win when text is selected', () => { expect(nativeCopyWins(sel('abc'))).toBe(true); });
  it('lets the map copy run with no / collapsed / blank selection', () => {
    expect(nativeCopyWins(null)).toBe(false);
    expect(nativeCopyWins(sel(''))).toBe(false);
    expect(nativeCopyWins(sel('  \n', false))).toBe(false);
  });
});
