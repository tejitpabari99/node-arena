import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const FIXTURES = join(import.meta.dirname, 'fixtures');
export const FIXTURE_TEXTASSETS = join(FIXTURES, 'TextAsset');

export function readExpected(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, 'expected', name), 'utf8'));
}

/** Registered themes for tests that exercise the gate (production reads them from the v2 manifest via `registeredThemes`). */
export const TEST_THEMES: readonly string[] = ['green', 'snow'];
