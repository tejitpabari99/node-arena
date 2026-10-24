import { existsSync } from 'node:fs';
import { appendFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runProcess } from '../lib/processes.mjs';
import { ensurePreviewServer } from '../lib/server.mjs';
import { resolveChromeBinary } from '../lib/chrome.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const stages = new Set(['excerpt', 'ingest', 'extract', 'review', 'design', 'testrun', 'cover']);

function parse(argv) {
  const [stage, ...args] = argv.filter(arg => arg !== '--');
  if (!stages.has(stage)) throw new Error('Usage: run.sh excerpt|ingest|extract|review|design|testrun|cover [options]');
  const refs = [];
  const resume = [];
  let serve = false;
  let approve = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (stage === 'testrun' && arg === '--serve') serve = true;
    else if (stage === 'review' && arg === '--approve' && !approve) approve = true;
    else if (['extract', 'design'].includes(stage) && ['--resume', '--message', '--answer'].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      resume.push(arg, value);
    } else if (!arg.startsWith('-') && (['design', 'testrun'].includes(stage) || (stage === 'review' && approve))) refs.push(arg);
    else throw new Error(`Unknown ${stage} option: ${arg}`);
  }
  if (approve && !refs.length) throw new Error('--approve requires explicit refs from the review listing');
  if (resume.length && !resume.includes('--resume')) throw new Error('Answers/messages require --resume');
  if (stage === 'design' && resume.length && refs.length !== 1) throw new Error('Resuming design requires exactly one reviewed use-case ref');
  return { stage, refs, serve, approve, resume };
}

function rowsFrom(stdout) {
  const rows = stdout.trim() ? stdout.trim().split('\n').map(line => JSON.parse(line)) : [];
  if (rows.some(row => !row || typeof row.id !== 'string' || typeof row.label !== 'string' || typeof row.trust !== 'string')) {
    throw new Error('Invalid context list --json rows; refusing to select work');
  }
  return rows;
}

function select(rows, refs, label) {
  const eligible = rows.filter(row => row.label === label && row.trust === 'trusted' && row.fresh === 'fresh');
  const selected = refs.length ? refs.map(ref => {
    const row = eligible.find(item => item.id === ref || item.cid === ref);
    if (!row) throw new Error(`Ref ${ref} is not a fresh reviewed ${label}; run review first`);
    return row;
  }) : eligible;
  if (!selected.length) throw new Error(`No fresh reviewed ${label} items; run review first`);
  return [...new Map(selected.map(row => [row.id, row])).values()];
}

/** Decode the CLI's escaped content fragments as plain text, never executable HTML. */
function contentText(html) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return html
    .replace(/<span\b[^>]*class=["']k["'][^>]*>([\s\S]*?)<\/span>/gi, '$1: ')
    .replace(/<span\b[^>]*class=["']chip["'][^>]*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(?:div|li|p|pre|ul|ol|h[1-6])>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
      if (!entity.startsWith('#')) return entities[entity.toLowerCase()];
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    })
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function reviewContent(rows, graph) {
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || !graph.contentHtml || typeof graph.contentHtml !== 'object') {
    throw new Error('Invalid context view --json payload; full review content unavailable');
  }
  const nameOf = cid => graph.nodes.find(node => node.cid === cid)?.slug || cid;
  return rows.map(row => {
    const node = graph.nodes.find(item => row.cid ? item.cid === row.cid : item.slug === row.id);
    const html = node && graph.contentHtml[node.cid];
    if (typeof html !== 'string' || !html.trim()) throw new Error(`Full review content missing for ${row.id}`);
    const relations = graph.edges.filter(edge => edge.src === node.cid || edge.dst === node.cid).map(edge => {
      const anchors = [...new Set(edge.anchors || [])];
      return `${edge.type}: ${nameOf(edge.src)} → ${nameOf(edge.dst)}${anchors.length ? ` (${anchors.join(', ')})` : ''}`;
    });
    return `${row.id} — ${row.title || node.title || row.label} [${row.trust}; ${row.fresh}]\n${contentText(html)}\nCitations / relations:\n${relations.length ? relations.map(value => `- ${value}`).join('\n') : '- No citation relations recorded.'}\n`;
  }).join('\n');
}

/** Each invocation performs exactly one stage; no automatic paid retry or approval. */
export async function runAssure(argv, {
  root = ROOT, env = process.env, signal,
  stdout = value => process.stdout.write(value), stderr = value => process.stderr.write(value),
  preview = ensurePreviewServer, chrome = resolveChromeBinary,
} = {}) {
  const cwd = join(root, 'tools/kane/assure');
  const childEnv = { ...env, KANE_CLI_USER_AGENT: 'codex' };
  let cleanup;
  let commandIndex = 0;
  let logDirectory;
  try {
    const { stage, refs, serve, approve, resume } = parse(argv);
    if (stage !== 'excerpt' && [cwd, root].some(directory => existsSync(join(directory, '.testmuai/assurance.json')))) {
      throw new Error('Assurance runner requires a local .context store; shared project link found');
    }
    const checkCredits = async () => {
      const balance = await runProcess('pnpm', ['kane:credits'], { cwd: root, env: childEnv, signal });
      if (balance.code !== 0) throw new Error(`Credit balance lookup failed: ${balance.stderr.trim()}`);
      const objects = balance.stdout.split('\n').filter(line => line.trim().startsWith('{')).map(line => JSON.parse(line));
      const credits = objects.at(-1)?.credits;
      if (typeof credits !== 'number' || !Number.isFinite(credits) || credits < 200) {
        throw new Error(`Credit balance ${credits ?? 'unavailable'}: need at least 200 credits before a paid command`);
      }
      stderr(`Assurance balance: ${credits} credits (floor 200).\n`);
    };
    const execute = async (command, args, { paid = false, capture = false, commandCwd = cwd, commandEnv = childEnv } = {}) => {
      if (paid) await checkCredits();
      if (!logDirectory) {
        await mkdir(cwd, { recursive: true });
        logDirectory = await mkdtemp(join(cwd, 'output-runner-'));
      }
      const log = join(logDirectory, `${++commandIndex}.log`);
      await writeFile(log, `${JSON.stringify({ command, args, cwd: commandCwd })}\n`);
      // Serialize log writes so the process stream and its resume details stay ordered.
      let pending = Promise.resolve();
      const record = chunk => { pending = pending.then(() => appendFile(log, chunk)); };
      let result;
      try {
        result = await runProcess(command, args, { cwd: commandCwd, env: commandEnv, signal, timeoutMs: 600000,
          onStdout: chunk => { record(chunk); if (!capture) stdout(chunk); },
          onStderr: chunk => { record(chunk); stderr(chunk); },
        });
      } finally { await pending; }
      if (result.code === 3 && ['extract', 'design'].includes(stage)) {
        stderr(`Assurance paused; resume/questions preserved in ${log}. Resume explicitly; no retry was attempted.\n`);
      } else if (result.code !== 0) stderr(`Assurance command exited ${result.code ?? result.signal}; inspect ${log} and context sessions --json before retrying paid work.\n`);
      return result;
    };
    const kane = (args, options) => execute('kane-cli', args, options);
    const list = async () => {
      const result = await kane(['context', 'list', '--json'], { capture: true });
      if (result.code !== 0) throw new Error(`context list failed with exit ${result.code}`);
      return rowsFrom(result.stdout);
    };
    if (stage === 'excerpt') {
      const result = await execute(process.execPath, [join(cwd, 'build-excerpt.mjs')], { capture: true });
      if (result.code !== 0) return result.code ?? 2;
      await writeFile(join(cwd, 'excerpt.md'), result.stdout);
      stdout(result.stdout);
      return 0;
    }
    if (stage === 'ingest') return (await kane(['context', 'ingest', 'excerpt.md', '--mode', 'ci'])).code ?? 2;
    if (stage === 'extract') return (await kane(['context', 'extract', '--mode', 'agent', ...resume], { paid: true })).code ?? 2;
    if (stage === 'review') {
      const rows = await list();
      if (approve) {
        for (const ref of refs) {
          if (!rows.some(row => row.trust === 'derived' && (row.id === ref || row.cid === ref))) throw new Error(`Unknown/unreviewable ref: ${ref}`);
        }
        return (await kane(['context', 'review', '--approve', ...refs, '--mode', 'agent'])).code ?? 2;
      }
      const derived = rows.filter(row => row.trust === 'derived');
      if (derived.length) {
        // explain --json is history-only on CLI 0.10; the view export contains
        // full descriptions/criteria plus citation anchors on graph edges.
        const result = await kane(['context', 'view', '--json'], { capture: true });
        if (result.code !== 0) return result.code ?? 2;
        stdout(reviewContent(derived, JSON.parse(result.stdout)));
      } else stdout('No derived items awaiting review.\n');
      stderr('Human review required: approve only chosen refs with run.sh review --approve <refs...>. No items promoted.\n');
      return 0;
    }
    if (stage === 'design') {
      const selected = select(await list(), refs, 'usecase');
      for (const row of selected) {
        const result = await kane(['design', 'tests', '--use-case', row.id, '--mode', 'agent', '--max', '3', ...resume], { paid: true });
        if (result.code !== 0) return result.code ?? 2;
      }
      stderr('Design checkpoint: run review and obtain human approval of the tests before testrun.\n');
      return 0;
    }
    if (stage === 'testrun') {
      const selected = select(await list(), refs, 'test');
      await checkCredits();
      // Recheck just before spend, after the preview becomes ready.
      // Browser/preview cleanup runs for every outcome, including Kane errors and signals.
      const binary = await chrome({ env: childEnv, preferPlaywright: true });
      cleanup = await preview({ url: 'http://localhost:4173/?kane=1', serve, cwd: root, env: childEnv, signal });
      return (await kane(['testrun', 'run', '--from-context', selected.map(row => row.id).join(','), '--agent', '--no-adaptive-heal', '--headless'], {
        paid: true, commandEnv: { ...childEnv, KANE_CLI_CHROME_PATH: binary },
      })).code ?? 2;
    }
    const gaps = await kane(['cover', 'gaps']);
    if (gaps.code !== 0) return gaps.code ?? 2;
    return (await kane(['cover', '--mode', 'agent'])).code ?? 2;
  } catch (error) {
    stderr(`Assurance: ${error.message}\n`);
    return 2;
  } finally {
    if (cleanup) await cleanup();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const controller = new AbortController();
  const interrupt = signal => controller.abort(new Error(`Assurance interrupted by ${signal}`));
  const onInt = () => interrupt('SIGINT');
  const onTerm = () => interrupt('SIGTERM');
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  try { process.exitCode = await runAssure(process.argv.slice(2), { signal: controller.signal }); }
  finally { process.removeListener('SIGINT', onInt); process.removeListener('SIGTERM', onTerm); }
}
