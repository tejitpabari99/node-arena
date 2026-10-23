import { defineConfig } from '@playwright/test';
import shared from './playwright.config';

// Kept outside e2e so the 100-second owner pass is explicitly opt-in.
export default defineConfig(shared, {
  testDir: './campaign',
  testMatch: '*.spec.ts',
  outputDir: '../../test-results/campaign/playwright',
  timeout: 60000,
  use: { viewport: { width: 1280, height: 720 } },
});
