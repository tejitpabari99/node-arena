import { playProxy, validateLevel } from './levels.js';
import type { EditorProxyEvent, EditorProxyInput } from './editor-solvable.js';

const emit = (event: EditorProxyEvent) => process.stdout.write(JSON.stringify(event) + '\n');
try {
  let text = '';
  for await (const chunk of process.stdin) text += String(chunk);
  const { level, unsolved } = JSON.parse(text) as EditorProxyInput;
  const report = validateLevel(level, undefined, 4, unsolved, undefined, (...args) => {
    const run = playProxy(...args); emit({ type: 'progress', run }); return run;
  });
  emit({ type: 'result', report });
} catch (error) {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  emit({ type: 'error', error: detail.slice(0, 2000) }); process.exitCode = 1;
}
