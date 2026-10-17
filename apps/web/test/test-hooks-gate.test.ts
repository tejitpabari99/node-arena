import { describe, it, expect } from 'vitest';
import { testHookRequest } from '../src/test-harness/gate';

describe('test hook gate', () => {
  it('ignores ?test=1 and ?fixture= when the build flag is off', () => {
    expect(testHookRequest('?test=1&fixture=visual', false)).toEqual({ testing: false, fixture: null });
  });
  it('honours the hooks when the flag is on', () => {
    expect(testHookRequest('?test=1&fixture=visual', true)).toEqual({ testing: true, fixture: 'visual' });
    expect(testHookRequest('?test=1', true)).toEqual({ testing: true, fixture: null });
  });
  it('requires test=1 for a fixture even when enabled', () => {
    expect(testHookRequest('?fixture=visual', true)).toEqual({ testing: false, fixture: null });
  });
});
