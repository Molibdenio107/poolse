import { expect, test, type Page } from '@playwright/test';
import { Client } from 'pg';
import { E2E_GUARDIAN_EMAIL, E2E_GUARDIAN_PASSWORD, GUARDIAN_SESSION, NO_GUARDIAN } from './session';

/**
 * The guided tour on a phone — POOLSE-230, QA 3, 6 and 7.
 *
 * It never starts on its own; *Rever visita guiada* on Definições opens the
 * home and plays it on the tab bar; the keyboard moves it and Escape closes it.
 * The progress row the tour writes for the guardian is removed afterwards, and
 * only if this test made it.
 */

test.skip(E2E_GUARDIAN_EMAIL === undefined || E2E_GUARDIAN_PASSWORD === undefined, NO_GUARDIAN);
test.skip(process.env['DATABASE_URL'] === undefined, 'needs DATABASE_URL to tidy the row it writes');

test.use({ storageState: GUARDIAN_SESSION, viewport: { width: 360, height: 740 } });

/** `/app` hands a family on to `/app/familia` mid-load; that is not a failure. */
async function visit(page: Page, path: string): Promise<void> {
  try {
    await page.goto(path, { waitUntil: 'load' });
  } catch (error) {
    if (!String(error).includes('interrupted by another navigation')) throw error;
    await page.waitForLoadState('load');
  }
}

async function progressRowIds(): Promise<Set<string>> {
  const db = new Client({ connectionString: process.env['DATABASE_URL'] });
  await db.connect();
  try {
    const { rows } = await db.query<{ id: string }>('SELECT id FROM onboarding_progress');
    return new Set(rows.map((row) => row.id));
  } finally {
    await db.end();
  }
}

test('the tour never starts by itself, and plays from Definições on the tab bar', async ({ page }) => {
  const before = await progressRowIds();
  try {
    await visit(page, '/app');
    await expect(page).toHaveURL(/\/app\/familia/);
    await page.waitForTimeout(1500);
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await visit(page, '/app/perfil/definicoes?home=family');
    await page.getByRole('button', { name: /rever visita guiada|replay the guided tour/i }).click();

    const tour = page.getByRole('dialog');
    await expect(tour).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/app\/familia(?!.*tour=)/);
    // A family's tour is up to seven steps: the tabs plus what its Início holds.
    await expect(tour).toContainText(/Passo 1 de \d|Step 1 of \d/);
    await expect(tour.getByRole('button', { name: /^(seguinte|next)$/i })).toBeFocused();

    await page.keyboard.press('ArrowRight');
    await expect(tour).toContainText(/Passo 2 de \d|Step 2 of \d/);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  } finally {
    const after = await progressRowIds();
    const made = [...after].filter((id) => !before.has(id));
    if (made.length > 0) {
      const db = new Client({ connectionString: process.env['DATABASE_URL'] });
      await db.connect();
      try {
        await db.query('DELETE FROM onboarding_progress WHERE id = ANY($1::uuid[])', [made]);
      } finally {
        await db.end();
      }
    }
  }
});
