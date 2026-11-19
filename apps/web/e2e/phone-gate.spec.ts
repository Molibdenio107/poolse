import { expect, test } from '@playwright/test';
import { Client } from 'pg';
import { E2E_GUARDIAN_EMAIL, E2E_GUARDIAN_PASSWORD, GUARDIAN_SESSION, NO_GUARDIAN } from './session';

/**
 * *Confirmar os seus dados* — POOLSE-227, QA 1, 3 and 9 on a phone.
 *
 * The guardian's mobile is blanked, so the next page is the gate in place of
 * the family's home: only the mobile is missing, the children are listed
 * read-only, and *Confirmar* lets them through. The old value is put back
 * whatever happens; the suite runs one worker, so no other spec meets the gate.
 */

test.skip(E2E_GUARDIAN_EMAIL === undefined || E2E_GUARDIAN_PASSWORD === undefined, NO_GUARDIAN);
test.skip(process.env['DATABASE_URL'] === undefined, 'needs DATABASE_URL to blank a field');

test.use({ storageState: GUARDIAN_SESSION, viewport: { width: 360, height: 740 } });

async function setPhone(phone: string | null): Promise<string | null> {
  const db = new Client({ connectionString: process.env['DATABASE_URL'] });
  await db.connect();
  try {
    const { rows } = await db.query<{ contact_phone: string | null }>(
      `UPDATE app_user u SET contact_phone = $2
         FROM app_user before
        WHERE before.id = u.id AND lower(u.cached_email) = lower($1)
        RETURNING before.contact_phone`,
      [E2E_GUARDIAN_EMAIL, phone],
    );
    return rows[0]?.contact_phone ?? null;
  } finally {
    await db.end();
  }
}

test('a guardian with no mobile confirms it once, and goes on to their home', async ({ page }) => {
  const was = await setPhone(null);
  try {
    await page.goto('/app', { waitUntil: 'load' });
    await expect(page.getByRole('heading', { level: 1, name: /confirmar os seus dados|confirm your details/i })).toBeVisible();

    // Only the mobile is missing, and it has the focus; the name is prefilled.
    const mobile = page.getByLabel(/telemóvel|mobile/i);
    await expect(mobile).toBeFocused();
    await expect(page.getByLabel(/^(nome|first name)/i)).not.toHaveValue('');
    // A staff member's fields are not asked of a family.
    await expect(page.getByLabel(/^nif/i)).toHaveCount(0);

    // The children are the office's: listed, never editable.
    const children = page.getByRole('region', { name: /os seus educandos|your children/i });
    if ((await children.count()) > 0) {
      await expect(children.getByRole('textbox')).toHaveCount(0);
    }

    await mobile.pressSequentially('912 345 678');
    await page.getByRole('button', { name: /^(confirmar|confirm)$/i }).click();
    await expect(page.getByRole('heading', { level: 1, name: /confirmar os seus dados|confirm your details/i })).toHaveCount(0);

    // Shown once: the next page is the home, not the gate.
    await page.goto('/app', { waitUntil: 'load' });
    await expect(page).toHaveURL(/\/app\/familia/);
  } finally {
    await setPhone(was);
  }
});
