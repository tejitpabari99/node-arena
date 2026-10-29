import type { LogLevel } from './config.js';

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** Fields never written, regardless of caller (defence in depth: no tokens/IPs). */
const REDACT = new Set(['token', 'auth', 'ip', 'addr', 'remoteAddress', 'password']);

export interface Logger {
  log(level: LogLevel, ev: string, fields?: Record<string, unknown>): void;
  debug(ev: string, fields?: Record<string, unknown>): void;
  info(ev: string, fields?: Record<string, unknown>): void;
  warn(ev: string, fields?: Record<string, unknown>): void;
  error(ev: string, fields?: Record<string, unknown>): void;
}

export interface LoggerOpts {
  level?: LogLevel;
  write?: (line: string) => void;
  now?: () => number;
}

/** JSON-line logger: `{ts,level,ev,room?,matchId?,...}`. */
export function createLogger(opts: LoggerOpts = {}): Logger {
  const min = ORDER[opts.level ?? 'info'];
  const write = opts.write ?? ((l: string) => { process.stdout.write(`${l}\n`); });
  const now = opts.now ?? Date.now;
  const log = (level: LogLevel, ev: string, fields: Record<string, unknown> = {}): void => {
    if (ORDER[level] < min) return;
    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) if (!REDACT.has(k) && k !== 'ts' && k !== 'level' && k !== 'ev') safe[k] = v;
    write(JSON.stringify({ ts: new Date(now()).toISOString(), level, ev, ...safe }));
  };
  return {
    log,
    debug: (ev, f) => log('debug', ev, f),
    info: (ev, f) => log('info', ev, f),
    warn: (ev, f) => log('warn', ev, f),
    error: (ev, f) => log('error', ev, f),
  };
}
