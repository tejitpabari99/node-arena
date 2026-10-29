import { defineConfig, devices } from '@playwright/test';

// Separate PvP suite (web + ws server). Output dir dist-test-pvp keeps the campaign dist-test untouched.
export default defineConfig({
  testDir: './e2e-pvp',
  testMatch: '*.spec.ts',
  outputDir: '../../test-results/pvp/playwright',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  preserveOutput: 'always',
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  projects: [{
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
    },
  }],
  webServer: [
    {
      command: 'node ../server/dist/main.js',
      env: { PORT: '8081', HOST: '127.0.0.1', ALLOWED_ORIGINS: 'http://127.0.0.1:4173', LOG_LEVEL: 'warn' },
      url: 'http://127.0.0.1:8081/healthz',
      reuseExistingServer: false,
    },
    {
      command: 'vite preview --host 127.0.0.1 --outDir dist-test-pvp --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: false,
    },
  ],
});
