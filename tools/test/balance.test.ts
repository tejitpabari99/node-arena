import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { loadFiles } from '../src/files.js';

const root = resolve(import.meta.dirname, '../..');
async function fixture(t: {after(fn: () => Promise<void>): void}) {
  const dir = await mkdtemp(join(tmpdir(), 'arena-balance-'));
  t.after(() => rm(dir, {recursive:true, force:true}));
  const files = await loadFiles(join(root,'packages/content'));
  const corpus = JSON.parse(await readFile(join(root,'tools/test/fixtures/levels/corpus.json'),'utf8'));
  for (const name of Object.keys(files)) if (name.startsWith('data/levels/')) delete files[name]; // isolate from shipped campaign levels
  files['data/levels/gate-fixture.json'] = JSON.stringify(corpus.level);
  files['data/archetypes/gate-source.json'] = JSON.stringify(corpus.source);
  files['data/archetypes/gate-target.json'] = JSON.stringify(corpus.target);
  for (const [file, data] of Object.entries(files)) {
    const path = join(dir,file); await mkdir(dirname(path),{recursive:true});
    await writeFile(path,typeof data === 'string' ? data : JSON.stringify(data));
  }
  return dir;
}
function cli(dir: string, ...args: string[]) {
  return spawnSync(process.execPath,['--import','tsx','tools/src/cli.ts','balance','--dir',dir,...args],{cwd:root,encoding:'utf8',timeout:20000});
}
test('campaign balance runs the full seed suite and is byte identical for jobs 1 and 2 in both formats', async t => {
  const dir = await fixture(t);
  for (const format of ['json','md']) {
    const args = ['--levels','all','--proxy','reference,idle','--seeds','2','--format',format];
    const one = cli(dir,...args,'--jobs','1'), two = cli(dir,...args,'--jobs','2');
    assert.equal(one.status,0,one.stdout+one.stderr); assert.equal(two.status,0,two.stdout+two.stderr);
    assert.equal(one.stdout,two.stdout);
    if (format === 'json') {
      const report = JSON.parse(one.stdout);
      assert.equal(report.balance.targets.status,'loaded');
      const meta = JSON.parse(await readFile(join(root,'packages/content/content.json'),'utf8'));
      assert.equal(report.balance.header.rulesVersion,meta.rulesVersion);
      assert.equal(report.balance.header.contentVersion,meta.contentVersion);
      assert.ok(report.balance.header.BOT_VERSION); assert.match(report.balance.header.botHash.reference,/^[a-f0-9]{64}$/);
      assert.deepEqual(report.balance.rows.map((r: {profile:string;winPct:number;observations:number;matches:number;timeoutPct:number;medianTowers:number}) => [r.profile,r.winPct,r.observations,r.matches,r.timeoutPct,r.medianTowers]),[['idle',0,2,2,100,1],['reference',100,2,2,0,2]]);
      assert.equal(report.balance.rows[0].medianSecondsToWin,null);
      assert.ok(report.balance.rows[1].medianSecondsToWin > 0);
    } else { assert.match(one.stdout,/Win %/); assert.match(one.stdout,/Targets loaded/); }
  }
});
test('balance flags target violations and rejects invalid bounds and malformed options', async t => {
  const dir = await fixture(t); const targets = join(dir,'targets.json');
  const band = {referenceWinMin:100,humanProxyWin:[0,100],timeoutMaxPct:0,idleWinMax:0};
  await writeFile(targets,JSON.stringify({bands:Object.fromEntries([1,2,3,4].map(n=>[n,band]))}));
  const flagged = cli(dir,'--proxy','idle','--seeds','1','--jobs','1','--targets',targets,'--format','json');
  assert.equal(flagged.status,0,flagged.stdout+flagged.stderr);
  assert.match(JSON.parse(flagged.stdout).balance.rows[0].flags.join(' '),/timeout/i);
  band.humanProxyWin = [80,20]; await writeFile(targets,JSON.stringify({bands:Object.fromEntries([1,2,3,4].map(n=>[n,band]))}));
  const bad = cli(dir,'--targets',targets,'--format','json'); assert.equal(bad.status,1);
  assert.match(JSON.parse(bad.stdout).errors[0].message,/humanProxyWin/);
  for (const args of [['--jobs','0'],['--seeds','1.5'],['--mode','bad'],['--proxy','unknown'],['--levels','unknown']]) {
    const result = cli(dir,...args,'--format','json'); assert.equal(result.status,1,result.stdout);
  }
});
test('arena rotations cover every seat per profile and count bot-team wins from human-relative lost outcomes', async t => {
  const dir = await fixture(t);
  const run = cli(dir,'--proxy','idle,reference,reference','--seeds','2','--jobs','2','--mode','arena','--format','json');
  assert.equal(run.status,0,run.stdout+run.stderr);
  const report = JSON.parse(run.stdout).balance;
  assert.deepEqual(report.profiles,['idle','reference']);
  // Two seeds x two rotations x one occurrence each: four observations/profile.
  assert.deepEqual(report.rows.map((r: {profile:string;observations:number;matches:number;winPct:number;timeoutPct:number})=>[r.profile,r.observations,r.matches,r.winPct,r.timeoutPct]),[['idle',4,4,0,50],['reference',4,4,50,50]]);
  // Three dense seats and two profiles: each profile repeats once in a rotation,
  // visits each seat once per seed and has six observations in four matches.
  const path = join(dir,'data/levels/gate-fixture.json'); const level = JSON.parse(await readFile(path,'utf8'));
  level.players.push({id:'c1',kind:'bot',botProfile:'idle',colorKey:'player.3'});
  level.towers.push({id:'t3',archetype:'gate-target',pos:{x:20,y:0},owner:'c1',garrison:0});
  await writeFile(path,JSON.stringify(level));
  const three = cli(dir,'--proxy','reference,idle','--seeds','2','--jobs','1','--mode','arena','--format','json');
  assert.equal(three.status,0,three.stdout+three.stderr);
  assert.deepEqual(JSON.parse(three.stdout).balance.rows.map((r:{observations:number;matches:number})=>[r.observations,r.matches]),[[6,4],[6,4]]);
});
test('target schema refuses missing bands, unknown fields, nonfinite and out-of-range percentages', async () => {
  const {parseBalanceTargets} = await import('../src/balance-targets.js');
  const band = {referenceWinMin:100,humanProxyWin:[0,100],timeoutMaxPct:0,idleWinMax:0};
  const targets = {bands:{'1':band,'2':band,'3':band,'4':band}};
  assert.doesNotThrow(()=>parseBalanceTargets(targets));
  for (const invalid of [
    {bands:{'1':band}},
    {...targets,extra:true},
    {bands:{...targets.bands,'1':{...band,referenceWinMin:-1}}},
    {bands:{...targets.bands,'1':{...band,idleWinMax:101}}},
    {bands:{...targets.bands,'1':{...band,timeoutMaxPct:Infinity}}},
    {bands:{...targets.bands,'1':{...band,humanProxyWin:[90,10]}}},
  ]) assert.throws(()=>parseBalanceTargets(invalid));
});
test('worker failures reject rather than returning a partial seed suite or hanging', async t => {
  const {runBalancePool} = await import('../src/balance-pool.js');
  const {compileLevel,loadContent,resolveProfiles} = await import('@node-arena/content');
  const {pathToFileURL} = await import('node:url');
  const dir = await fixture(t), loaded = loadContent(await loadFiles(dir));
  const level = compileLevel(loaded,'gate-fixture');
  const idle = Object.values(resolveProfiles(loaded)).find(p=>p.id === 'idle')!;
  const task = {level,seed:1,rotation:0,seats:[{player:'p1',profile:idle}]};
  for (const [source,message] of [
    ["throw new Error('worker startup failure')",/worker startup failure/],
    ['process.exit(0)',/exited before completing/],
    ["import {parentPort} from 'node:worker_threads'; parentPort.on('message', ()=>parentPort.postMessage({index:-1}));",/Invalid balance worker response/],
    ["import {parentPort} from 'node:worker_threads'; parentPort.on('message', ({index,task})=>parentPort.postMessage({index,result:{level:task.level.id,seed:task.seed,rotation:task.rotation,finalHash:'0'.repeat(16),observations:[]}}));",/Invalid balance worker result/],
  ] as const) {
    const file = join(dir,'broken.mjs'); await writeFile(file,source);
    await assert.rejects(runBalancePool([task,task],2,pathToFileURL(file)),message);
  }
  const bad = {...task,seats:[{player:'missing',profile:idle}]};
  await assert.rejects(runBalancePool([task,bad],2),/Invalid profile bot player/);
});
test('committed balance-targets.json validates and balance reports per-band flags on the sample level', async () => {
  const {readBalanceTargets} = await import('../src/balance-targets.js');
  const targets = await readBalanceTargets(join(root,'tools/balance-targets.json'),false);
  assert.ok(targets);
  assert.deepEqual(targets.bands['2'],{referenceWinMin:98,humanProxyWin:[65,85],timeoutMaxPct:5,idleWinMax:0});
  assert.deepEqual(targets.bands['4'].humanProxyWin,[20,45]);
  const run = spawnSync(process.execPath,['--import','tsx','tools/src/cli.ts','balance','--levels','sample','--proxy','reference,human-proxy,idle','--seeds','4','--jobs','1','--format','json'],{cwd:root,encoding:'utf8',timeout:60000});
  assert.equal(run.status,0,run.stdout+run.stderr);
  const report = JSON.parse(run.stdout).balance;
  assert.equal(report.targets.status,'loaded');
  assert.deepEqual(report.rows.map((r:{band:number})=>r.band),[1,1,1]);
  assert.ok(report.rows.every((r:{flags:unknown})=>Array.isArray(r.flags)));
});
