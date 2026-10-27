import { render } from 'preact';
import { useState } from 'preact/hooks';
import { EditorCtx, type EditorContext } from '../../src/editor/EditorContext.js';
import { TopBar } from '../../src/editor/TopBar.js';
import { SharePanel } from '../../src/editor/SharePanel.js';
import { blankDocument } from '../../src/editor/document.js';
import { createHistory } from '../../src/editor/model.js';
import { createWebGlThumbnailRenderer } from '../../src/editor/thumbnails.js';
import '../../src/editor/style.css';

const initial = { ...blankDocument('na-toolbar', 'green', 'small'), buildings: [] as ReturnType<typeof blankDocument>['buildings'] };
function Fixture() {
  const [locked, setLocked] = useState(false), [share, setShare] = useState(false), [file, setFile] = useState(false);
  const [calls, setCalls] = useState<string[]>([]), [images, setImages] = useState<Record<string, string>>({});
  const call = (name: string) => setCalls(values => [...values, name]);
  const context: EditorContext = {
    doc: initial, savedDoc: initial, history: createHistory(initial), dispatch() {}, edit() {}, endEditBurst() {}, placeCenter() {},
    selection: [], select() {}, area: initial.bounds, locked, dirty: false, deleteSelection() {}, copy() {}, paste() {}, viewport: {},
    async save(source) { call(`save:${source}`); }, saveState: 'saved', themes: ['green', 'snow'], colors: ['blue', 'red'], palettes: {}, viewportStatus: { message: '' }, losStatus: '',
  };
  const sharing = <SharePanel open={share} onOpenChange={setShare} savedDoc={initial} locked={locked} busy={locked} job={null} onSave={kind => { void context.save(kind); }} onCheck={() => call('check')} onCancel={() => call('cancel')} onFinalize={() => call('finalize')} onDetails={() => call('details')} proxyEvents={[]} finalizeEvents={[]} finalizeError="" lockStatus="current" lockOutput="" />;
  async function thumbnails() {
    const renderer = await createWebGlThumbnailRenderer();
    try {
      const next: Record<string, string> = {};
      for (const item of ['house-wt1', 'house-wt2', 'tower'] as const) next[item] = await renderer.render(item);
      setImages(next);
    } finally { renderer.dispose(); }
  }
  return <EditorCtx.Provider value={context}><main class="ed-shell" style={{ display: 'block' }}><header class="ed-top" style={{ height: 56 }}>
    <TopBar file={{ open: file, onOpenChange: setFile, onCreate() {}, onOpen() {}, onDuplicate() {} }} onBack={() => call('back')} onPlay={() => call('play')} share={sharing} issues={[]} warnings={[]} saveMessage="" failureSeq={0} issueLabel={issue => issue.message} />
  </header><button onClick={() => setLocked(!locked)}>Toggle lock</button><button onClick={() => { void thumbnails(); }}>Render thumbnails</button><output data-testid="calls">{calls.join(',')}</output><div data-testid="thumbnails">{Object.entries(images).map(([item, src]) => <img key={item} alt={item} src={src} />)}</div></main></EditorCtx.Provider>;
}
render(<Fixture />, document.getElementById('app')!);
