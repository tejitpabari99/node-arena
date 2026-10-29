import { spawn } from 'node:child_process';
import { constants } from 'node:os';

const packageManager = process.env.npm_execpath;
if (!packageManager) {
  console.error('Start local PvP with pnpm dev:pvp from the repository root.');
  process.exitCode = 1;
} else {
  // pnpm supplies its JS entry point (or its standalone executable), avoiding
  // Unix-only env assignments and Windows pnpm.cmd shell quoting.
  const standalone = /\.exe$/i.test(packageManager);
  const processGroup = process.platform !== 'win32';
  const args = ['--parallel', '--filter', '@node-arena/web', '--filter', '@node-arena/server', 'dev'];
  const child = spawn(standalone ? packageManager : process.execPath, standalone ? args : [packageManager, ...args], {
    stdio: 'inherit',
    shell: false,
    detached: processGroup,
    env: {
      ...process.env,
      PORT: process.env.PORT || '8080',
      ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173',
    },
  });
  const forwardSignal = signal => {
    if (!child.pid) return;
    try {
      // pnpm starts shell/watch grandchildren; stop the entire POSIX group.
      if (processGroup) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  const interrupt = () => forwardSignal('SIGINT');
  const terminate = () => forwardSignal('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  child.on('error', error => {
    console.error(`Unable to start PvP development servers: ${error.message}`);
    process.exitCode = 1;
  });
  child.on('close', (code, signal) => {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
    process.exitCode = process.exitCode ?? code ?? (signal ? 128 + constants.signals[signal] : 1);
  });
}
