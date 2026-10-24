// Process hygiene fixture: detached grandchildren, no browser, no network, no credits.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
if (process.argv.includes('--credits-only')) {
  process.stdout.write('{"credits":500}\n');
} else {
  process.on('SIGTERM', () => {});
  if (!process.argv.includes('--child')) {
    const profile = mkdtempSync(join(tmpdir(), 'node-arena-chrome-lifecycle-'));
    // Node with an explicit argv0 emulates profile ownership, without any browser.
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--child', `--user-data-dir=${profile}`], { argv0: 'chromium', detached: true, stdio: 'ignore' });
    process.stdout.write(JSON.stringify({ type: 'chrome_ready', mode: 'attach', port: 9222, pid: child.pid }) + '\n');
    child.unref();
    setTimeout(() => {
      const fallbackProfile = mkdtempSync(join(tmpdir(), 'node-arena-kane-launch-lifecycle-'));
      const fallback = spawn(process.execPath, [fileURLToPath(import.meta.url), '--child', `--user-data-dir=${fallbackProfile}`], { argv0: 'chromium', detached: true, stdio: 'ignore' });
      fallback.unref();
      process.stdout.write(JSON.stringify({ type: 'chrome_ready', mode: 'launch', port: 9223, headless: true }) + '\n');
    }, 100);
  }
  setInterval(() => {}, 1000);
}
