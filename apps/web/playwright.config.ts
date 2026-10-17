import { defineConfig, devices } from '@playwright/test';

const development = process.env.WEB_TEST_SERVER === 'dev';
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  preserveOutput: 'always',
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  projects: [{
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
    },
  }],
  webServer: {
    command: development ? 'pnpm dev --port 4173 --strictPort' : 'pnpm preview:test --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
});
