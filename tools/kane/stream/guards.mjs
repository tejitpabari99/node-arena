import { isIP } from 'node:net';

const DAY_MS = 86_400_000;

function integer(env, key, fallback, multiplier = 1) {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback * multiplier;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw) * multiplier)) {
    throw new Error(`${key} must be a non-negative safe integer`);
  }
  return Number(raw) * multiplier;
}

function originUrl(value) {
  if (typeof value !== 'string' || !/^https?:\/\/[^/?#\\\s]+$/i.test(value)) return null;
  try {
    const url = new URL(value);
    return url.username || url.password || !url.hostname ? null : url;
  } catch { return null; }
}

/** Explicit env input keeps this module free of process/global clock dependencies. */
export function readGuardConfig(env = {}) {
  const origins = [];
  if (env.KANE_STREAM_ORIGINS) {
    if (typeof env.KANE_STREAM_ORIGINS !== 'string') throw new Error('Invalid KANE_STREAM_ORIGINS');
    for (const entry of env.KANE_STREAM_ORIGINS.split(',')) {
      const url = originUrl(entry.trim());
      if (!url) throw new Error('KANE_STREAM_ORIGINS must contain comma-separated HTTP(S) origins');
      origins.push(url.origin);
    }
  }
  return {
    ipCooldownMs: integer(env, 'KANE_IP_COOLDOWN_S', 600, 1000),
    dailyCap: integer(env, 'KANE_DAILY_CAP', 6),
    maxWs: integer(env, 'KANE_STREAM_MAX_WS', 100),
    maxSse: integer(env, 'KANE_STREAM_MAX_SSE', 200),
    maxWsPerIp: integer(env, 'KANE_STREAM_MAX_WS_PER_IP', 3),
    maxSsePerIp: integer(env, 'KANE_STREAM_MAX_SSE_PER_IP', 3),
    trustProxy: env.KANE_STREAM_TRUST_PROXY === '1',
    origins: [...new Set(origins)],
  };
}

function normalizeIp(value) {
  if (typeof value !== 'string') return null;
  const ip = value.trim();
  const family = isIP(ip);
  if (family === 4) return ip;
  // Scoped link-local socket addresses are deliberately grouped as unknown.
  if (family !== 6 || ip.includes('%')) return null;
  const canonical = new URL(`http://[${ip}]`).hostname.slice(1, -1);
  const mapped = /^::ffff:([\da-f]+):([\da-f]+)$/.exec(canonical);
  if (!mapped) return canonical;
  const high = parseInt(mapped[1], 16);
  const low = parseInt(mapped[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

/** Use its result as the IP key for BOTH start and connection admission. */
export function clientIp(request, config = readGuardConfig()) {
  const socketIp = normalizeIp(request.socket?.remoteAddress) ?? 'unknown';
  if (!config.trustProxy) return socketIp;
  const headers = request.headers ?? {};
  // An invalid preferred header fails closed to the socket, not a weaker header.
  if (headers['cf-connecting-ip'] !== undefined) return normalizeIp(headers['cf-connecting-ip']) ?? socketIp;
  const forwarded = headers['x-forwarded-for'];
  return (typeof forwarded === 'string' ? normalizeIp(forwarded.split(',')[0]) : null) ?? socketIp;
}

/** Required for POST /start and WS upgrade; never consults forwarded Host. */
export function checkOrigin(request, config = readGuardConfig()) {
  const { host, origin } = request.headers ?? {};
  const url = originUrl(origin);
  if (!url || typeof host !== 'string' || !/^(?:[\da-z.-]+|\[[\da-f:.]+\])(?::\d+)?$/i.test(host)) return false;
  try {
    const target = new URL(`${url.protocol}//${host}`);
    if (!target.hostname) return false;
    return target.host === url.host || config.origins.includes(url.origin);
  } catch { return false; }
}

export function createStartState() {
  return { day: null, starts: 0, lastStarts: new Map() };
}

function dayNumber(nowMs) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error('nowMs must be a non-negative safe integer');
  return Math.floor(nowMs / DAY_MS);
}

/** Read-only preflight; an accepted check does not reserve/consume a start. */
export function checkStart(state, ip, nowMs, config = readGuardConfig()) {
  const day = dayNumber(nowMs);
  const last = state.lastStarts.get(ip);
  if (last !== undefined && nowMs - last < config.ipCooldownMs) {
    return { allowed: false, status: 429, reason: 'ip_cooldown', retryAfterSeconds: Math.ceil((last + config.ipCooldownMs - nowMs) / 1000) };
  }
  if ((state.day === day ? state.starts : 0) >= config.dailyCap) {
    return { allowed: false, status: 429, reason: 'daily_cap', retryAfterSeconds: Math.ceil(((day + 1) * DAY_MS - nowMs) / 1000) };
  }
  return { allowed: true };
}

/** Atomic admission: caller must replace its state with result.state immediately. */
export function admitStart(state, ip, nowMs, config = readGuardConfig()) {
  const result = checkStart(state, ip, nowMs, config);
  if (!result.allowed) return { ...result, state };
  const day = dayNumber(nowMs);
  // Only admitted IPs are tracked; expired entries are removed on every admission.
  const lastStarts = new Map([...state.lastStarts].filter(([, at]) => nowMs - at < config.ipCooldownMs));
  lastStarts.set(ip, nowMs);
  return {
    allowed: true,
    state: { day, starts: (state.day === day ? state.starts : 0) + 1, lastStarts },
  };
}

export function createConnectionState() {
  return { ws: new Map(), sse: new Map() };
}

function connections(state, kind) {
  if (kind !== 'ws' && kind !== 'sse') throw new Error('Connection kind must be ws or sse');
  return state[kind];
}

/** Reserve a unique caller-provided identity before accepting the connection. */
export function admitConnection(state, { kind, ip, id }, config = readGuardConfig()) {
  const active = connections(state, kind);
  if (id === undefined || active.has(id)) throw new Error('Connection identity must be defined and unique within its kind');
  const maxTotal = kind === 'ws' ? config.maxWs : config.maxSse;
  const maxPerIp = kind === 'ws' ? config.maxWsPerIp : config.maxSsePerIp;
  if (active.size >= maxTotal) return { allowed: false, status: 429, reason: 'total_connections', state };
  let perIp = 0;
  for (const value of active.values()) if (value === ip) perIp++;
  if (perIp >= maxPerIp) return { allowed: false, status: 429, reason: 'ip_connections', state };
  const updated = new Map(active);
  updated.set(id, ip);
  return { allowed: true, state: { ...state, [kind]: updated } };
}

/** Call on close, aborted upgrade or setup failure; duplicate calls are safe. */
export function releaseConnection(state, kind, id) {
  const active = connections(state, kind);
  if (!active.has(id)) return state;
  const updated = new Map(active);
  updated.delete(id);
  return { ...state, [kind]: updated };
}
