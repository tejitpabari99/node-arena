import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { createEditorJobGate, createEditorMiddleware } from '../../src/dev/editor-middleware.js';

type Status = { unfinalized: boolean; exitCode: number; output: string };
const current: Status = { unfinalized: false, exitCode: 0, output: 'Content current' };
async function harness(runStatus: () => Promise<Status>) {
  const jobs = createEditorJobGate();
  let received = 0;
  const middleware = createEditorMiddleware('/unused/packages/content/data/levels', { jobs, runStatus });
  const server = createServer((req, res) => { received++; middleware(req, res, () => res.end()); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    jobs,
    send: (method = 'POST', headers = { 'X-NA-Editor': '1', Origin: url } as Record<string, string>, body = '{}') => fetch(`${url}/__editor/status`, { method, headers, ...(method === 'POST' ? { body } : {}) }),
    received: () => received,
    close: () => new Promise<void>(done => server.close(() => done())),
  };
}
const deferred = <T,>() => { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
it('GET, missing header, foreign Origin and oversized POST cannot start a status process', async () => {
  let calls = 0;
  const local = await harness(async () => { calls++; return current; });
  try {
    expect((await local.send('POST', {})).status).toBe(403);
    expect((await local.send('POST', { 'X-NA-Editor': '1', Origin: 'https://attacker.example' })).status).toBe(403);
    expect((await local.send('GET', {})).status).toBe(405);
    expect((await local.send('POST', undefined, 'x'.repeat(1024 * 1024 + 1))).status).toBe(413);
    expect(calls).toBe(0);
  } finally { await local.close(); }
});
it('concurrent authorized checks share one process without taking the write gate', async () => {
  let calls = 0; const held = deferred<Status>(), entered = deferred<void>();
  const local = await harness(async () => { calls++; entered.resolve(); return held.promise; });
  try {
    const requests = Array.from({ length: 4 }, () => local.send());
    await Promise.race([entered.promise, requests[0]!.then(response => { throw Error(`Unexpected response ${response.status}`); })]);
    await expect.poll(local.received).toBe(4);
    // Let all body reads reach the shared promise before completing the command.
    await new Promise<void>(done => setImmediate(done));
    expect(local.jobs.snapshot().busy).toBe(false);
    held.resolve(current);
    const responses = await Promise.all(requests);
    expect(responses.map(response => response.status)).toEqual([200, 200, 200, 200]);
    expect(await Promise.all(responses.map(response => response.json()))).toEqual([current, current, current, current]);
    expect(calls).toBe(1);
  } finally { held.resolve(current); await local.close(); }
});
it('later callers after a completed write reject the old in-flight revision instead of joining or spawning', async () => {
  let calls = 0; const held = deferred<Status>(), entered = deferred<void>();
  const local = await harness(async () => { calls++; entered.resolve(); return held.promise; });
  try {
    const first = local.send();
    await Promise.race([entered.promise, first.then(response => { throw Error(`Unexpected response ${response.status}`); })]);
    const releaseSave = local.jobs.acquireSave(); releaseSave();
    expect((await local.send()).status).toBe(409);
    expect(calls).toBe(1);
    held.resolve(current); expect((await first).status).toBe(409);
    expect((await local.send()).status).toBe(200); expect(calls).toBe(2);
  } finally { held.resolve(current); await local.close(); }
});
it('a rejected status runner releases its slot for a fresh retry', async () => {
  let calls = 0;
  const local = await harness(async () => { if (++calls === 1) throw Error('forced failure'); return current; });
  try {
    expect((await local.send()).status).toBe(500);
    const retry = await local.send(); expect(retry.status).toBe(200); expect(await retry.json()).toEqual(current);
    expect(calls).toBe(2);
  } finally { await local.close(); }
});
