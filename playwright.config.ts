import { defineConfig, devices } from '@playwright/test';

// The end-to-end flow runs the front end against the mock API server, which
// executes the real back-end code with in-memory Google services.
const API_PORT = 8788;
const WEB_PORT = 4174;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}/`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npx tsx mock-server/server.ts',
      url: `http://localhost:${API_PORT}/`,
      env: { MOCK_API_PORT: String(API_PORT), MOCK_APP_URL: `http://localhost:${WEB_PORT}/` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx vite --mode mock --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}/`,
      env: { VITE_API_URL: `http://localhost:${API_PORT}/` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});

export const MOCK_API = `http://localhost:${API_PORT}`;
