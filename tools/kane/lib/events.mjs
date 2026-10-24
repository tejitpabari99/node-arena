export const EVENT_TYPES = Object.freeze([
  'driver_start', 'chrome_ready', 'page_ready', 'credits', 'state', 'idle', 'run_start',
  'kane', 'run_end', 'verify', 'stall', 'warn', 'fallback', 'game_over', 'driver_end',
]);

/** Common schema keys cannot be overridden by event-specific fields. */
export function encodeEvent(type, fields = {}, { seq, ts } = {}) {
  if (!EVENT_TYPES.includes(type)) throw new TypeError(`Unknown event type: ${type}`);
  if (!Number.isSafeInteger(seq) || seq < 1) throw new RangeError('seq must be a positive integer');
  if (typeof ts !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(ts) || !Number.isFinite(Date.parse(ts))) throw new TypeError('ts must be an ISO timestamp');
  return JSON.stringify({ ...fields, v: 1, ts, seq, type }) + '\n';
}

/** No I/O: callers decide where the same encoded line is written. */
export function createEventEncoder({ now = () => new Date(), startSeq = 0 } = {}) {
  let seq = startSeq;
  return (type, fields = {}) => encodeEvent(type, fields, { seq: ++seq, ts: now().toISOString() });
}

/** Kane step objects have no `type`; preserve every raw field as received. */
export function wrapKaneLine(line, iter) {
  if (!line.trim()) return null;
  const event = JSON.parse(line);
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new TypeError('Kane line must contain a JSON object');
  return { iter, event };
}
