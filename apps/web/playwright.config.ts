import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests — the foundation, set up by POOLSE-58's QA pass.
 *
 * There were none before this. The repo's own suites cover the database
 * (`pnpm db:test`), the API against a real Postgres (`pnpm api:test`) and the
 * pure pieces (`pnpm web:test`); what none of them can see is a **screen** — a
 * menu item rendered for the wrong role, a route that flashes data before it
 * refuses, a control a keyboard cannot reach.
 *
 * **It drives a server somebody else started.** `reuseExistingServer` with no
 * `webServer` block, deliberately: `pnpm dev` and `pnpm build` share
 * `apps/web/.next`, and a test runner that started its own build would break the
 * dev server it was sharing a directory with — the repo has that written down as
 * a mistake it has made three times. Start the app, then run these.
 *
 * **Signed-out first, and signed-in behind a flag.** The assertions that need no
 * session are the ones that matter most for a screen about salaries: a visitor
 * cannot reach it, and the refusal is a refusal rather than a blank page with
 * data behind it. The signed-in half needs a Clerk test user, which is an
 * account decision rather than a code one — `E2E_EMAIL` / `E2E_PASSWORD` turn it
 * on, and the specs skip with a sentence saying why when they are absent.
 */
export default defineConfig({
  testDir: './e2e',
  // One worker: these drive one dev server against one database, and a second
  // worker would have two tests signing in and out of the same session.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: process.env['CI'] ? 'line' : [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'pt-PT',
    timezoneId: 'Europe/Lisbon',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
