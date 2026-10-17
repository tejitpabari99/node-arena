/** Test hooks (`?test=1`, `?fixture=`) exist only in dev or a build made with VITE_TEST_HOOKS=1 (see main.tsx). */

export interface TestHookRequest { testing: boolean; fixture: string | null }

/** Parses the hook params; everything is inert unless `enabled`. */
export function testHookRequest(search: string, enabled: boolean): TestHookRequest {
  if (!enabled) return { testing: false, fixture: null };
  const query = new URLSearchParams(search);
  const testing = query.get('test') === '1';
  return { testing, fixture: testing && query.has('fixture') ? query.get('fixture')! : null };
}
