import { fileURLToPath } from 'node:url';

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface Config {
  port: number;
  host: string;
  /** Exact origins or single-label `*` wildcard patterns. */
  allowedOrigins: string[];
  allowNoOrigin: boolean;
  inputDelay: number;
  maxRooms: number;
  maxConns: number;
  contentDir: string;
  logLevel: LogLevel;
}

export class ConfigError extends Error {
  constructor(readonly errors: string[]) {
    super(`Invalid config: ${errors.join('; ')}`);
    this.name = 'ConfigError';
  }
}

export const DEFAULT_CONTENT_DIR = fileURLToPath(new URL('../../../packages/content/data', import.meta.url));

type Env = Record<string, string | undefined>;

function intIn(env: Env, key: string, def: number, min: number, max: number, errors: string[]): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return def;
  if (!/^\d+$/.test(raw)) { errors.push(`${key} must be an integer (got "${raw}")`); return def; }
  const n = Number(raw);
  if (n < min || n > max) { errors.push(`${key} must be ${min}..${max} (got ${n})`); return def; }
  return n;
}

/** Pure: parses and validates env. Throws `ConfigError` listing every bad value. */
export function parseConfig(env: Env): Config {
  const errors: string[] = [];
  const port = intIn(env, 'PORT', 8080, 0, 65535, errors);
  const inputDelay = intIn(env, 'INPUT_DELAY', 3, 1, 10, errors);
  const maxRooms = intIn(env, 'MAX_ROOMS', 40, 1, 100000, errors);
  const maxConns = intIn(env, 'MAX_CONNS', 200, 1, 100000, errors);
  const host = env.HOST === undefined || env.HOST === '' ? '0.0.0.0' : env.HOST;
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '');
  for (const o of allowedOrigins) {
    if (!/^https?:\/\/[^\s/]+$/.test(o)) errors.push(`ALLOWED_ORIGINS entry invalid: "${o}"`);
  }
  let allowNoOrigin = false;
  const ano = env.ALLOW_NO_ORIGIN;
  if (ano !== undefined && ano !== '') {
    if (ano === '1' || ano === 'true') allowNoOrigin = true;
    else if (ano === '0' || ano === 'false') allowNoOrigin = false;
    else errors.push(`ALLOW_NO_ORIGIN must be 0/1/true/false (got "${ano}")`);
  }
  let logLevel: LogLevel = 'info';
  const ll = env.LOG_LEVEL;
  if (ll !== undefined && ll !== '') {
    if ((LOG_LEVELS as readonly string[]).includes(ll)) logLevel = ll as LogLevel;
    else errors.push(`LOG_LEVEL must be one of ${LOG_LEVELS.join('|')} (got "${ll}")`);
  }
  const contentDir = env.CONTENT_DIR === undefined || env.CONTENT_DIR === '' ? DEFAULT_CONTENT_DIR : env.CONTENT_DIR;
  if (errors.length > 0) throw new ConfigError(errors);
  return { port, host, allowedOrigins, allowNoOrigin, inputDelay, maxRooms, maxConns, contentDir, logLevel };
}

/** Boot helper: bad env -> message on stderr, exit 1. `exit` injectable for tests. */
export function loadConfigOrExit(
  env: Env = process.env,
  exit: (code: number) => never = (c) => process.exit(c),
  err: (msg: string) => void = (m) => process.stderr.write(`${m}\n`),
): Config {
  try {
    return parseConfig(env);
  } catch (e) {
    if (e instanceof ConfigError) { err(e.message); return exit(1); }
    throw e;
  }
}
