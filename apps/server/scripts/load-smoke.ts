/**
 * Load smoke (SP10): N bot-filled rooms against the real server loop. Report-only unless --strict.
 * Usage: pnpm load:smoke [-- --rooms 20 --seconds 60 --level <id> --json <path> --strict]
 * Fidelity: thin ws clients (no sim, no hash/cmd); bots run server-side as in production.
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, type ClientMessage, type LobbySeat, type ServerMessage, type Versions } from '@node-arena/net';
import { parseConfig } from '../src/config.js';
import { createLogger } from '../src/log.js';
import { startServer, type RunningServer } from '../src/main.js';

export const TARGET_P99_MS = 25;
export const TARGET_RSS_MB = 200;
export const LEVELS = ['na-pvp-duel-s', 'na-pvp-duel-m', 'na-pvp-cross'] as const;
const DIFFICULTIES = ['easy', 'normal', 'hard'] as const;
const SAMPLE_MS = 2000;
const PING_MS = 3000;

export interface Opts {
  rooms: number;
  seconds: number;
  level?: string | undefined;
  json?: string | undefined;
  strict: boolean;
  /** Override the p99 lateness target (ms); default 25. */
  p99Ms?: number | undefined;
  /** Quiet progress output (tests). */
  quiet?: boolean;
  /** Max time to wait for all rooms to reach `running`. */
  rampTimeoutMs?: number;
}

export interface Sample {
  tSec: number; running: number; lateP50Ms: number; lateP99Ms: number; rssMb: number;
  cpuPct: number; cpuPerRoomPct: number; framesPerSec: number; eldP99Ms: number; harnessHeapMb: number;
}
export interface Verdict { name: string; pass: boolean; detail: string }
export interface Report {
  config: Record<string, unknown>;
  samples: Sample[];
  summary: Record<string, number | string | null>;
  verdicts: Verdict[];
  events: string[];
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const mb = (b: number): number => Math.round((b / 1048576) * 10) / 10;
const r2 = (n: number): number => Math.round(n * 100) / 100;

let ipSeq = 0;
/** Distinct loopback-spoofed client IP (in-process mode only). */
const nextIp = (): string => { const n = ++ipSeq; return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`; };

interface Env {
  wsUrl: string;
  versions: Versions;
  origin?: string | undefined;
  spoofIp: boolean;
  runId: string;
}

class Stats { frames = 0; closed: string[] = []; errors: string[] = []; rematches = 0; started = 0 }

/** Thin ws client: host of one bot-filled room. */
class BotRoomClient {
  phase: 'connecting' | 'setup' | 'starting' | 'running' | 'ended' | 'dead' = 'connecting';
  code = '';
  private ws: WebSocket | undefined;
  private ping: NodeJS.Timeout | undefined;
  private pingId = 0;
  private level: string;
  constructor(readonly idx: number, private readonly env: Env, private readonly stats: Stats, level: string) { this.level = level; }

  get isRunning(): boolean { return this.phase === 'running'; }

  connect(): void {
    const headers: Record<string, string> = {};
    if (this.env.spoofIp) headers['Fly-Client-IP'] = nextIp();
    if (this.env.origin !== undefined) headers.Origin = this.env.origin;
    const ws = new WebSocket(this.env.wsUrl, { headers });
    this.ws = ws;
    ws.on('open', () => {
      this.send({
        t: 'hello', pv: PROTOCOL_VERSION, versions: this.env.versions, nick: `Load${this.idx}`,
        token: this.env.runId + (this.idx + 1).toString(16).padStart(16, '0'),
      });
      this.ping = setInterval(() => this.send({ t: 'ping', id: ++this.pingId }), PING_MS);
    });
    ws.on('message', (d) => this.onMsg(JSON.parse(String(d)) as ServerMessage));
    ws.on('error', (e) => { this.stats.errors.push(`ws#${this.idx}: ${e.message}`); });
    ws.on('close', () => { clearInterval(this.ping); if (this.phase !== 'dead') { this.phase = 'dead'; } });
  }

  private send(m: ClientMessage): void { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }

  private seatsFor(seats: LobbySeat[], host: number | null): { kind: 'human' | 'bot'; team: number; difficulty?: string }[] {
    return seats.map((s, i) => (i === host
      ? { kind: 'human' as const, team: s.team }
      : { kind: 'bot' as const, team: s.team, difficulty: DIFFICULTIES[(this.idx + i) % DIFFICULTIES.length]! }));
  }

  private onMsg(m: ServerMessage): void {
    this.stats.frames++;
    switch (m.t) {
      case 'welcome': this.phase = 'setup'; this.send({ t: 'room.create' }); break;
      case 'room.joined': this.code = m.code; break;
      case 'lobby.state': {
        if (this.phase !== 'setup' && this.phase !== 'ended') break;
        if (m.levelId !== this.level) { this.send({ t: 'lobby.update', levelId: this.level, seats: this.seatsFor(m.seats, m.host) }); break; }
        const want = this.seatsFor(m.seats, m.host);
        const ok = m.seats.every((s, i) => s.kind === want[i]!.kind && (s.kind !== 'bot' || s.difficulty === want[i]!.difficulty));
        if (!ok) { this.send({ t: 'lobby.update', levelId: this.level, seats: want }); break; }
        this.phase = 'starting';
        this.send({ t: 'lobby.start' });
        break;
      }
      case 'tick': case 'ticks': if (this.phase === 'starting') { this.phase = 'running'; this.stats.started++; } break;
      case 'end': this.phase = 'ended'; this.stats.rematches++; this.send({ t: 'rematch' }); break;
      case 'room.closed': this.stats.closed.push(`room#${this.idx}: ${m.reason}`); this.phase = 'dead'; break;
      case 'error': this.stats.errors.push(`room#${this.idx}: ${m.code}${m.detail ? ` (${m.detail})` : ''}`); break;
      default: break;
    }
  }

  close(): void { clearInterval(this.ping); this.phase = 'dead'; this.ws?.close(); }
}

interface Health {
  rooms: number; conns: number; running: number; lateP99Ms: number; lateP50Ms: number; rss: number; cpuMs: number;
  versions: Versions & { protocol: number };
}

async function health(httpUrl: string): Promise<Health> {
  const res = await fetch(`${httpUrl}/healthz`);
  return await res.json() as Health;
}

const pct = (xs: number[], p: number): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]!;
};

export async function runLoad(opts: Opts): Promise<Report> {
  const log = (s: string): void => { if (opts.quiet !== true) process.stdout.write(`${s}\n`); };
  const events: string[] = [];
  const n = opts.rooms;
  const p99Target = opts.p99Ms ?? TARGET_P99_MS;
  const srv: RunningServer = await startServer(
    parseConfig({ PORT: '0', HOST: '127.0.0.1', ALLOW_NO_ORIGIN: '1', MAX_ROOMS: String(n + 5), MAX_CONNS: String(n + 20) }),
    { log: createLogger({ level: 'error' }) },
  );
  const httpUrl = `http://127.0.0.1:${srv.port}`;
  const stats = new Stats();
  const eld = monitorEventLoopDelay({ resolution: 10 });
  const clients: BotRoomClient[] = [];
  const samples: Sample[] = [];
  try {
    const h0 = await health(httpUrl);
    const { protocol: _p, ...versions } = h0.versions;
    const env: Env = { wsUrl: `ws://127.0.0.1:${srv.port}`, versions, spoofIp: true, runId: randomBytes(8).toString('hex') };
    const levelFor = (i: number): string => opts.level ?? LEVELS[i % LEVELS.length]!;
    eld.enable();
    log(`load-smoke: ${n} rooms, ${opts.seconds}s steady, mode=in-process (harness+server share one process: numbers are an upper bound for the server)`);
    for (let i = 0; i < n; i++) {
      const c = new BotRoomClient(i, env, stats, levelFor(i));
      clients.push(c);
      c.connect();
      await sleep(40);
    }
    const rampStart = Date.now();
    const rampTimeout = opts.rampTimeoutMs ?? 30_000;
    while (clients.some((c) => !c.isRunning) && Date.now() - rampStart < rampTimeout) await sleep(100);
    const runningAtStart = clients.filter((c) => c.isRunning).length;
    events.push(`ramp: ${runningAtStart}/${n} running after ${Date.now() - rampStart} ms`);
    log(events[events.length - 1]!);

    // Steady-state window.
    eld.reset();
    let prev = await health(httpUrl);
    let prevT = performance.now();
    let prevFrames = stats.frames;
    const t0 = performance.now();
    let peakEld = 0;
    while (performance.now() - t0 < opts.seconds * 1000) {
      await sleep(Math.min(SAMPLE_MS, Math.max(50, opts.seconds * 1000 - (performance.now() - t0))));
      const h = await health(httpUrl);
      const t = performance.now();
      const dt = (t - prevT) / 1000;
      const cpuPct = ((h.cpuMs - prev.cpuMs) / 1000 / dt) * 100;
      peakEld = Math.max(peakEld, eld.percentile(99) / 1e6);
      samples.push({
        tSec: r2((t - t0) / 1000), running: h.running, lateP50Ms: r2(h.lateP50Ms), lateP99Ms: r2(h.lateP99Ms), rssMb: mb(h.rss),
        cpuPct: r2(cpuPct), cpuPerRoomPct: r2(h.running > 0 ? cpuPct / h.running : 0),
        framesPerSec: r2((stats.frames - prevFrames) / dt), eldP99Ms: r2(eld.percentile(99) / 1e6),
        harnessHeapMb: mb(process.memoryUsage().heapUsed),
      });
      eld.reset();
      prev = h; prevT = t; prevFrames = stats.frames;
    }
    const peak = (f: (s: Sample) => number): number => samples.reduce((m, s) => Math.max(m, f(s)), 0);
    const mean = (f: (s: Sample) => number): number => (samples.length === 0 ? 0 : samples.reduce((a, s) => a + f(s), 0) / samples.length);
    const minRunning = samples.reduce((m, s) => Math.min(m, s.running), Number.POSITIVE_INFINITY);
    const summary = {
      lateP50MsMax: r2(peak((s) => s.lateP50Ms)), lateP99MsMax: r2(peak((s) => s.lateP99Ms)),
      lateP99MsFinal: r2(samples.at(-1)?.lateP99Ms ?? 0), eldP99MsMax: r2(peakEld),
      rssMbPeak: peak((s) => s.rssMb), rssMbFinal: samples.at(-1)?.rssMb ?? 0, harnessHeapMbPeak: peak((s) => s.harnessHeapMb),
      cpuPctMean: r2(mean((s) => s.cpuPct)), cpuPctPeak: r2(peak((s) => s.cpuPct)), cpuPerRoomPctMean: r2(mean((s) => s.cpuPerRoomPct)),
      framesPerSecMean: r2(mean((s) => s.framesPerSec)), minRunning: Number.isFinite(minRunning) ? minRunning : 0,
      rematches: stats.rematches, roomClosed: stats.closed.length, errors: stats.errors.length,
    };
    const verdicts: Verdict[] = [
      { name: `p99 lateness < ${p99Target} ms`, pass: summary.lateP99MsFinal < p99Target, detail: `final window ${summary.lateP99MsFinal} ms, max over samples ${summary.lateP99MsMax} ms (window = last 400 wakes, may include ramp)` },
      { name: `peak RSS < ${TARGET_RSS_MB} MB`, pass: summary.rssMbPeak < TARGET_RSS_MB, detail: `peak ${summary.rssMbPeak} MB (harness+server)` },
      { name: `all ${n} rooms stayed running`, pass: runningAtStart === n && summary.minRunning >= n, detail: `started ${runningAtStart}, min running ${summary.minRunning}` },
      { name: 'no unexpected room.closed/error', pass: stats.closed.length === 0 && stats.errors.length === 0, detail: [...stats.closed, ...stats.errors].slice(0, 5).join('; ') || 'none' },
    ];
    const report: Report = {
      config: {
        rooms: n, seconds: opts.seconds, mode: 'in-process', level: opts.level ?? 'cycle:' + LEVELS.join(','),
        botDifficultyMix: 'seat j of room i = [easy,normal,hard][(i+j)%3]', targets: { p99Ms: p99Target, rssMb: TARGET_RSS_MB },
        fidelity: 'thin ws clients, no sim, no hash/cmd; bots server-side; harness shares the process',
        node: process.version, cpus: 1, time: new Date().toISOString(),
      },
      samples, summary, verdicts, events,
    };
    return report;
  } finally {
    eld.disable();
    for (const c of clients) c.close();
    await srv.close();
  }
}

export function printReport(r: Report): void {
  const out: string[] = [];
  out.push('', `config: ${JSON.stringify(r.config)}`, '');
  out.push(['t(s)', 'running', 'late p50', 'late p99', 'rss MB', 'cpu%', 'cpu%/room', 'frames/s', 'eld p99'].map((v) => v.padEnd(10)).join(''));
  for (const s of r.samples) {
    out.push([s.tSec, s.running, s.lateP50Ms, s.lateP99Ms, s.rssMb, s.cpuPct, s.cpuPerRoomPct, s.framesPerSec, s.eldP99Ms].map((v) => String(v).padEnd(10)).join(''));
  }
  out.push('', `summary: ${JSON.stringify(r.summary)}`, '');
  for (const v of r.verdicts) out.push(`${v.pass ? 'PASS' : 'FAIL'}  ${v.name}  (${v.detail})`);
  process.stdout.write(`${out.join('\n')}\n`);
}

function parseArgs(argv: string[]): Opts {
  const o: Opts = { rooms: 20, seconds: 60, strict: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const val = (): string => { const v = argv[++i]; if (v === undefined) throw new Error(`${a} needs a value`); return v; };
    if (a === '--') continue;
    else if (a === '--rooms') o.rooms = Number(val());
    else if (a === '--seconds') o.seconds = Number(val());
    else if (a === '--level') o.level = val();
    else if (a === '--json') o.json = val();
    else if (a === '--strict') o.strict = true;
    else if (a === '--p99-ms') o.p99Ms = Number(val());
    else throw new Error(`unknown flag ${a}`);
  }
  if (!Number.isInteger(o.rooms) || o.rooms < 1 || !(o.seconds > 0)) throw new Error('--rooms must be >=1 and --seconds >0');
  return o;
}

async function main(): Promise<void> {
  let code = 0;
  try {
    const opts = parseArgs(process.argv.slice(2));
    const report = await runLoad(opts);
    printReport(report);
    if (opts.json !== undefined) writeFileSync(opts.json, `${JSON.stringify(report, null, 2)}\n`);
    if (opts.strict && report.verdicts.some((v) => !v.pass)) code = 1;
  } catch (e) {
    process.stderr.write(`load-smoke harness error: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    code = 2;
  }
  process.exit(code);
}

if (process.argv[1] !== undefined && process.argv[1] === fileURLToPath(import.meta.url)) void main();
