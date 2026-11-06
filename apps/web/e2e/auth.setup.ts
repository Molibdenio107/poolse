import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { test as setup, type Page } from '@playwright/test';
import { Client } from 'pg';
import {
  E2E_EMAIL,
  E2E_GUARDIAN_EMAIL,
  E2E_GUARDIAN_PASSWORD,
  E2E_INSTRUCTOR_EMAIL,
  E2E_INSTRUCTOR_PASSWORD,
  E2E_MAINTENANCE_EMAIL,
  E2E_MAINTENANCE_PASSWORD,
  E2E_PASSWORD,
  GUARDIAN_SESSION,
  INSTRUCTOR_SESSION,
  MAINTENANCE_SESSION,
  PHONE_SESSION,
} from './session';

/**
 * Sign the E2E user in once and save the session for the phone projects —
 * POOLSE-88.
 *
 * Clerk's sign-in is two steps (address, then password), and a browser it has
 * not seen asks for a code at `/sign-in/client-trust`: 424242 is the fixed code
 * for a `+clerk_test` address on a development instance. The submit button is
 * matched exactly, because a loose match clicks "Continuar com Google".
 *
 * With no test user an empty session is written, so the phone projects still
 * start and their signed-in specs skip with a sentence rather than failing.
 */
setup('sign in the E2E user', async ({ page }) => {
  setup.setTimeout(90_000);
  await signIn(page, E2E_EMAIL, E2E_PASSWORD, PHONE_SESSION);
});

// The instructor, the same way — POOLSE-88 slice 2.
setup('sign in the E2E instructor', async ({ page }) => {
  setup.setTimeout(90_000);
  await signIn(page, E2E_INSTRUCTOR_EMAIL, E2E_INSTRUCTOR_PASSWORD, INSTRUCTOR_SESSION);
});

/*
 * The test club is never on a trial — sweep of 31-10-2026. It was made by the
 * E2E user signing up, so it started as a 15-day trial, and the hourly trial
 * clock made it read-only mid-session: every save in the phone suites then
 * failed as a 403 that looked like 28 broken features. `comped` + `active` is
 * a club the clock never touches (trial-clock.service.ts). Through
 * `DATABASE_URL`, the owner login, like every fixture here.
 */
setup('keep the E2E club open', async () => {
  const url = process.env['DATABASE_URL'];
  if (E2E_EMAIL === undefined || url === undefined) return;
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    await db.query(
      `UPDATE organization o
          SET billing_mode = 'comped', subscription_status = 'active',
              read_only_at = NULL, pending_delete_at = NULL
        WHERE o.id IN (
          SELECT m.organization_id FROM membership m
            JOIN app_user u ON u.id = m.app_user_id
            JOIN membership_role r ON r.membership_id = m.id AND r.role = 'owner' AND r.archived_at IS NULL
           WHERE lower(u.cached_email) = lower($1) AND m.archived_at IS NULL)
          AND o.suspended_at IS NULL
          AND (o.billing_mode <> 'comped' OR o.subscription_status <> 'active' OR o.read_only_at IS NOT NULL)`,
      [E2E_EMAIL],
    );
    // A run that dies inside `theme.spec` leaves its choice stored, and that
    // spec restores what it finds, so it would stay for every run after it.
    await db.query(
      `UPDATE app_user SET theme_preference = 'system', locale = 'pt-PT' WHERE lower(cached_email) = lower($1)`,
      [E2E_EMAIL],
    );
  } finally {
    await db.end();
  }
});

// The guardian, for app mode — POOLSE-90.
setup('sign in the E2E guardian', async ({ page }) => {
  setup.setTimeout(90_000);
  await signIn(page, E2E_GUARDIAN_EMAIL, E2E_GUARDIAN_PASSWORD, GUARDIAN_SESSION);
});

// Maintenance, for its home — POOLSE-181.
setup('sign in the E2E maintenance login', async ({ page }) => {
  setup.setTimeout(90_000);
  await signIn(page, E2E_MAINTENANCE_EMAIL, E2E_MAINTENANCE_PASSWORD, MAINTENANCE_SESSION);
});

async function signIn(
  page: Page,
  email: string | undefined,
  password: string | undefined,
  path: string,
): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  if (email === undefined || password === undefined) {
    writeFileSync(path, JSON.stringify({ cookies: [], origins: [] }));
    return;
  }

  const submit = page.getByRole('button', { name: /^(continuar|continue)$/i });

  await page.goto('/sign-in', { waitUntil: 'domcontentloaded' });
  await page.getByLabel(/e-?mail/i).first().fill(email);
  await submit.click();
  await page.getByLabel(/palavra-passe|password/i).first().fill(password);
  await submit.click();

  await page.waitForURL(/\/dashboard|client-trust|factor/, { timeout: 30_000 });
  if (!page.url().includes('/dashboard')) {
    // Typed into the code boxes once they exist, never before.
    const code = page.locator('input[inputmode="numeric"], input[autocomplete="one-time-code"]').first();
    await code.waitFor();
    await code.click();
    await page.keyboard.type('424242', { delay: 50 });
    // Clerk can take a while to redirect after "Success" on a cold dev server.
    await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
  }

  await page.context().storageState({ path });
}
