import { h, render } from 'preact';
import { blankDocument } from '../../src/editor/document.js';
import { EditorCtx, type EditorContext } from '../../src/editor/EditorContext.js';
import { LevelSection } from '../../src/editor/LevelSection.js';
import type { DocOp } from '../../src/editor/model.js';

export const ops: DocOp[] = [];

export function mount() {
  const host = document.createElement('div');
  host.id = 'level-section-fixture';
  Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '1000', background: 'white' });
  document.body.append(host);
  // Supply the real LevelSection's context dependencies; capture its outgoing edit boundary.
  const context = {
    doc: blankDocument('na-level-section', 'green', 'small'),
    edit: (op: DocOp) => { ops.push(op); },
    themes: ['green', 'snow'], colors: ['blue', 'red', 'green', 'yellow'], palettes: {}, locked: false,
  } satisfies Pick<EditorContext, 'doc' | 'edit' | 'themes' | 'colors' | 'palettes' | 'locked'>;
  render(h(EditorCtx.Provider, { value: context as EditorContext }, h(LevelSection, {})), host);
}
