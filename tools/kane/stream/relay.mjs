/** Default-deny, I/O-free driver -> public log boundary (SP05 R6). */
const own = (object, key) => Object.hasOwn(object, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const integer = value => Number.isSafeInteger(value) ? value : undefined;
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
const bool = value => typeof value === 'boolean' ? value : undefined;
// The localhost exception needs an authority boundary: localhost.evil and
// localhost@remote are remote URLs too. Inspect the FULL value before truncation.
const sensitive = /LT_|token|secret|api[_-]?key|bearer|password|\/root\/|\/home\/|https?:\/\/(?!localhost(?::\d+)?(?:[/?#\s]|$))/i;
const text = value => typeof value === 'string' && !sensitive.test(value) ? value.slice(0, 300) : undefined;
const nullable = validator => value => value === null ? null : validator(value);

function fields(input, schema) {
  const output = {};
  for (const [key, validate] of Object.entries(schema)) {
    if (!own(input, key)) continue;
    const value = validate(input[key]);
    if (value !== undefined) output[key] = value;
  }
  return output;
}
const row = schema => value => {
  if (!object(value)) return undefined;
  const output = fields(value, schema);
  return Object.keys(output).length ? output : undefined;
};
const rows = validate => value => Array.isArray(value)
  ? value.map(validate).filter(item => item !== undefined) : undefined;

const letter = row({ letter: text, index: count, owner: integer, level: count });
const command = row({ type: text, player: count, from: count, to: count });
const accepted = row({ tick: count, type: text, from: count, to: count });
const humanCommand = row({ tick: count, cmd: command });
const stepSchema = { step: count, status: text, remark: text };
const endSchema = { status: text, summary: text, duration: number, credits_consumed: number };

function kaneEvent(value) {
  if (!object(value)) return undefined;
  // Real Kane steps have NO type. An unknown typed line must not masquerade as
  // a step by including step/status, even if future schemas reuse these keys.
  if (!own(value, 'type') && own(value, 'step') && count(value.step) !== undefined
    && own(value, 'status') && typeof value.status === 'string') return fields(value, stepSchema);
  if (value.type === 'run_end' && own(value, 'status') && typeof value.status === 'string'
    && own(value, 'summary') && typeof value.summary === 'string') return fields(value, endSchema);
  return undefined;
}

// Every nested object/array has its own schema; never copy an uninspected value.
const allowlist = Object.freeze({
  driver_start: { mode: text },
  chrome_ready: {},
  page_ready: { levelId: text, speed: number, letters: rows(letter) },
  credits: { ok: bool },
  state: { iter: count, tick: count, result: nullable(text), ready: count, active: count,
    unavailable: count, humanDrawn: count, humanCut: count },
  idle: { iter: count, waitedS: number },
  stall: { iter: count, noProgress: count },
  fallback: { iter: count, to: text },
  run_start: { iter: count, phase: text, objective: text, maxSteps: count },
  kane: { iter: count, event: kaneEvent },
  run_end: { iter: count, kaneStatus: nullable(text), durationMs: number },
  verify: { iter: count, accepted: rows(accepted), rejected: rows(row({ reason: text })), claimMatches: bool },
  warn: { code: text },
  game_over: { result: text, winner: nullable(integer), tick: count, humanCommands: rows(humanCommand), drawn: count, cut: count },
  driver_end: { outcome: text, runs: count, wallMs: number },
});

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
// Sanitized envelopes are immutable and privately recognized so the reduced
// run_end shape need not retain Kane's inner type when serialized/rebuffered.
const filtered = new WeakSet();

/** Return frozen {seq,type,...allowedFields}, or null. seq is the driver seq. */
export function filterDriverEvent(input) {
  if (!object(input)) return null;
  if (filtered.has(input)) return input;
  if (!own(input, 'seq') || count(input.seq) === undefined || input.seq === 0
    || !own(input, 'type') || typeof input.type !== 'string' || !own(allowlist, input.type)) return null;
  const publicFields = fields(input, allowlist[input.type]);
  if (input.type === 'kane' && !own(publicFields, 'event')) return null;
  const output = freeze({ seq: input.seq, type: input.type, ...publicFields });
  filtered.add(output);
  return output;
}

/** One complete NDJSON line only; callers own line splitting and size limits. */
export function parseDriverLine(line) {
  if (typeof line !== 'string') return null;
  try { return filterDriverEvent(JSON.parse(line)); } catch { return null; }
}

/** Safe default SSE message event. JSON escapes CR/LF in untrusted text. */
export function serializeSse(event) {
  const safe = filterDriverEvent(event);
  return safe ? `id: ${safe.seq}\ndata: ${JSON.stringify(safe)}\n\n` : null;
}

/**
 * Bounded CURRENT-RUN replay; no filesystem, timers, or transport side effects.
 * append accepts raw or previously filtered envelopes, rejects seq <= last seq.
 * Dropped events never consume buffer slots. replaySince accepts the literal
 * Last-Event-ID header (decimal string) or a numeric seq and returns a new array
 * of immutable events with greater seq. Missing/invalid/too-old cursors replay
 * the available history; equal-to-latest returns []; beyond-latest replays all.
 *
 * Caller MUST reset() immediately before each driver spawn (driver seq resets).
 * Cursors are run-scoped: viewers MUST recreate EventSource without an old id
 * when /api/state.runId changes. A numeric id alone cannot distinguish two runs
 * whose seq ranges overlap. Buffer reset never infers run changes from events.
 */
export function createRelayBuffer({ capacity = 200 } = {}) {
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 200) throw new RangeError('capacity must be 1..200');
  let events = [], lastSeq = 0;
  return {
    get size() { return events.length; },
    append(input) {
      const event = filterDriverEvent(input);
      if (!event || event.seq <= lastSeq) return null;
      lastSeq = event.seq;
      events.push(event);
      if (events.length > capacity) events.shift();
      return event;
    },
    replaySince(lastEventId) {
      const value = typeof lastEventId === 'string' && /^[0-9]+$/.test(lastEventId)
        ? Number(lastEventId) : typeof lastEventId === 'number' ? lastEventId : undefined;
      if (count(value) === undefined || value > lastSeq) return events.slice();
      return events.filter(event => event.seq > value);
    },
    reset() { events = []; lastSeq = 0; },
  };
}
