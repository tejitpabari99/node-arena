import { describe, expect, it } from 'vitest';
import type { VNode } from 'preact';
import { Credits, credits, parseCredits } from '../src/ui/Credits';
function walk(node: unknown, out: { text: string[]; hrefs: string[] }) {
  if (node == null || typeof node === 'boolean') return out;
  if (typeof node === 'string' || typeof node === 'number') { out.text.push(String(node)); return out; }
  if (Array.isArray(node)) { node.forEach((n) => walk(n, out)); return out; }
  const { props } = node as VNode<{ href?: string; children?: unknown }>;
  if (props.href) out.hrefs.push(props.href);
  return walk(props.children, out);
}
describe('credits screen', () => {
  it('parses CREDITS.md rows into grouped pack entries', () => {
    expect(credits.length).toBeGreaterThan(0);
    expect(credits.find((c) => c.title.startsWith('City Kit Commercial'))).toMatchObject({ author: 'Kenney', licence: 'CC0 1.0', url: 'https://kenney.nl/assets/city-kit-commercial' });
    expect(new Set(credits.map((c) => c.title)).size).toBe(credits.length);
  });
  it('renders title, author, licence and source link for every entry', () => {
    const entries = parseCredits('| File | Pack |\n| models/a.glb | Pack A (`a.glb`) | Ann | https://example.com/a | CC0 1.0 | x |\n| audio/b.ogg | Pack B | Bob | https://example.com/b | CC-BY 4.0 (page) | x |');
    const { text, hrefs } = walk(Credits({ entries, onBack: () => {} }), { text: [], hrefs: [] });
    expect(hrefs).toEqual(['https://example.com/a', 'https://example.com/b']);
    expect(text.join(' ')).toContain('Pack A'); expect(text.join(' ')).toContain('Bob'); expect(text.join(' ')).toContain('CC-BY 4.0');
    const real = walk(Credits({ onBack: () => {} }), { text: [], hrefs: [] });
    expect(real.hrefs).toEqual(credits.map((c) => c.url));
  });
});
