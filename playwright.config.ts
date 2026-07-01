import { defineConfig, devices } from '@playwright/test';

// Dedicated port so the test run never collides with a dev server a human (or
// an earlier agent) left running. reuseExistingServer:false forces a fresh
// build + preview every run, so tests always reflect the current source.
const PORT = 4329;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    // The portal islands need a Convex URL at build time. Tests never talk to
    // a deployment; a syntactically valid placeholder lets the islands mount
    // in CI (QA-6) so their rendered shells can be asserted on.
    env: {
      PUBLIC_CONVEX_URL:
        process.env.PUBLIC_CONVEX_URL ?? "https://placeholder-000.convex.cloud",
    },
  },
});
