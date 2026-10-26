import { expect, it, vi } from 'vitest';
import type { VNode } from 'preact';
import type { SharePanelProps } from '../../src/editor/SharePanel.js';
import { blankDocument } from '../../src/editor/document.js';

vi.mock('preact/hooks', () => ({ useRef: () => ({ current: null }), useLayoutEffect: () => undefined }));
const defaults = (): SharePanelProps => ({ open: true, onOpenChange() {}, savedDoc: null, locked: false, busy: false, job: null, onSave() {}, onCheck() {}, onCancel() {}, onFinalize() {}, onDetails() {}, proxyEvents: [], finalizeEvents: [], finalizeError: '', lockStatus: 'current', lockOutput: '' });
function all(node: unknown): VNode<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(all);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const vnode = node as VNode<Record<string, unknown>>;
  return [vnode, ...all(vnode.props.children)];
}
async function tree(props: Partial<SharePanelProps> = {}) {
  const { SharePanel } = await import('../../src/editor/SharePanel.js');
  return all(SharePanel({ ...defaults(), ...props }));
}
it('renders manual Save, Finalize and Check actions as real VNodes without dismissing the panel', async () => {
  const calls: string[] = [];
  const nodes = await tree({ onSave: kind => { calls.push(kind); }, onFinalize: () => calls.push('finalize'), onCheck: () => calls.push('check'), onOpenChange: () => calls.push('dismiss') });
  for (const name of ['Save', 'Finalize', 'Check']) {
    const button = nodes.find(node => node.type === 'button' && all(node.props.children).length === 0 && node.props.children === name)
      ?? nodes.find(node => node.type === 'button' && Array.isArray(node.props.children) && node.props.children.includes(name));
    expect(button, name).toBeDefined();
    (button!.props.onClick as () => void)();
  }
  expect(calls).toEqual(['manual', 'finalize', 'check']);
});
it('locks Save only when locked and job actions only while busy; dirty state is not required', async () => {
  for (const [locked, busy] of [[false, false], [true, false], [false, true], [true, true]] as const) {
    const nodes = await tree({ locked, busy });
    for (const name of ['Save', 'Finalize', 'Check']) {
      const button = nodes.find(node => node.type === 'button' && (node.props.children === name || Array.isArray(node.props.children) && node.props.children.includes(name)))!;
      expect(button.props.disabled, name).toBe(name === 'Save' ? locked : busy);
    }
  }
});
it('uses saved document version, with 0.0.0 for a never saved document', async () => {
  const savedDoc = { ...blankDocument('na-version', 'green', 'small'), editorVersion: '0.0.7' };
  for (const [doc, expected] of [[null, 'Version 0.0.0'], [savedDoc, 'Version 0.0.7']] as const) {
    const footer = (await tree({ savedDoc: doc })).find(node => node.props['data-testid'] === 'editor-version');
    expect(footer?.props.children).toBe(expected);
  }
});
