import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { test as setup, type Page } from '@playwright/test';
import {
  E2E_EMAIL,
  E2E_GUARDIAN_EMAIL,
  E2E_GUARDIAN_PASSWORD,
  E2E_INSTRUCTOR_EMAIL,
  E2E_INSTRUCTOR_PASSWORD,
  E2E_PASSWORD,
  GUARDIAN_SESSION,
  INSTRUCTOR_SESSION,
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

// The guardian, for app mode — POOLSE-90.
setup('sign in the E2E guardian', async ({ page }) => {
  setup.setTimeout(90_000);
  await signIn(page, E2E_GUARDIAN_EMAIL, E2E_GUARDIAN_PASSWORD, GUARDIAN_SESSION);
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
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  }

  await page.context().storageState({ path });
}
