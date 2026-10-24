export const EXIT_CODES = Object.freeze({
  won: 0, lost: 10, timeout: 11, stalled: 20, credit_floor: 21, auth: 21,
  chrome: 22, not_ready: 23, max_runs: 30, error: 1,
});

/** Unknown/LLM-claimed statuses cannot produce a successful exit. */
export function exitCodeFor(outcome) {
  return Object.hasOwn(EXIT_CODES, outcome) ? EXIT_CODES[outcome] : EXIT_CODES.error;
}
