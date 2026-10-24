// Process hygiene fixture: detached grandchildren, no browser, no network, no credits.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
if (process.argv.includes('--credits-only')) {
  process.stdout.write('{"credits":500}\n');
} else {
  process.on('SIGTERM', () => {});
  if (!process.argv.includes('--child')) {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--child'], { detached: true, stdio: 'ignore' });
    process.stdout.write(JSON.stringify({ type: 'chrome_ready', port: 9222, pid: child.pid }) + '\n');
    child.unref();
  }
  setInterval(() => {}, 1000);
}
