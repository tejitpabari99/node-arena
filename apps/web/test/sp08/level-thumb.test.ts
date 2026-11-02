import { describe, expect, it, vi } from 'vitest';
import type { VNode } from 'preact';
import type { LevelThumbnailService } from '../../src/render/level-thumbnail';
import { mount } from '../pvp/mini-hooks';

vi.mock('preact/hooks', () => import('../pvp/mini-hooks'));
const { LevelThumb } = await import('../../src/ui/Picker');

type N = VNode<Record<string, unknown>>;
function fakeThumbs(initial: Record<string, string> = {}) {
  const urls = new Map(Object.entries(initial)), cbs = new Set<() => void>();
  const unsub = vi.fn();
  const svc = {
    get: vi.fn((id: string) => urls.get(id)), request: vi.fn(),
    subscribe: vi.fn((cb: () => void) => { cbs.add(cb); return () => { unsub(); cbs.delete(cb); }; }), dispose: vi.fn(),
  } satisfies LevelThumbnailService;
  return { svc, unsub, set: (id: string, url: string) => urls.set(id, url), notify: () => [...cbs].forEach((f) => f()), listeners: () => cbs.size };
}

describe('LevelThumb', () => {
  it('renders a placeholder without a service', () => {
    const m = mount(LevelThumb, { id: 'a' }), n = m.output as N;
    expect(n.type).toBe('i'); expect(n.props.class).toBe('level-thumb placeholder'); expect(n.props['aria-hidden']).toBe('true');
    m.unmount();
  });
  it('renders a placeholder while the service has no image, then an <img alt=""> after notify, and requests the level once', () => {
    const t = fakeThumbs();
    const m = mount(LevelThumb, { thumbs: t.svc, id: 'a' });
    expect((m.output as N).type).toBe('i');
    expect(t.svc.request).toHaveBeenCalledOnce(); expect(t.svc.request).toHaveBeenCalledWith('a');
    expect(t.listeners()).toBe(1);
    t.set('a', 'data:image/png;base64,AAA'); t.notify();
    const img = m.output as N;
    expect(img.type).toBe('img'); expect(img.props.alt).toBe(''); expect(img.props.src).toBe('data:image/png;base64,AAA'); expect(img.props.draggable).toBe(false);
    expect(t.svc.request).toHaveBeenCalledOnce(); // re-render does not re-request
    m.unmount();
  });
  it('a failed render (get stays undefined) keeps the placeholder after notify', () => {
    const t = fakeThumbs(), m = mount(LevelThumb, { thumbs: t.svc, id: 'bad' });
    t.notify();
    expect((m.output as N).type).toBe('i');
    m.unmount();
  });
  it('shows a cached image immediately', () => {
    const t = fakeThumbs({ a: 'data:x' }), m = mount(LevelThumb, { thumbs: t.svc, id: 'a' });
    expect((m.output as N).type).toBe('img');
    m.unmount();
  });
  it('unsubscribes on unmount and on id change; resubscribes and requests the new id', () => {
    const t = fakeThumbs(), m = mount(LevelThumb, { thumbs: t.svc, id: 'a' });
    m.update({ thumbs: t.svc, id: 'b' });
    expect(t.unsub).toHaveBeenCalledOnce(); expect(t.svc.request.mock.calls).toEqual([['a'], ['b']]); expect(t.listeners()).toBe(1);
    m.unmount();
    expect(t.unsub).toHaveBeenCalledTimes(2); expect(t.listeners()).toBe(0);
  });
});
