import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { launchChrome, attachChrome } from '../lib/chrome.mjs';

const url = process.env.KANE_TEST_URL;
const options = { skip: !url, timeout: 45000 };
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };

test('real Chrome reaches na-kane, closes extra tabs, supports unowned attach and cleans up', options, async () => {
  const warnings = [];
  const page = await launchChrome({ url, port: 0, headless: true, onWarn: warning => warnings.push(warning), handleSignals: false });
  try {
    assert.equal((await page.cdp.getTargets()).filter(target => target.type === 'page').length, 1);
    const state = await page.cdp.evaluate('({screen:__na.screen,levelId:__na.state().levelId,kane:!!__na.kane,width:innerWidth,height:innerHeight})', page.sessionId);
    assert.deepEqual(state, { screen: 'playing', levelId: 'na-kane', kane: true, width: 1600, height: 900 });
    assert.equal((await page.summary()).result, null);
    await page.cdp.send('Target.createTarget', { url: 'about:blank' });
    await page.prepare();
    assert.equal((await page.cdp.getTargets()).filter(target => target.type === 'page').length, 1);
    assert.equal(warnings[0].code, 'extra_tab');
    const attached = await attachChrome({ port: page.port });
    assert.equal((await attached.summary()).result, null);
    await attached.close();
    assert.equal(alive(page.pid), true);
    console.log(JSON.stringify({ smoke: state, pages: 1, port: page.port, pid: page.pid, warnings }));
  } finally { await page.close(); await page.close(); }
  assert.equal(alive(page.pid), false);
  await assert.rejects(access(page.userDataDir));
});

test('real Chrome not-ready failure exits 23 and removes lifecycle listeners', options, async () => {
  const before = process.listenerCount('exit');
  await assert.rejects(launchChrome({ url: 'about:blank', port: 0, headless: true, timeoutMs: 3000 }), error => error.exitCode === 23);
  assert.equal(process.listenerCount('exit'), before);
});

for (const action of ['SIGINT', 'SIGTERM', 'exit']) test(`real Chrome is killed on driver ${action}`, options, async () => {
  const moduleUrl = new URL('../lib/chrome.mjs', import.meta.url).href;
  const program = `import {launchChrome} from ${JSON.stringify(moduleUrl)}; const page=await launchChrome({url:${JSON.stringify(url)},port:0,headless:true}); process.send({pid:page.pid,port:page.port}); ${action === 'exit' ? 'setTimeout(()=>process.exit(0),100);' : 'setInterval(()=>{},1000);'}`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', program], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const exited = once(child, 'exit');
  let chromePid;
  try {
    const ready = await Promise.race([once(child, 'message').then(([message]) => message), exited.then(([code]) => { throw new Error(`Driver exited early ${code}: ${stderr}`); })]);
    chromePid = ready.pid;
    if (action !== 'exit') child.kill(action);
    const [code] = await exited;
    assert.equal(code, action === 'exit' ? 0 : action === 'SIGINT' ? 130 : 143);
    for (let attempt = 0; attempt < 20 && alive(chromePid); attempt++) await delay(100);
    assert.equal(alive(chromePid), false, `Chrome ${chromePid} still alive`);
    console.log(JSON.stringify({ cleanup: action, chromePid, exitCode: code, alive: false }));
  } finally { if (child.exitCode === null) child.kill('SIGKILL'); if (chromePid && alive(chromePid)) process.kill(chromePid, 'SIGKILL'); }
});
