import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile, mkdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { compileLevel, loadContent, hashCompiledLevel, resolveProfiles, type Level, type Content } from '@node-arena/content';
import { runMatch, createProfileBot } from '@node-arena/bots';
import { loadFiles } from '../src/files.js';
import { validateLevel, validateLevels, requiredWins, isHumanWin } from '../src/levels.js';

const root = resolve(import.meta.dirname, '../..');
async function corpus(kind: 'win' | 'lose' | 'idle-win' | 'partial' = 'win', band = 1) {
  const files = await loadFiles(join(root, 'packages/content'));
  const fixture = JSON.parse(await readFile(join(root,'tools/test/fixtures/levels/corpus.json'),'utf8'));
  const scenario = fixture.scenarios[kind];
  const authored = fixture.level as Level; authored.band = band;
  authored.timeLimitSec = scenario.timeLimitSec; authored.towers[1]!.pos.x = scenario.targetX;
  delete files['data/levels/sample.json'];
  files['data/levels/gate-fixture.json'] = JSON.stringify(authored);
  files['data/archetypes/gate-source.json'] = JSON.stringify(fixture.source);
  files['data/archetypes/gate-target.json'] = JSON.stringify(fixture.target);
  const loaded = loadContent(files); const level = compileLevel(loaded, authored.id);
  // The content gate already rejects this ownership; this adversarial compiled
  // scenario independently proves the runtime idle-win safeguard.
  if (scenario.allTowersHuman) for (const tower of level.towers) tower.owner = level.players.findIndex(p => p.kind === 'human');
  level.simHash = hashCompiledLevel(level);
  const profiles = Object.values(resolveProfiles(loaded));
  const reference = profiles.find(p => p.id === 'reference')!;
  if (scenario.referenceIntervalSec) reference.params.skill!.decisionIntervalSec = scenario.referenceIntervalSec * 1000;
  return { files, level, authored, metadata: loaded['content.json'] as Content, reference, idle: profiles.find(p => p.id === 'idle')! };
}
async function temporary(t: {after(fn: () => Promise<void>): void}) {
  const dir = await mkdtemp(join(tmpdir(), 'arena-levels-')); t.after(() => rm(dir, {recursive:true, force:true})); return dir;
}
test('real reference wins all four, idle never wins; final hash rerun matches', async () => {
  const f = await corpus(); const report = await validateLevel({...f, seeds:4});
  assert.equal(report.ok, true, JSON.stringify(report)); assert.equal(report.referenceWins, 4);
  assert.equal(report.idleWins, 0); assert.equal(report.deterministic, true);
  assert.equal(report.reference.length, 4); assert.ok(report.reference.every(r => r.rejected === 0 && r.outcome.outcome === 'won'));
});
test('unwinnable and automatically won levels fail the real runtime gate', async () => {
  const losing = await validateLevel({...await corpus('lose'), seeds:4});
  assert.equal(losing.ok, false); assert.equal(losing.referenceWins, 0);
  assert.match(losing.errors.join(' '), /Reference/);
  const idle = await validateLevel({...await corpus('idle-win'), seeds:4});
  assert.equal(idle.ok, false); assert.equal(idle.idleWins, 4); assert.match(idle.errors.join(' '), /Idle/);
});
test('band four accepts three actual wins of four; K=1 requires exactly zero wins', async () => {
  assert.equal(requiredWins(4,1),0); assert.equal(requiredWins(3,1),1);
  const f = await corpus('partial',4);
  const report = await validateLevel({...f,seeds:4});
  assert.equal(report.referenceWins,3); assert.equal(report.ok,true,JSON.stringify(report));
  assert.equal(isHumanWin({outcome:'timeout',winnerTeam:'p1'},'p1'),false);
  assert.equal(isHumanWin({outcome:'lost',winnerTeam:'p1'},'p1'),false);
  assert.equal(isHumanWin({outcome:'won',winnerTeam:'b1'},'p1'),false);
  const zero = await validateLevel({...await corpus('lose',4),seeds:1});
  assert.equal(zero.referenceWins,0); assert.equal(zero.ok,true,JSON.stringify(zero));
  assert.equal((await validateLevel({...await corpus('partial',3),seeds:4})).ok,false);
});
test('winning solution verifies playback and human-only script against authored opponents', async t => {
  const dir = await temporary(t); const f = await corpus('win',4);
  const reference = {...f.reference, kind:'idle' as const};
  const solved = runMatch({level:f.level,seed:1,controllers:[{player:'p1',commands:[{tick:0,cmd:{type:'DrawLine',player:'p1',from:'t1',to:'t2'}}]}],record:f.metadata});
  assert.equal(solved.outcome.outcome,'won');
  const path = join(dir,`${f.level.id}.replay.json`); await writeFile(path,JSON.stringify(solved.replay));
  const report = await validateLevel({...f,reference,seeds:4,solutionPath:path});
  assert.equal(report.ok,true,JSON.stringify(report)); assert.equal(report.solution?.ok,true);
  assert.equal(report.referenceWins,0);
  assert.equal((await validateLevel({...f,authored:{band:3},reference,seeds:4,solutionPath:path})).ok,false);
  const stale = structuredClone(solved.replay!); stale.header.simHash = 'a'.repeat(64);
  await writeFile(path,JSON.stringify(stale));
  const bad = await validateLevel({...f,reference,seeds:4,solutionPath:path});
  assert.equal(bad.ok,false); assert.match(bad.errors.join(' '), /solution/i);
});
test('unrelated and foreign commands cannot satisfy solution fallback', async t => {
  const dir = await temporary(t); const f = await corpus('win',4);
  const solved = runMatch({level:f.level,seed:1,controllers:[createProfileBot(f.level,1,'p1',f.reference)],record:f.metadata}).replay!;
  const path = join(dir,'solution.replay.json');
  solved.header.levelId = 'sample'; await writeFile(path,JSON.stringify(solved));
  assert.equal((await validateLevel({...f,reference:{...f.reference,kind:'idle'},seeds:4,solutionPath:path})).ok,false);
  solved.header.levelId = f.level.id;
  solved.commands.push({tick:0,cmd:{type:'DrawLine',player:'b1',from:'t2',to:'t1'}});
  solved.commands.sort((a,b)=>a.tick-b.tick); await writeFile(path,JSON.stringify(solved));
  assert.equal((await validateLevel({...f,reference:{...f.reference,kind:'idle'},seeds:4,solutionPath:path})).ok,false);
});

test('CLI runs content validation first and emits per-level JSON and Markdown', () => {
  const run = (...args: string[]) => spawnSync(process.execPath,['--import','tsx','tools/src/cli.ts','validate:levels',...args],{cwd:root,encoding:'utf8'});
  const json = run('--levels','sample','--seeds','4','--format','json');
  assert.equal(json.status,0,json.stdout+json.stderr);
  const report = JSON.parse(json.stdout); assert.equal(report.levels.length,1);
  assert.equal(report.levels[0].referenceWins,4); assert.equal(report.levels[0].idleWins,0);
  const md = run('--levels','sample','--seeds','1'); assert.equal(md.status,0,md.stdout+md.stderr);
  assert.match(md.stdout,/## sample: PASS/); assert.match(md.stdout,/Final hash/);
  for (const args of [['--levels','missing'],['--seeds','0'],['--seeds','1.5'],['--base','missing-ref']]) {
    const failed = run(...args,'--format','json'); assert.equal(failed.status,1,failed.stdout);
    assert.equal(JSON.parse(failed.stdout).ok,false);
  }
});

test('a verified replay with overridden foreign bots fails authored-script verification', async t => {
  const dir = await temporary(t); const f = await corpus('win',4);
  // An opponent can legally draw a line, but an authored idle opponent never does.
  const commands = [{tick:0,cmd:{type:'DrawLine' as const,player:'p1',from:'t1',to:'t2'}}];
  const forged = runMatch({level:f.level,seed:1,controllers:[{player:'p1',commands},{player:'b1',commands:[{tick:0,cmd:{type:'DrawLine',player:'b1',from:'t2',to:'t1'}}]}],record:f.metadata});
  assert.equal(forged.outcome.outcome,'won');
  const {playReplay} = await import('@node-arena/sim');
  assert.equal(playReplay({level:f.level,metadata:f.metadata},forged.replay!).ok,true);
  const path = join(dir,'foreign.replay.json'); await writeFile(path,JSON.stringify(forged.replay));
  const report = await validateLevel({...f,reference:{...f.reference,kind:'idle'},seeds:4,solutionPath:path});
  assert.equal(report.ok,false,JSON.stringify(report));
  assert.match(report.errors.join(' '),/authored opponents/);
});

test('corpus fallback accepts only a replay committed at the exact solution path', async t => {
  const dir = await temporary(t); const f = await corpus('win',4);
  const reference = JSON.parse(f.files['data/bots/reference.json'] as string);
  reference.params.bias = {attack:0,reinforce:0,cut:0}; reference.params.holdThreshold = 1;
  f.files['data/bots/reference.json'] = JSON.stringify(reference);
  const solution = runMatch({level:f.level,seed:1,controllers:[{player:'p1',commands:[{tick:0,cmd:{type:'DrawLine',player:'p1',from:'t1',to:'t2'}}]}],record:f.metadata}).replay!;
  const runGit = (...args: string[]) => {
    const result = spawnSync('git',['-C',dir,...args],{encoding:'utf8'}); assert.equal(result.status,0,result.stderr);
  };
  runGit('init','--quiet'); await mkdir(join(dir,'tools/solutions'),{recursive:true});
  const path = join(dir,'tools/solutions/gate-fixture.replay.json'); await writeFile(path,JSON.stringify(solution));
  await assert.rejects(validateLevels(f.files,dir,'gate-fixture',4), /committed/);
  runGit('add','tools/solutions/gate-fixture.replay.json');
  runGit('-c','user.name=Gate Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','fixture replay');
  const result = await validateLevels(f.files,dir,'gate-fixture',4);
  assert.equal(result[0]!.ok,true,JSON.stringify(result)); assert.equal(result[0]!.solution?.ok,true);
  solution.header.simHash = '0'.repeat(64); await writeFile(path,JSON.stringify(solution));
  await assert.rejects(validateLevels(f.files,dir,'gate-fixture',4), /committed HEAD/);
});

test('stale content lock fails before level selection or running matches', async t => {
  const dir = await temporary(t);
  await cp(join(root,'packages/content'),dir,{recursive:true,filter:path=>!/(node_modules|dist|test)/.test(path)});
  const path = join(dir,'hashes.lock.json'); const lock = JSON.parse(await readFile(path,'utf8'));
  lock.levels.sample = '0'.repeat(64); await writeFile(path,JSON.stringify(lock));
  const result = spawnSync(process.execPath,['--import','tsx','tools/src/cli.ts','validate:levels','--levels','missing','--dir',dir,'--format','json'],{cwd:root,encoding:'utf8'});
  assert.equal(result.status,1,result.stdout+result.stderr); const report = JSON.parse(result.stdout);
  assert.equal(report.levels,undefined); assert.match(report.errors[0].message,/stale/);
});
