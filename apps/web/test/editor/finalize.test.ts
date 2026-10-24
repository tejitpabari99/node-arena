import { afterAll, beforeAll, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createEditorJobGate, createEditorMiddleware } from '../../src/dev/editor-middleware.js';
import { finalizeEditorLevel, type EditorFinalizeEvent } from '../../../../tools/src/editor-finalize.js';

let dir: string, url: string, server: Server, level: Record<string, unknown>;
const jobs = createEditorJobGate();
let releaseJob: (() => void) | undefined;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'na-editor-finalize-'));
  await cp(resolve('../../packages/content/data'), join(dir, 'data'), { recursive: true });
  level = JSON.parse(await readFile(join(dir, 'data/levels/levelview-1.json'), 'utf8'));
  level.id = 'na-finalize'; delete level.source;
  await writeFile(join(dir, 'data/levels/na-finalize.json'), JSON.stringify(level));
  const middleware = createEditorMiddleware(join(dir, 'data/levels'), { jobs, runFinalize: async (_root, id, emit) => {
    emit({ type: 'started', id });
    await new Promise<void>(done => { releaseJob = done; });
    emit({ type: 'result' });
  } });
  server = createServer((req, res) => middleware(req, res, () => res.end()));
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('No server');
  url = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { releaseJob?.(); await new Promise<void>(done => server.close(() => done())); await rm(dir, { recursive: true, force: true }); });
const post = (endpoint: string, value: unknown, authenticated = true) => fetch(`${url}/__editor/${endpoint}`, { method: 'POST', headers: authenticated ? { 'X-NA-Editor': '1', Origin: url } : {}, body: JSON.stringify(value) });
it('requires a saved matching draft and writable id before starting Finalize', async () => {
  expect((await post('finalize', { id: 'na-finalize', level }, false)).status).toBe(403);
  expect((await post('finalize', { id: '../escape', level })).status).toBe(400);
  expect((await post('finalize', { id: 'levelview-1', level })).status).toBe(400);
  const stale = await post('finalize', { id: 'na-finalize', level: { ...level, name: 'Unsaved' } });
  expect(stale.status).toBe(409); expect(await stale.text()).toContain('Save');
});
it('shares the job gate with Solvable and Save through streamed completion', async () => {
  const response = await post('finalize', { id: 'na-finalize', level });
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('started');
  expect((await post('save', { id: 'na-other', level })).status).toBe(409);
  expect((await post('solvable', { id: 'na-finalize', level })).status).toBe(409);
  expect((await post('finalize', { id: 'na-finalize', level })).status).toBe(409);
  releaseJob!();
  let rest = ''; for (;;) { const chunk = await reader.read(); if (chunk.done) break; rest += new TextDecoder().decode(chunk.value); }
  expect(rest).toContain('result');
  const release = jobs.acquire(); release();
});
it('aborts at the first failing fixed command and streams its actual output and exit code', async () => {
  const events: EditorFinalizeEvent[] = [], commands: string[][] = [];
  await finalizeEditorLevel('/unused', 'na-finalize', event => events.push(event), new AbortController().signal, async (_root, command, args, output) => {
    commands.push([command, ...args]); output('forced validation failure\n'); return 17;
  });
  expect(commands).toHaveLength(1);
  expect(commands[0]!.at(-2)).toBe('validate');
  expect(events).toContainEqual({ type: 'output', step: 'validate', output: 'forced validation failure\n' });
  expect(events.at(-1)).toEqual({ type: 'error', step: 'validate', exitCode: 17, error: 'validate failed (exit 17)' });
});
it('active saves exclude jobs while queued Saves retain their existing serialization', () => {
  const gate = createEditorJobGate(), first = gate.acquireSave(), second = gate.acquireSave();
  expect(() => gate.acquire()).toThrow('already running');
  first(); expect(() => gate.acquire()).toThrow('already running');
  second(); const end = gate.acquire();
  expect(() => gate.acquireSave()).toThrow('already running'); end();
});
it('disconnect does not advance the pipeline until the active command exits', async () => {
  const abort = new AbortController(), events: EditorFinalizeEvent[] = [];
  let complete!: () => void, started!: () => void;
  const ready = new Promise<void>(done => { started = done; });
  let commands = 0;
  const job = finalizeEditorLevel('/unused', 'na-finalize', event => events.push(event), abort.signal, async () => {
    commands++; started(); await new Promise<void>(done => { complete = done; }); return 0;
  });
  await ready; abort.abort();
  expect(commands).toBe(1); complete(); await job;
  expect(commands).toBe(1); expect(events.some(event => event.type === 'result')).toBe(false);
});

it('refreshes versioned replay envelopes after locks before verification, stopping on refresh failure', async () => {
  for (const fail of [false, true]) {
    const events: EditorFinalizeEvent[] = [];
    await finalizeEditorLevel('/unused', 'na-finalize', event => events.push(event), new AbortController().signal, async (_root, _command, args) => {
      return fail && args.at(-2) === 'bots:golden' ? 23 : 0;
    });
    const steps = events.filter(event => event.type === 'step').map(event => event.step);
    expect(steps.slice(0, 8)).toEqual(['validate', 'contentVersion', 'BOT_VERSION', 'content:lock', 'levels:lock', 'build:bots', 'sim:golden', 'bots:golden']);
    if (fail) {
      expect(steps).toHaveLength(8);
      expect(events.at(-1)).toEqual({ type: 'error', step: 'bots:golden', exitCode: 23, error: 'bots:golden failed (exit 23)' });
    } else {
      expect(steps.slice(8)).toEqual(['validate:content', 'check:content', 'git diff --stat']);
      expect(events.at(-1)).toEqual({ type: 'result' });
    }
  }
});
