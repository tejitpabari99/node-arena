import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createServer, request, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createEditorMiddleware } from '../../src/dev/editor-middleware.js';
import { blankDocument, copyDocument } from '../../src/editor/document.js';

let server: Server;
let base: string;
beforeAll(async () => {
  const middleware = createEditorMiddleware(fileURLToPath(new URL('../../../../packages/content/data/levels', import.meta.url)));
  server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing server address');
  base = `http://127.0.0.1:${address.port}/`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });

it('lists and opens all shipped levels through the dev-only API', async () => {
  const response = await fetch(`${base}__editor/levels`);
  expect(response.headers.get('content-type')).toContain('application/json');
  const levels = await response.json() as { id: string; name: string }[];
  expect(levels.filter(level => level.id.startsWith('levelview-'))).toHaveLength(20);
  for (const level of levels) {
    const opened = await fetch(`${base}__editor/level/${level.id}`);
    expect(opened.status).toBe(200);
    expect((await opened.json() as { id: string }).id).toBe(level.id);
  }
});



it.each(['attacker.example', 'localhost.attacker.example', '127.0.0.1.attacker.example'])('refuses rebinding Host %s', async host => {
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const req = request(`${base}__editor/levels`, { headers: { host } }, response => { response.resume(); resolve(response.statusCode); });
    req.on('error', reject); req.end();
  });
  expect(status).toBe(403);
});

it.each([
  {},
  { 'X-NA-Editor': '1' },
  { Origin: 'same' },
  { 'X-NA-Editor': '1', Origin: 'https://attacker.example' },
])('refuses POST without the editor header and exact local Origin: %j', async headers => {
  const response = await fetch(`${base}__editor/save`, { method: 'POST', headers });
  expect(response.status).toBe(403);
});

it.each(['bad', 'na-', 'na-UPPER', `na-${'a'.repeat(41)}`, '%2e%2e%2fcontent', 'na-x%2f..%2fcontent', '%'])('rejects invalid read id %s', async id => {
  const response = await fetch(`${base}__editor/level/${id}`);
  expect(response.status).toBe(400);
});

it('caps POST bodies at 1 MiB before parsing Save payloads', async () => {
  const headers = { 'X-NA-Editor': '1', Origin: base.slice(0, -1) };
  const oversized = await fetch(`${base}__editor/save`, { method: 'POST', headers, body: 'x'.repeat(1024 * 1024 + 1) });
  expect(oversized.status).toBe(413);
  const allowed = await fetch(`${base}__editor/save`, { method: 'POST', headers, body: '{}' });
  expect(allowed.status).toBe(400);
});

it('starts blank and template copies without a server-owned editorVersion', () => {
  const blank = blankDocument('na-blank', 'green', 'small');
  expect(blank).not.toHaveProperty('editorVersion');
  const source = { ...blank, editorVersion: '0.0.7', source: { game: 'test', gameVersion: '1', asset: 'level' } };
  const copy = copyDocument(source, 'na-template');
  expect(copy).not.toHaveProperty('editorVersion');
  expect(copy).not.toHaveProperty('source');
  expect(source.editorVersion).toBe('0.0.7');
  expect(source.source.asset).toBe('level');
});


// Inspect the real component's button contract without mounting browser-only popover effects.
vi.mock('preact/hooks', () => ({ useRef: () => ({ current: null }), useState: () => [0, () => undefined], useEffect: () => undefined }));
it('allows Finalize for a dirty document while still disabling competing jobs', async () => {
  const { JobPopovers } = await import('../../src/editor/JobPopovers.js');
  const props: import('../../src/editor/JobPopovers.js').JobPopoversProps = { open: null, setOpen() {}, job: null, busy: false, dirty: true, onCheck() {}, onCancel() {}, onFinalize() {}, checkIssues: [], issueLabel: () => '', checkError: '', proxyEvents: [], finalizeEvents: [], finalizeError: '', lockStatus: 'current', lockOutput: '' };
  function button(busy: boolean) {
    const root = JobPopovers({ ...props, busy });
    const wrap = (root.props.children as preact.VNode[])[1]!;
    return (wrap.props as { children: preact.VNode[] }).children[0]!.props as unknown as { disabled: boolean };
  }
  expect(button(false).disabled).toBe(false);
  expect(button(true).disabled).toBe(true);
});
