import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const module = await import('../runner.mjs').catch(() => null);

async function fixture(t, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'kane-assure-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = join(root, 'tools/kane/assure');
  const bin = join(root, 'bin');
  await mkdir(cwd, { recursive: true });
  await mkdir(bin);
  await writeFile(join(cwd, 'build-excerpt.mjs'), 'process.stdout.write("excerpt from rules\\n");\n');
  const stub = `#!${process.execPath}
import { appendFileSync, readFileSync } from 'node:fs';
const args = process.argv.slice(2);
const kind = process.argv[1].endsWith('/pnpm') ? 'pnpm' : 'kane';
appendFileSync(process.env.CALLS, JSON.stringify({kind,args,cwd:process.cwd(),stdin:readFileSync(0,'utf8'),agent:process.env.KANE_CLI_USER_AGENT})+'\\n');
if (kind==='pnpm') {
 const count=readFileSync(process.env.CALLS,'utf8').trim().split('\\n').map(line=>JSON.parse(line)).filter(row=>row.kind==='pnpm').length;
 const sequence=JSON.parse(process.env.CREDIT_SEQUENCE ?? '[]');
 console.log('> script banner\\n'+JSON.stringify({credits:Number(sequence[count-1] ?? process.env.CREDITS ?? 300)})); process.exit(0);
}
if (args[0]==='context' && args[1]==='list') {
 for (const row of JSON.parse(process.env.ROWS ?? '[]')) console.log(JSON.stringify(row));
} else {
 console.log(JSON.stringify({type:process.env.PAUSE ? 'session_paused' : 'done',resume:'kane-cli context extract --resume session-42 --mode agent',pending_questions:[{text:'Which requirement?'}]}));
 process.exit(Number(process.env.KANE_EXIT ?? 0));
}
`;
  for (const name of ['pnpm', 'kane-cli']) {
    await writeFile(join(bin, name), stub);
    await chmod(join(bin, name), 0o755);
  }
  const logs = [];
  let previews = 0;
  let cleaned = 0;
  const calls = join(root, 'calls.jsonl');
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, CALLS: calls, ROWS: JSON.stringify([
    { id: 'uc-1', cid: 'cid-uc', label: 'usecase', title: 'Draw routes', trust: 'trusted', fresh: 'fresh' },
    { id: 'uc-2', label: 'usecase', title: 'Cut routes', trust: 'derived', fresh: 'fresh' },
    { id: 't-1', label: 'test', title: 'Draw route', trust: 'trusted', fresh: 'fresh' },
    { id: 't-2', label: 'test', title: 'Cut route', trust: 'derived', fresh: 'fresh' },
  ]), ...overrides };
  return {
    root, cwd, env,
    async run(args) {
      assert.equal(typeof module?.runAssure, 'function', 'runAssure must be implemented');
      return module.runAssure(args, { root, env, stdout: value => logs.push(value), stderr: value => logs.push(value),
        preview: async options => { previews++; assert.equal(options.url, 'http://localhost:4173/?kane=1'); assert.equal(options.cwd, root); return async () => { cleaned++; }; },
        chrome: async () => '/stub/chrome',
      });
    },
    async calls() { return (await readFile(calls, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); },
    get logs() { return logs.join(''); }, get previews() { return previews; }, get cleaned() { return cleaned; },
  };
}

test('rejects unknown stages/options before spawning commands', async t => {
  const f = await fixture(t);
  assert.equal(await f.run(['all']), 2);
  assert.equal(await f.run(['extract', '--allow-unreviewed']), 2);
  assert.deepEqual(await f.calls(), []);
});

test('excerpt and ingest are independent free stages in the scoped cwd with closed stdin', async t => {
  const f = await fixture(t);
  assert.equal(await f.run(['excerpt']), 0);
  assert.equal(await readFile(join(f.cwd, 'excerpt.md'), 'utf8'), 'excerpt from rules\n');
  assert.equal(await f.run(['ingest']), 0);
  const calls = await f.calls();
  assert.deepEqual(calls.map(c => [c.kind, c.args]), [['kane', ['context', 'ingest', 'excerpt.md', '--mode', 'ci']]]);
  assert.equal(calls[0].cwd, f.cwd);
  assert.equal(calls[0].stdin, '');
  assert.equal(calls[0].agent, 'codex');
});

test('credit floor blocks paid stages; malformed credits fail closed', async t => {
  for (const credits of ['199.9', 'NaN']) {
    const f = await fixture(t, { CREDITS: credits });
    assert.equal(await f.run(['extract']), 2);
    assert.deepEqual((await f.calls()).map(c => c.kind), ['pnpm']);
    assert.match(f.logs, /credits|balance/i);
  }
});

test('extract permits exactly the floor, checks credits from root, and preserves pause without retry', async t => {
  const f = await fixture(t, { CREDITS: '200', PAUSE: '1', KANE_EXIT: '3' });
  assert.equal(await f.run(['extract']), 3);
  const calls = await f.calls();
  assert.deepEqual(calls.map(c => c.args), [['kane:credits'], ['context', 'extract', '--mode', 'agent']]);
  assert.equal(calls[0].cwd, f.root);
  assert.match(f.logs, /session-42/);
  assert.match(f.logs, /pause/i);
});

test('review lists full derived items without approving; approves only supplied known refs', async t => {
  const f = await fixture(t);
  assert.equal(await f.run(['review']), 0);
  assert.match(f.logs, /Cut routes/);
  assert.equal((await f.calls()).filter(c => c.args.includes('--approve')).length, 0);
  assert.equal(await f.run(['review', '--approve', 'uc-2']), 0);
  assert.deepEqual((await f.calls()).at(-1).args, ['context', 'review', '--approve', 'uc-2', '--mode', 'agent']);
  assert.equal(await f.run(['review', '--approve', 'nonexistent']), 2);
  assert.equal((await f.calls()).filter(c => c.args.includes('--approve')).length, 1);
});

test('design runs once per fresh reviewed usecase with max 3 and checks each spend', async t => {
  const f = await fixture(t);
  assert.equal(await f.run(['design']), 0);
  const calls = await f.calls();
  assert.deepEqual(calls.filter(c => c.args[0] === 'design').map(c => c.args), [['design', 'tests', '--use-case', 'uc-1', '--mode', 'agent', '--max', '3']]);
  assert.equal(calls.filter(c => c.kind === 'pnpm').length, 1);
  assert.equal(await f.run(['design', 'uc-2']), 2);
  assert.equal((await f.calls()).filter(c => c.args[0] === 'design').length, 1);
});

test('testrun selects only reviewed designs, disables healing and cleans preview on failure', async t => {
  const f = await fixture(t, { KANE_EXIT: '1' });
  assert.equal(await f.run(['testrun', '--serve']), 1);
  const calls = await f.calls();
  assert.deepEqual(calls.at(-1).args, ['testrun', 'run', '--from-context', 't-1', '--agent', '--no-adaptive-heal', '--headless']);
  assert.equal(calls.at(-1).stdin, '');
  assert.equal(f.previews, 1);
  assert.equal(f.cleaned, 1);
  assert.equal(await f.run(['testrun', 't-2']), 2);
  assert.equal(f.previews, 1);
});

test('cover runs ribbon then coverage for free; stops if ribbon fails', async t => {
  const f = await fixture(t);
  assert.equal(await f.run(['cover']), 0);
  assert.deepEqual((await f.calls()).map(c => c.args), [['cover', 'gaps'], ['cover', '--mode', 'agent']]);
  const failing = await fixture(t, { KANE_EXIT: '2' });
  assert.equal(await failing.run(['cover']), 2);
  assert.equal((await failing.calls()).length, 1);
});

test('refuses a shared project and empty or malformed lists without spending', async t => {
  const f = await fixture(t, { ROWS: '[]' });
  assert.equal(await f.run(['design']), 2);
  assert.equal((await f.calls()).some(c => c.kind === 'pnpm'), false);
  await mkdir(join(f.cwd, '.testmuai'), { recursive: true });
  await writeFile(join(f.cwd, '.testmuai/assurance.json'), '{}');
  const before = (await f.calls()).length;
  assert.equal(await f.run(['extract']), 2);
  assert.equal((await f.calls()).length, before);
});

test('low testrun balance never launches preview or Kane execution', async t => {
  const f = await fixture(t, { CREDITS: '199' });
  assert.equal(await f.run(['testrun', '--serve']), 2);
  assert.equal(f.previews, 0);
  assert.equal((await f.calls()).some(c => c.args[0] === 'testrun'), false);
});

test('design stops immediately on a paid pause and permits an explicit pinned resume', async t => {
  const rows = [1, 2].map(n => ({ id: `uc-${n}`, label: 'usecase', trust: 'trusted', fresh: 'fresh' }));
  const f = await fixture(t, { ROWS: JSON.stringify(rows), KANE_EXIT: '3', PAUSE: '1' });
  assert.equal(await f.run(['design']), 3);
  assert.equal((await f.calls()).filter(c => c.args[0] === 'design').length, 1);
  assert.equal(await f.run(['design', 'uc-1', '--resume', 'session-42', '--answer', 'q1=2']), 3);
  assert.deepEqual((await f.calls()).at(-1).args.slice(-4), ['--resume', 'session-42', '--answer', 'q1=2']);
  const { readdir } = await import('node:fs/promises');
  const directories = (await readdir(f.cwd)).filter(name => name.startsWith('output-runner-'));
  const logged = (await Promise.all(directories.map(async name => {
    const dir = join(f.cwd, name);
    return (await Promise.all((await readdir(dir)).map(file => readFile(join(dir, file), 'utf8')))).join('');
  }))).join('');
  assert.match(logged, /session-42/);
  assert.match(logged, /Which requirement/);
});

test('stale reviewed items are not designed or run, malformed rows fail closed', async t => {
  for (const rows of [
    [{ id: 'uc-1', label: 'usecase', trust: 'trusted', fresh: 'stale' }],
    [{ type: 'error', message: 'bad store' }],
  ]) {
    const f = await fixture(t, { ROWS: JSON.stringify(rows) });
    assert.equal(await f.run(['design']), 2);
    assert.equal((await f.calls()).some(c => c.kind === 'pnpm'), false);
  }
});

test('rechecks the floor for every usecase and stops before the second paid call', async t => {
  const f = await fixture(t, {
    CREDIT_SEQUENCE: '[220,199]',
    ROWS: JSON.stringify([1, 2].map(n => ({ id: `uc-${n}`, label: 'usecase', trust: 'trusted', fresh: 'fresh' }))),
  });
  assert.equal(await f.run(['design']), 2);
  const calls = await f.calls();
  assert.equal(calls.filter(c => c.kind === 'pnpm').length, 2);
  assert.equal(calls.filter(c => c.args[0] === 'design').length, 1);
  for (const call of calls) {
    assert.equal(call.stdin, '');
    assert.equal(call.agent, 'codex');
  }
});
