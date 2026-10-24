#!/usr/bin/env node
import { mkdirSync, openSync, writeSync, closeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createEventEncoder } from './lib/events.mjs';
import { buildObjective, objectivePhase } from './lib/objective.mjs';
import { acceptedMoveDelta } from './lib/delta.mjs';
import { exitCodeFor } from './lib/outcomes.mjs';
import { launchChrome, resolveChromeBinary } from './lib/chrome.mjs';
import { ensurePreviewServer, loopbackUrl } from './lib/server.mjs';
import { readCredits, runKane } from './lib/kane.mjs';

const cwd = fileURLToPath(new URL('../../', import.meta.url));
const booleanFlags = new Map([['serve', 'serve'], ['headless', 'headless'], ['software-gl', 'softwareGl'], ['no-fallback', 'noFallback'], ['dry-run', 'dryRun'], ['credits-only', 'creditsOnly'], ['help', 'help']]);
const numericFlags = new Map([['port', 'port'], ['seed', 'seed'], ['speed', 'speed'], ['moves', 'moves'], ['max-steps', 'maxSteps'], ['run-timeout', 'runTimeout'], ['max-runs', 'maxRuns'], ['stall-runs', 'stallRuns'], ['idle-max', 'idleMax'], ['min-credits', 'minCredits']]);

export function parseArgs(argv) {
  const options = { url: 'http://127.0.0.1:4173/?kane=1', mode: 'attach', port: 9222,
    moves: 3, maxSteps: 8, runTimeout: 150, maxRuns: 20, stallRuns: 3, idleMax: 240, minCredits: 200,
    serve: false, headless: false, softwareGl: false, noFallback: false, dryRun: false, creditsOnly: false,
    log: `kane-runs/${new Date().toISOString().replaceAll(':', '-')}/driver.ndjson` };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--') continue;
    if (!argv[i].startsWith('--')) throw new Error(`Unexpected argument: ${argv[i]}`);
    const [name, inline] = argv[i].slice(2).split(/=(.*)/s);
    if (booleanFlags.has(name)) {
      if (inline !== undefined) throw new Error(`--${name} takes no value`);
      options[booleanFlags.get(name)] = true; continue;
    }
    if (!numericFlags.has(name) && !['url', 'mode', 'chrome', 'log'].includes(name)) throw new Error(`Unknown flag: --${name}`);
    const value = inline ?? argv[++i];
    if (value === undefined || value.startsWith('--') || value === '') throw new Error(`Missing value for --${name}`);
    if (numericFlags.has(name)) {
      const number = Number(value), key = numericFlags.get(name);
      if (!Number.isFinite(number)) throw new Error(`Invalid --${name}`);
      const fractional = ['speed', 'idleMax', 'minCredits'].includes(key);
      const minimum = ['port', 'idleMax', 'minCredits', 'seed', 'speed'].includes(key) ? 0 : 1;
      if ((key === 'speed' && number <= 0) || number < minimum || (!fractional && !Number.isSafeInteger(number)) || (key === 'port' && number > 65535) || (key === 'runTimeout' && number < 120)) throw new Error(`Invalid --${name}`);
      options[key] = number;
    } else options[name] = value;
  }
  if (!['attach', 'launch'].includes(options.mode)) throw new Error('--mode must be attach or launch');
  const url = loopbackUrl(options.url);
  if (options.seed !== undefined) url.searchParams.set('seed', String(options.seed));
  if (options.speed !== undefined) url.searchParams.set('speed', String(options.speed));
  options.url = url.href;
  options.softwareGl ||= options.headless;
  return options;
}

function stateFields(summary, iter) {
  const count = state => summary.pairs.filter(pair => pair.state === state).length;
  return { iter, tick: summary.tick, result: summary.result, ready: count('ready'), active: count('active'), unavailable: count('unavailable'), humanDrawn: summary.human.drawn, humanCut: summary.human.cut };
}

function gameResult(summary, emit) {
  if (summary.result == null) return null;
  if (!['won', 'lost', 'timeout'].includes(summary.result)) throw new Error(`Unknown game result: ${summary.result}`);
  emit('game_over', { result: summary.result, winner: summary.over?.winner ?? null, tick: summary.tick,
    humanCommands: summary.human.commands, drawn: summary.human.drawn, cut: summary.human.cut });
  return summary.result;
}

/** Injectable boundaries permit no-spend loop verification and Task4 launch support. */
export async function runDriver(options, deps = {}) {
  const emit = deps.emit ?? (() => {}), signal = deps.signal;
  const balance = deps.readCredits ?? readCredits, startChrome = deps.launchChrome ?? launchChrome;
  const startServer = deps.ensurePreviewServer ?? ensurePreviewServer, run = deps.runKane ?? runKane;
  const sleep = deps.sleep ?? ((ms, signal) => delay(ms, undefined, { signal }));
  const started = Date.now();
  let page, stopServer, runs = 0, noProgress = 0, initialCredits, currentCredits, outcome = 'error';
  const warn = fields => emit('warn', fields);
  const pageCall = async method => {
    try { return await page[method](); }
    catch (error) { error.exitCode ??= 22; throw error; }
  };
  const credits = async () => {
    try {
      currentCredits = await balance({ signal });
      if (!Number.isFinite(currentCredits) || currentCredits < 0) throw new Error('Invalid credit balance');
    } catch (error) { throw Object.assign(new Error(`Credit lookup failed: ${error.message}`), { exitCode: 21 }); }
    initialCredits ??= currentCredits;
    emit('credits', { balance: currentCredits, floor: options.minCredits, ok: currentCredits >= options.minCredits,
      balanceDelta: initialCredits - currentCredits });
    return currentCredits >= options.minCredits;
  };
  try {
    const enough = await credits();
    emit('driver_start', { args: options, mode: options.mode, url: options.url, credits: currentCredits });
    if (!enough) outcome = 'credit_floor';
    else {
      if (options.mode !== 'attach' && !deps.launchMode) throw Object.assign(new Error('Launch mode requires the launch fallback adapter'), { exitCode: 22 });
      try { stopServer = await startServer({ url: options.url, serve: options.serve, cwd, signal }); }
      catch (error) { if (!signal?.aborted) error.exitCode ??= 23; throw error; }
      const open = options.mode === 'launch' ? deps.launchMode : startChrome;
      const chrome = deps.launchChrome || options.mode === 'launch' ? options.chrome : await resolveChromeBinary({ chrome: options.chrome, preferPlaywright: true });
      page = await open({ ...options, chrome, signal, onWarn: warn, handleSignals: false });
      emit('chrome_ready', { mode: options.mode, port: page.port, pid: page.pid, headless: page.headless });
      const initial = await pageCall('summary');
      emit('page_ready', { levelId: 'na-kane', speed: initial.speed ?? options.speed ?? 0.25, letters: initial.letters });
      while (true) {
        signal?.throwIfAborted();
        await pageCall('prepare');
        const enough = await credits();
        let before = await pageCall('summary');
        emit('state', stateFields(before, runs + 1));
        const terminal = gameResult(before, emit);
        if (terminal) { outcome = terminal; break; }
        if (!enough) { outcome = 'credit_floor'; break; }
        if (runs >= options.maxRuns) { outcome = 'max_runs'; break; }
        let waitedS = 0;
        while (!before.pairs.some(pair => ['ready', 'active'].includes(pair.state))) {
          emit('idle', { iter: runs + 1, waitedS });
          if (waitedS >= options.idleMax) break;
          const seconds = Math.min(2, options.idleMax - waitedS);
          await sleep(seconds * 1000, signal); waitedS += seconds;
          before = await pageCall('summary');
          emit('state', stateFields(before, runs + 1));
          if (before.result != null) break;
        }
        const idleTerminal = gameResult(before, emit);
        if (idleTerminal) { outcome = idleTerminal; break; }
        if (!before.pairs.some(pair => ['ready', 'active'].includes(pair.state))) { outcome = 'stalled'; break; }
        // Long local idle must never bypass a fresh pre-spend credit floor.
        if (waitedS > 0 && !await credits()) { outcome = 'credit_floor'; break; }
        const objective = buildObjective(before, { moves: options.moves }), iter = runs + 1;
        emit('run_start', { iter, phase: objectivePhase(before), objective, maxSteps: options.maxSteps });
        if (options.dryRun) { outcome = 'stalled'; break; }
        runs++;
        const response = await run(objective, { ...options, port: page.port, signal,
          onEvent: event => emit('kane', { iter, event }), onWarn: warn });
        emit('run_end', { iter, kaneExit: response.code, kaneStatus: response.end?.status ?? null,
          creditsRun: response.end?.credits_consumed ?? null, durationMs: response.durationMs, sessionDir: response.end?.session_dir ?? null });
        const after = await pageCall('summary'), delta = acceptedMoveDelta(before, after);
        const claimed = /^(pass(?:ed)?|completed|success)$/i.test(response.end?.status ?? '');
        const claimMatches = claimed === (delta.acceptedCount > 0);
        emit('verify', { iter, ...delta, claimMatches });
        if (!claimMatches) warn({ code: 'claim_mismatch', msg: 'Kane claim disagrees with accepted move counters' });
        if (delta.ambiguous) warn({ code: 'ambiguous_delta', msg: 'Accepted counters show progress; exact command attribution is ambiguous' });
        // Capture observed spend separately from Kane's reported credits, including the final run.
        let creditError;
        try { await credits(); } catch (error) { creditError = error; }
        const afterTerminal = gameResult(after, emit);
        if (afterTerminal) { outcome = afterTerminal; break; }
        if (creditError) throw creditError;
        const failureText = `${response.stderr ?? ''}\n${response.end?.reason ?? ''}\n${response.end?.reason_code ?? ''}`;
        if (/unauthenticated|unauthori[sz]ed|AUTH_REQUIRED|AUTH_FAILED|invalid[_ ]token|token expired|not logged in|please (?:log ?in|authenticate)|insufficient credits/i.test(failureText)) {
          warn({ code: 'kane_auth', msg: 'Kane refused the run for authentication or credits' });
          outcome = 'credit_floor'; break;
        }
        if (response.code !== 0 && /cdp|endpoint|connect|ECONN/i.test(`${response.stderr}\n${response.end?.reason ?? ''}`)) {
          if (deps.onAttachFailure && !options.noFallback) { await deps.onAttachFailure({ response, page, options }); }
          else { outcome = 'chrome'; break; }
        }
        noProgress = delta.acceptedCount === 0 ? noProgress + 1 : 0;
        if (delta.acceptedCount === 0) emit('stall', { iter, noProgress });
        if (noProgress >= options.stallRuns) { outcome = 'stalled'; break; }
      }
    }
  } catch (error) {
    outcome = ({ 21: 'credit_floor', 22: 'chrome', 23: 'not_ready' })[error.exitCode] ?? 'error';
    try { warn({ code: signal?.aborted ? 'interrupted' : 'driver_error', msg: error.message }); } catch { /* The terminal event still gets a separate attempt. */ }
  } finally {
    for (const cleanup of [() => page?.close(), () => stopServer?.()]) {
      try { await cleanup(); } catch (error) { outcome = 'error'; try { warn({ code: 'cleanup', msg: error.message }); } catch { /* Continue all cleanup. */ } }
    }
  }
  const terminal = { outcome, exitCode: exitCodeFor(outcome), runs, creditsUsed: initialCredits === undefined ? 0 : initialCredits - currentCredits, wallMs: Date.now() - started };
  emit('driver_end', terminal);
  return terminal;
}

const help = `Usage: node tools/kane/drive.mjs [flags]
--url URL --seed N --speed S --serve --mode attach|launch --port N --chrome PATH
--headless --software-gl --moves N --max-steps N --run-timeout SECONDS (>=120)
--max-runs N --stall-runs N --idle-max SECONDS --min-credits N --log PATH
--dry-run (free balance lookup; never kane-cli run) --credits-only --no-fallback --help
`;

export async function main(argv = process.argv.slice(2)) {
  const abort = new AbortController(), encoder = createEventEncoder();
  let fd, logFailed = false, stdoutFailed = false;
  const emit = (type, fields) => {
    const line = encoder(type, fields);
    let failure;
    if (!stdoutFailed) try { writeSync(1, line); } catch (error) { stdoutFailed = true; failure = error; }
    if (fd !== undefined && !logFailed) try { writeSync(fd, line); } catch (error) { logFailed = true; failure ??= error; }
    if (failure) throw failure;
  };
  const interrupt = signal => abort.abort(new Error(signal));
  const term = () => interrupt('SIGTERM'), int = () => interrupt('SIGINT');
  process.on('SIGTERM', term); process.on('SIGINT', int);
  try {
    const options = parseArgs(argv);
    if (options.help) { writeSync(1, help); return 0; }
    if (options.creditsOnly) {
      try { writeSync(1, JSON.stringify({ credits: await readCredits({ signal: abort.signal }) }) + '\n'); return 0; }
      catch (error) { writeSync(2, `${error.message}\n`); return 21; }
    }
    const path = resolve(options.log);
    mkdirSync(dirname(path), { recursive: true }); fd = openSync(path, 'a');
    return (await runDriver(options, { emit, signal: abort.signal })).exitCode;
  } catch (error) {
    try { emit('warn', { code: 'driver_error', msg: error.message }); emit('driver_end', { outcome: 'error', exitCode: 1, runs: 0, creditsUsed: 0, wallMs: 0 }); } catch { /* A broken output stream cannot be recovered. */ }
    return 1;
  } finally {
    if (fd !== undefined) closeSync(fd);
    process.removeListener('SIGTERM', term); process.removeListener('SIGINT', int);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await main();
