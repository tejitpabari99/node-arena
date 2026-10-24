import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, rmdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { admitStart, checkStart, createStartState, readGuardConfig } from './guards.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
// Operator holds /tmp/node-arena-kane-resources.lock with flock during browser runs.
// Runtime lock uses a different inode; never unlink the operator's advisory lock.
const LOCK = '/tmp/node-arena-kane-stream.lock';
const LINE_LIMIT = 1024 * 1024;

function integer(env, key, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const value = env[key] === undefined || env[key] === '' ? fallback : Number(env[key]);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${key}`);
  return value;
}

export function readRunConfig(env = {}, cwd = ROOT) {
  const previewHost = env.KANE_STREAM_PREVIEW_HOST ?? '127.0.0.1';
  if (previewHost !== '127.0.0.1') throw new Error('Preview host must be 127.0.0.1');
  return {
    driver: resolve(cwd, env.KANE_STREAM_DRIVER ?? 'tools/kane/drive.mjs'),
    minCredits: integer(env, 'KANE_STREAM_MIN_CREDITS', 200),
    maxRuns: integer(env, 'KANE_STREAM_MAX_RUNS', 20, 1),
    maxRunMs: integer(env, 'KANE_STREAM_MAX_RUN_S', 720, 1, 86400) * 1000,
    cooldownMs: integer(env, 'KANE_STREAM_COOLDOWN_S', 120, 0, 86400) * 1000,
    previewPort: integer(env, 'KANE_STREAM_PREVIEW_PORT', 4173, 1, 65535),
    cdpPort: integer(env, 'KANE_STREAM_CDP_PORT', 9222, 1, 65535),
    previewHost,
    preflightMs: 10000,
    graceMs: 5000,
    pidFile: resolve(cwd, 'kane-runs/stream.pid.json'),
    lockDir: LOCK,
  };
}

export function outcomeForExit(code) {
  return ({ 0: 'won', 10: 'lost', 11: 'timeout', 21: 'unavailable' })[code] ?? 'failed';
}

/** PID + kernel start time + exact argv protect against PID reuse, including on restart. */
async function processIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return null;
  try {
    const [stat, raw] = await Promise.all([readFile(`/proc/${pid}/stat`, 'utf8'), readFile(`/proc/${pid}/cmdline`, 'utf8')]);
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    if (fields[0] === 'Z' || !raw) return null;
    const cmdline = raw.split('\0').filter(Boolean);
    return { pid, starttime: fields[19], ppid: Number(fields[1]), pgid: Number(fields[2]), cmdline };
  } catch { return null; }
}

function sameIdentity(a, b) {
  return !!a && !!b && a.pid === b.pid && a.starttime === b.starttime && a.pgid === b.pgid
    && JSON.stringify(a.cmdline) === JSON.stringify(b.cmdline);
}

async function validatedProfile(identity) {
  if (!identity?.cmdline?.length || !/chrome|chromium/i.test(basename(identity.cmdline[0]))) return null;
  const profile = identity.cmdline.find(arg => arg.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length);
  if (!profile || dirname(profile) !== tmpdir() || !/^node-arena-chrome-[\w-]+$/.test(basename(profile))) return null;
  try {
    const stat = await lstat(profile);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || await realpath(profile) !== profile) return null;
    return profile;
  } catch { return null; }
}

/** Linux ownership backend; never finds processes by port or broad name matching. */
export function createProcessOps(config) {
  let lockToken;
  const matches = async identity => sameIdentity(identity, await processIdentity(identity?.pid));
  return {
    identity: processIdentity, matches,
    async descendants(roots) {
      const rows = (await Promise.all((await readdir('/proc')).filter(name => /^\d+$/.test(name)).map(name => processIdentity(Number(name))))).filter(Boolean);
      const owned = new Set(roots.filter(root => rows.some(row => sameIdentity(root, row))).map(root => root.pid));
      let changed;
      do {
        changed = false;
        for (const row of rows) if (owned.has(row.ppid) && !owned.has(row.pid)) { owned.add(row.pid); changed = true; }
      } while (changed);
      return rows.filter(row => owned.has(row.pid));
    },
    async signal(identity, signal) {
      if (!await matches(identity)) return;
      try { process.kill(identity.pgid === identity.pid ? -identity.pid : identity.pid, signal); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    },
    async removeProfile(identity) {
      const profile = await validatedProfile(identity);
      if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
    async load() {
      try {
        const stat = await lstat(config.pidFile);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 262144 || stat.uid !== process.getuid?.()) throw new Error('Unsafe process record');
        const record = JSON.parse(await readFile(config.pidFile, 'utf8'));
        if (record.version !== 1 || !record.owner || !Array.isArray(record.processes)) throw new Error('Invalid process record');
        return record;
      } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    async persist(record) {
      await mkdir(dirname(config.pidFile), { recursive: true });
      const temporary = `${config.pidFile}.${process.pid}.tmp`;
      const file = await open(temporary, 'w', 0o600);
      try { await file.writeFile(JSON.stringify(record)); await file.sync(); } finally { await file.close(); }
      await rename(temporary, config.pidFile);
    },
    clear: () => rm(config.pidFile, { force: true }),
    async acquire() {
      const token = `${randomUUID()}.json`;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await mkdir(config.lockDir, { mode: 0o700 });
          const file = await open(resolve(config.lockDir, token), 'wx', 0o600);
          try { await file.writeFile(JSON.stringify({ owner: await processIdentity(process.pid) })); }
          finally { await file.close(); }
          lockToken = token; return;
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
          const stat = await lstat(config.lockDir);
          if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.()) throw new Error('Resources unavailable');
          const entries = await readdir(config.lockDir);
          if (entries.length !== 1 || !/^[\da-f-]{36}\.json$/.test(entries[0])) throw new Error('Resources unavailable');
          const path = resolve(config.lockDir, entries[0]);
          const recordStat = await lstat(path);
          if (!recordStat.isFile() || recordStat.isSymbolicLink() || recordStat.size > 8192) throw new Error('Resources unavailable');
          const record = JSON.parse(await readFile(path, 'utf8'));
          if (!record.owner || await matches(record.owner)) throw new Error('Resources unavailable');
          // Unlink only this stale owner's unique filename. rmdir is atomic and
          // refuses a new owner's nonempty directory, unlike unlinking a shared file.
          await rm(path, { force: true });
          try { await rmdir(config.lockDir); }
          catch (failure) { if (!['ENOENT', 'ENOTEMPTY'].includes(failure.code)) throw failure; }
        }
      }
      throw new Error('Resources unavailable');
    },
    async release() {
      if (!lockToken) return;
      await rm(resolve(config.lockDir, lockToken), { force: true });
      try { await rmdir(config.lockDir); }
      catch (error) { if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error; }
      lockToken = undefined;
    },
    async checkPorts() {
      for (const port of [config.previewPort, config.cdpPort]) await new Promise((accept, reject) => {
        const server = createServer(); server.once('error', reject);
        server.listen(port, '127.0.0.1', () => server.close(accept));
      });
    },
  };
}

/**
 * Internal-only events: line(raw NDJSON), chrome_ready(driver event),
 * state(public snapshot), end({runId,outcome}). Sanitize line via relay before SSE.
 * Consumers stop screencast on state=ending, before process teardown begins.
 */
export async function createRunController({ env = process.env, cwd = ROOT, guardConfig = readGuardConfig(env), deps = {}, handleSignals = true } = {}) {
  const config = readRunConfig(env, cwd);
  const spawnImpl = deps.spawn ?? spawn, now = deps.now ?? Date.now;
  const later = deps.setTimeout ?? setTimeout, cancel = deps.clearTimeout ?? clearTimeout;
  const sleep = deps.sleep ?? (ms => delay(ms));
  const ops = deps.processes ?? createProcessOps(config);
  const owner = await ops.identity(process.pid);
  const controller = new EventEmitter();
  let state = 'idle', runId = null, startedAt = null, endsAtMax = null, outcome;
  let admission = createStartState(), owned = [], active = false, closed = false, closing, ending, pendingStart;
  let preflightAbort, wallTimer, cooldownTimer, scanTimer, scanPending, processReady;
  const handlers = new Map();
  const snapshot = (viewers = 0) => ({ state, runId, startedAt, endsAtMax, viewers, ...(outcome ? { outcome } : {}) });
  const change = next => { state = next; controller.emit('state', snapshot()); };
  const unavailable = () => ({ status: 503, message: 'unavailable' });
  const persist = () => ops.persist({ version: 1, owner, processes: owned });

  async function clean(identities) {
    // Capture which profile paths were genuinely owned BEFORE delivering a signal.
    const expanded = [...identities];
    for (const identity of await ops.descendants(identities)) if (!expanded.some(row => sameIdentity(row, identity))) expanded.push(identity);
    const verified = [], gone = [];
    for (const identity of expanded) {
      if (await ops.matches(identity)) verified.push(identity);
      else if (!await ops.identity(identity.pid)) gone.push(identity);
    }
    for (const identity of verified) await ops.signal(identity, 'SIGTERM');
    if (verified.length) {
      // Exit quickly when all owned children have gone; cap the graceful phase at 5s.
      let elapsed = 0;
      while (elapsed < config.graceMs && (await Promise.all(verified.map(identity => ops.matches(identity)))).some(Boolean)) {
        const step = Math.min(100, config.graceMs - elapsed); await sleep(step); elapsed += step;
      }
    }
    for (const identity of verified) await ops.signal(identity, 'SIGKILL');
    // SIGKILL delivery is asynchronous. Wait briefly for process exit before removing profiles.
    for (let waited = 0; waited < 1000 && (await Promise.all(verified.map(identity => ops.matches(identity)))).some(Boolean); waited += 50) await sleep(50);
    for (const identity of [...verified, ...gone]) await ops.removeProfile(identity);
  }

  const previous = await ops.load();
  if (previous) {
    if (previous.owner && await ops.matches(previous.owner)) throw new Error('Stream owner is still active');
    await clean(previous.processes); await ops.clear();
  }

  async function collect() {
    if (!active) return;
    if (scanPending) return scanPending;
    scanPending = (async () => {
      const discovered = await ops.descendants(owned);
      for (const identity of discovered) {
        const index = owned.findIndex(row => row.pid === identity.pid && row.starttime === identity.starttime);
        // A verified descendant may exec (pnpm -> node); refresh its exact argv.
        if (index < 0) owned.push(identity); else owned[index] = identity;
      }
      if (active) await persist();
    })();
    try { await scanPending; } finally { scanPending = undefined; }
  }
  function scheduleScan() {
    scanTimer = later(() => { void collect().then(() => { if (active) scheduleScan(); }, () => { void end('failed'); }); }, 100);
  }

  function preflight(signal) {
    return new Promise(resolveResult => {
      let child, identity, identityPromise, output = '', settled = false, timer;
      const finish = async valid => {
        if (settled) return; settled = true;
        cancel(timer); signal.removeEventListener('abort', abort);
        try { await identityPromise; } catch { valid = false; }
        try { if (identity) await clean([identity]); await ops.clear(); } catch { valid = false; }
        resolveResult(valid);
      };
      const abort = () => { void finish(false); };
      if (signal.aborted) { resolveResult(false); return; }
      signal.addEventListener('abort', abort, { once: true });
      timer = later(abort, config.preflightMs);
      try {
        child = spawnImpl(process.execPath, [config.driver, '--credits-only'], { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
        // Do not forward preflight stdout/stderr: both may contain credentials/balance.
        child.stderr?.resume();
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', data => { if (settled) return; output += data; if (Buffer.byteLength(output) > 8192) { output = ''; void finish(false); } });
        child.once('error', abort);
        child.once('close', code => {
          let valid = false;
          try {
            const parsed = JSON.parse(output);
            valid = code === 0 && typeof parsed.credits === 'number' && Number.isFinite(parsed.credits) && parsed.credits >= config.minCredits && parsed.credits >= 0;
          } catch { /* Fail closed without exposing output. */ }
          void finish(valid);
        });
        identityPromise = ops.identity(child.pid).then(async value => { identity = value; if (identity) await ops.persist({ version: 1, owner, processes: [identity] }); });
        void identityPromise.catch(abort);
      } catch { void finish(false); }
    });
  }

  function end(finalOutcome = 'failed') {
    if (ending) return ending;
    if (!active) return Promise.resolve();
    outcome = ['won', 'lost', 'timeout', 'unavailable', 'failed'].includes(finalOutcome) ? finalOutcome : 'failed';
    change('ending'); cancel(wallTimer); cancel(scanTimer);
    ending = (async () => {
      try {
        await processReady; await collect(); active = false;
        await clean(owned); await ops.clear();
      } catch { outcome = 'failed'; }
      finally {
        active = false; try { await ops.release(); } catch { outcome = 'failed'; }
        change('cooldown'); controller.emit('end', { runId, outcome });
        if (!closed) cooldownTimer = later(() => { ending = undefined; change('idle'); }, config.cooldownMs);
      }
    })();
    return ending;
  }

  function start(ip = 'unknown') {
    if (closed) return Promise.resolve(unavailable());
    if (state !== 'idle') return Promise.resolve({ status: 409, message: 'unavailable' });
    const checked = checkStart(admission, ip, now(), guardConfig);
    if (!checked.allowed) return Promise.resolve({ status: checked.status, message: 'unavailable', retryAfterSeconds: checked.retryAfterSeconds });
    // Reserve BEFORE the first async boundary, including the credit subprocess.
    runId = null; startedAt = null; endsAtMax = null; outcome = undefined; ending = undefined;
    change('starting'); preflightAbort = new AbortController();
    pendingStart = (async () => {
      try {
        // Lock before even the credit subprocess: two server instances must never
        // overwrite each other's ownership record while one is running.
        await ops.acquire();
        if (closed) { await ops.release(); return unavailable(); }
        if (!await preflight(preflightAbort.signal) || closed) { await ops.release(); if (!closed) change('idle'); return unavailable(); }
        await ops.checkPorts();
        if (closed) { await ops.release(); return unavailable(); }
        runId = randomUUID(); startedAt = now(); endsAtMax = startedAt + config.maxRunMs;
        const log = resolve(cwd, 'kane-runs', `stream-${runId}`, 'driver.ndjson');
        if (!deps.processes) await mkdir(dirname(log), { recursive: true });
        const args = [config.driver, '--headless', '--software-gl', '--serve', '--min-credits', String(config.minCredits), '--max-runs', String(config.maxRuns), '--port', String(config.cdpPort), '--url', `http://${config.previewHost}:${config.previewPort}/?kane=1`, '--log', log];
        // Consume abuse admission immediately before the one paid-capable spawn.
        const admitted = admitStart(admission, ip, now(), guardConfig);
        if (!admitted.allowed) throw new Error('Start admission changed');
        admission = admitted.state;
        const child = spawnImpl(process.execPath, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
        active = true; owned = [];
        let ready; processReady = new Promise(resolveReady => { ready = resolveReady; });
        let remainder = '', dropping = false;
        child.stderr?.resume();
        child.stdout?.setEncoding('utf8');
        child.stdout?.on('data', chunk => {
          // Bound the unfinished line; malformed driver output never grows without limit.
          for (const part of chunk.toString().split(/(?<=\n)/)) {
            if (!dropping) remainder += part;
            if (Buffer.byteLength(remainder) > LINE_LIMIT) { dropping = true; remainder = ''; }
            if (!part.endsWith('\n')) continue;
            if (!dropping && state !== 'ending' && state !== 'cooldown') {
              const line = remainder.trimEnd(); controller.emit('line', line);
              try {
                const event = JSON.parse(line);
                if (event.type === 'chrome_ready' && event.port === config.cdpPort) {
                  void collect().then(() => {
                    if (!active || state === 'ending') return;
                    change('live'); controller.emit('chrome_ready', event);
                  }, () => { void end('failed'); });
                }
                if (event.type === 'driver_end') void end(outcomeForExit(event.exitCode));
              } catch { /* Relay drops malformed JSON; lifecycle ignores it. */ }
            }
            remainder = ''; dropping = false;
          }
        });
        child.once('error', () => { void end('failed'); });
        child.once('exit', code => { void end(outcomeForExit(code)); });
        let identity;
        try {
          identity = child.pid ? await ops.identity(child.pid) : null;
          if (identity) owned.push(identity);
          await persist();
        } finally { ready(); }
        if (!identity && !ending) { await end('failed'); return unavailable(); }
        await collect();
        if (closed) await end('failed');
        if (active && !ending) { scheduleScan(); wallTimer = later(() => { void end('timeout'); }, Math.max(0, endsAtMax - now())); }
        return { status: 202, runId };
      } catch {
        if (active) await end('failed');
        else { await ops.release(); if (!closed) change('idle'); }
        return unavailable();
      } finally { preflightAbort = undefined; }
    })();
    return pendingStart;
  }

  function close() {
    if (closing) return closing;
    closed = true; preflightAbort?.abort(); cancel(cooldownTimer);
    for (const [name, handler] of handlers) process.removeListener(name, handler);
    closing = (async () => { await pendingStart; await end('failed'); cancel(cooldownTimer); await ops.release(); })();
    return closing;
  }
  if (handleSignals) for (const name of ['SIGTERM', 'SIGINT']) {
    const handler = () => { void close(); };
    handlers.set(name, handler); process.once(name, handler);
  }
  return Object.assign(controller, { start, snapshot, end, close });
}
