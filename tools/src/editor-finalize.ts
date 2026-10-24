import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

export type EditorFinalizeEvent = { type: 'started'; id: string } | { type: 'step'; step: string } | { type: 'output'; step: string; output: string } | { type: 'completed'; step: string; exitCode: number } | { type: 'error'; step: string; exitCode: number; error: string } | { type: 'result' };
export type EditorCommandRunner = (root: string, command: string, args: string[], output: (text: string) => void) => Promise<number>;
export type EditorFinalizeRunner = (root: string, id: string, emit: (event: EditorFinalizeEvent) => void, signal: AbortSignal) => Promise<void>;

/** Never a shell. Keep the gate until the whole active command exits, even on disconnect:
 * killing pnpm alone would orphan a lock-writing descendant and permit a racing Save. */
export const runEditorCommand: EditorCommandRunner = (root, command, args, output) => new Promise(resolveJob => {
  const child = execFile(command, args, { cwd: root, maxBuffer: 8 * 1024 * 1024 });
  child.stdout!.on('data', (chunk: Buffer | string) => output(String(chunk)));
  child.stderr!.on('data', (chunk: Buffer | string) => output(String(chunk)));
  child.on('error', error => output(error.message + '\n'));
  child.on('close', code => resolveJob(code ?? 1));
});

/** Fixed allowlisted sequence; callers supply only a validated level id. No git writes/commit. */
export async function finalizeEditorLevel(root: string, id: string, emit: (event: EditorFinalizeEvent) => void, signal: AbortSignal, run: EditorCommandRunner = runEditorCommand): Promise<void> {
  if (!/^na-[a-z0-9-]{1,40}$/.test(id)) throw new Error('Invalid writable level id');
  const require = createRequire(import.meta.url);
  const worker = (step: string) => ['--import', require.resolve('tsx'), resolve(root, 'tools/src/editor-finalize-worker.ts'), step, id];
  const steps: [string, string, string[]][] = [
    ['validate', process.execPath, worker('validate')],
    ['contentVersion', process.execPath, worker('contentVersion')],
    ['BOT_VERSION', process.execPath, worker('BOT_VERSION')],
    ['content:lock', 'pnpm', ['content:lock']],
    ['levels:lock', 'pnpm', ['levels:lock', '--levels', id]],
    ['build:bots', 'pnpm', ['build:bots']],
    ['sim:golden', process.execPath, worker('sim:golden')],
    ['bots:golden', process.execPath, worker('bots:golden')],
    ['validate:content', 'pnpm', ['validate:content', '--base', 'HEAD']],
    ['check:content', 'pnpm', ['check:content', '--base', 'HEAD']],
    ['git diff --stat', 'git', ['diff', '--stat']],
  ];
  emit({ type: 'started', id });
  for (const [step, command, args] of steps) {
    if (signal.aborted) return;
    emit({ type: 'step', step });
    let exitCode: number;
    try { exitCode = await run(root, command, args, output => emit({ type: 'output', step, output })); }
    catch (error) { emit({ type: 'output', step, output: (error as Error).message }); exitCode = 1; }
    if (exitCode !== 0) { emit({ type: 'error', step, exitCode, error: `${step} failed (exit ${exitCode})` }); return; }
    emit({ type: 'completed', step, exitCode });
  }
  if (!signal.aborted) emit({ type: 'result' });
}

/** validate:content is already read-only: no locks or version bumps on a status request. */
export async function editorFinalizeStatus(root: string): Promise<{ unfinalized: boolean; exitCode: number; output: string }> {
  let output = '';
  const exitCode = await runEditorCommand(root, 'pnpm', ['validate:content', '--base', 'HEAD', '--format', 'json'], chunk => { output += chunk; });
  return { unfinalized: exitCode !== 0, exitCode, output };
}
