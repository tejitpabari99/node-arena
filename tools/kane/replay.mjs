import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveChromeBinary } from './lib/chrome.mjs';
import { runProcess } from './lib/processes.mjs';
import { ensurePreviewServer, loopbackUrl } from './lib/server.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const infra = message => new Error(message);

/** A per-step run_end is never the test verdict. Unknown/missing terminals fail closed. */
export function replayExitCode(code, terminal) {
  if (![0, 1].includes(code)) return 2;
  if (!terminal?.overall_status) return 2;
  if (code === 0 && terminal.overall_status === 'passed') return 0;
  if (code === 1 || ['failed', 'broken', 'skipped'].includes(terminal.overall_status)) return 1;
  return 2;
}

function scalar(value) {
  const text = value.trim();
  if (/^(true|false)$/.test(text)) return text === 'true';
  if (/^-?\d+$/.test(text)) return Number(text);
  if (/^"(?:[^"\\]|\\.)*"$/.test(text)) return JSON.parse(text);
  if (/^'(?:[^']|'')*'$/.test(text)) return text.slice(1, -1).replace(/''/g, "'");
  if (!text || /[\[\]{}#&*!|>]|^[-?:]|:\s/.test(text)) throw infra('Unsupported step YAML; recording cache cannot be verified');
  return text;
}

function parseTest(source) {
  const text = source.replace(/\r\n/g, '\n');
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!frontmatter) throw infra('Saved replay requires test frontmatter');
  let url;
  let metadata;
  // No imports, variables, or datasets: their substitution can change the recorded
  // step hash and silently trigger paid authoring despite --no-adaptive-heal.
  for (const line of frontmatter[1].split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (/^\s/.test(line) && ['tags', 'assurance'].includes(metadata)) continue;
    const match = /^(mode|url|headless|tags|assurance|max_steps|timeout|global_context|local_context):\s*(.*)$/.exec(line);
    if (!match) throw infra('Unsupported replay frontmatter; recording cache cannot be verified');
    metadata = match[1];
    if (metadata === 'url') url = String(scalar(match[2]));
  }
  if (!url) throw infra('Saved replay requires a loopback url in frontmatter');
  loopbackUrl(url);
  const content = text.slice(frontmatter[0].length);
  const steps = [...content.matchAll(/^## ([^\n]+)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)].map(match => {
    const heading = match[1].trim().replace(/\s@verifies\s+ac-[\w.:\/-]+(?:\s*,\s*ac-[\w.:\/-]+)*\s*$/, '');
    let body = match[2].trim();
    const config = { optional: false };
    const yaml = /^```yaml\s*\n([\s\S]*?)\n```\s*(?:\n|$)/.exec(body);
    if (yaml) {
      for (const line of yaml[1].split('\n')) {
        if (!line.trim() || line.trimStart().startsWith('#')) continue;
        const item = /^(optional|max_steps|timeout|global_context|local_context):\s*(.*)$/.exec(line);
        if (!item) throw infra('Unsupported replay step YAML; recording cache cannot be verified');
        config[item[1]] = scalar(item[2]);
      }
      if (typeof config.optional !== 'boolean') throw infra('Replay step optional must be boolean');
      body = body.slice(yaml[0].length).trim();
    }
    const sorted = Object.fromEntries(Object.entries(config).sort(([a], [b]) => a.localeCompare(b)));
    const md5 = createHash('md5').update(body).update('\n').update(JSON.stringify(sorted)).digest('hex');
    return { heading, body, md5 };
  });
  if (!steps.length || steps.some(step => !step.body || /(^|\n)\s*(@|```)|\{\{|\s@/.test(step.body + '\n' + step.heading))) {
    throw infra('Unsupported replay steps; recording cache cannot be verified');
  }
  return { url, steps };
}

/** Verify exactly the simple smoke format authored for this project before any spend. */
export async function validateRecording(file) {
  const test = parseTest(await readFile(file, 'utf8'));
  const stem = basename(file).replace(/_test\.md$/, '');
  if (stem === basename(file)) throw infra(`Expected a *_test.md recording: ${file}`);
  const output = join(dirname(file), `output-${stem}`);
  try {
    const result = await readFile(join(output, 'Result.md'), 'utf8');
    JSON.parse(await readFile(join(output, '.internal/meta.json'), 'utf8'));
    const recorded = [...result.replace(/\r\n/g, '\n').matchAll(/^## ([^\n]+)\nmd5: ([a-f\d]{32})\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)];
    if (recorded.length !== test.steps.length) throw infra('Step count changed');
    for (let index = 0; index < test.steps.length; index++) {
      const step = test.steps[index];
      const md5 = step.md5;
      const saved = recorded[index];
      if (!saved[1].startsWith(`${step.heading} ✓ passed`) || saved[2] !== md5 || saved[3].trim() !== step.body) throw infra(`Step ${index + 1} is stale or was not recorded successfully`);
      const flows = join(output, '.internal/steps', `${index + 1}-${md5.slice(0, 8)}`, 'flows');
      const entries = (await readdir(flows, { withFileTypes: true })).filter(entry => entry.isDirectory() && /^\d+$/.test(entry.name)).map(entry => Number(entry.name)).sort((a, b) => a - b);
      if (!entries.length) throw infra(`Step ${index + 1} has no recorded actions`);
      for (let flow = 0; flow <= entries.at(-1); flow++) {
        const actions = await readFile(join(flows, String(flow), 'actions.ndjson'), 'utf8');
        if (!actions.trim()) throw infra(`Step ${index + 1} has empty recorded actions`);
        for (const line of actions.trim().split('\n')) JSON.parse(line);
      }
    }
    return { file, output, url: test.url };
  } catch (error) {
    throw infra(`Missing or stale recording cache for ${file}: ${error.message}`);
  }
}

function argsFor(argv) {
  let serve = false;
  const files = [];
  for (const value of argv) {
    if (value === '--') continue;
    if (value === '--serve') serve = true;
    else if (value.startsWith('-')) throw infra(`Unknown replay option: ${value}`);
    else files.push(value);
  }
  return { serve, files };
}

/** No dependency or paid Kane calls are needed to test this boundary. */
export async function runReplay(argv = [], { root = ROOT, env = process.env, signal, stdout = line => process.stdout.write(line), stderr = line => process.stderr.write(line), kaneCommand = 'kane-cli' } = {}) {
  const cleanups = [];
  try {
    signal?.throwIfAborted();
    const { serve, files } = argsFor(argv);
    const directory = join(root, 'tools/kane/tests');
    const selected = files.length ? files.map(file => resolve(root, file)) : (await readdir(directory)).filter(name => name.endsWith('_test.md')).sort().map(name => join(directory, name));
    if (!selected.length) throw infra(`No saved *_test.md recordings in ${directory}`);
    const tests = [];
    // Validate every cache before any test runs: no partial spend on invalid input.
    for (const file of selected) tests.push(await validateRecording(file));
    const urls = [...new Set(tests.map(test => test.url))];
    for (const url of urls) cleanups.push(await ensurePreviewServer({ url, serve, cwd: root, env, signal }));
    // Replay defaults to the Playwright cache, independent of system Chrome.
    const chrome = await resolveChromeBinary({ env: env.KANE_CLI_CHROME_PATH ? env : { ...env, PATH: '' } });
    const childEnv = { ...env, KANE_CLI_CHROME_PATH: chrome, KANE_CLI_USER_AGENT: env.KANE_CLI_USER_AGENT || 'codex' };
    let exitCode = 0;
    for (const test of tests) {
      signal?.throwIfAborted();
      const temporary = await mkdtemp(join(tmpdir(), 'node-arena-kane-replay-'));
      try {
        const copied = join(temporary, basename(test.file));
        await cp(test.file, copied);
        await cp(test.output, join(temporary, basename(test.output)), { recursive: true });
        let pending = '';
        let terminal;
        let detail = {};
        const consume = chunk => {
          pending += chunk;
          let newline;
          while ((newline = pending.indexOf('\n')) !== -1) {
            const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
            try {
              const event = JSON.parse(line);
              if (event.type === 'test_md_done') terminal = event;
              if (event.session_dir || event.run_dir) detail.session_dir = event.session_dir || event.run_dir;
              if (event.reason || event.reason_code || event.error) detail.reason = event.reason || event.reason_code || event.error;
              if (event.type === 'test_md_summary' && event.overall_status) detail.status = event.overall_status;
            } catch { /* Kane banners are not NDJSON. */ }
          }
        };
        const result = await runProcess(kaneCommand, ['testmd', 'run', copied, '--headless', '--agent', '--no-adaptive-heal', '--timeout', '120'], { cwd: temporary, env: childEnv, signal, onStdout: chunk => { stdout(chunk); consume(chunk); } });
        consume('\n');
        const status = replayExitCode(result.code, terminal);
        if (status !== 0) {
          stderr(`${test.file}: status=${terminal?.overall_status || detail.status || 'infra'} reason=${detail.reason || result.stderr.trim() || (terminal ? `Kane exit ${result.code}` : 'Missing terminal test_md_done')} session_dir=${terminal?.session_dir || detail.session_dir || 'unavailable'}\n`);
          if (status === 2) return 2;
          exitCode = 1;
        }
      } finally { await rm(temporary, { recursive: true, force: true }); }
    }
    return exitCode;
  } catch (error) {
    stderr(`Replay infra: ${error.message}\n`);
    return 2;
  } finally {
    for (const cleanup of cleanups.reverse()) {
      try { await cleanup(); } catch (error) { stderr(`Replay cleanup infra: ${error.message}\n`); return 2; }
    }
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const controller = new AbortController();
  const onSignal = signal => controller.abort(new Error(`Replay interrupted by ${signal}`));
  const onInt = () => onSignal('SIGINT');
  const onTerm = () => onSignal('SIGTERM');
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  try { process.exitCode = await runReplay(process.argv.slice(2), { signal: controller.signal }); }
  finally { process.removeListener('SIGINT', onInt); process.removeListener('SIGTERM', onTerm); }
}
