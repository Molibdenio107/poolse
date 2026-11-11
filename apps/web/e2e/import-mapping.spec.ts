import { expect, test } from '@playwright/test';
import { E2E_EMAIL, E2E_PASSWORD, NO_TEST_USER, PHONE_SESSION } from './session';

/**
 * Column mapping in the student import — Rui, 11-11-2026.
 *
 * Choosing *Não importar* for a column the matcher had guessed (Status → Estado
 * civil) changed nothing: the wizard asked for "no field, no column", the
 * mapping kept the old field on that column, and the dropdown snapped back.
 * Every column-by-column importer had the same call. This drives the real page:
 * the choice sticks, the full grid agrees, and choosing another field and then
 * Não importar again still sticks. Nothing is imported — the spec stops before
 * Verificar.
 */

test.skip(E2E_EMAIL === undefined || E2E_PASSWORD === undefined, NO_TEST_USER);
test.use({ storageState: PHONE_SESSION });
test.setTimeout(90_000);

const CSV = [
  'First name,Last name,Birth date,ID,Age,Country,Status',
  'Ana,Costa,2015-03-04,1,11,Portugal,Active',
  'Bruno,Dias,2014-07-21,2,12,Portugal,Inactive',
].join('\n');

test('Não importar sticks on a column the matcher guessed, and the full grid agrees', async ({ page }) => {
  await page.goto('/dashboard/students/import');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'random_people.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(CSV, 'utf8'),
  });

  const status = page.getByLabel('Status', { exact: true });
  await expect(status).toBeVisible({ timeout: 30_000 });

  // Whatever the matcher guessed, Não importar must stay chosen.
  await status.selectOption('');
  await expect(status).toHaveValue('');

  // A real field, then Não importar again: both stick.
  const fields = await status.locator('option').evaluateAll((options) =>
    options.map((option) => (option as HTMLOptionElement).value).filter((value) => value !== ''),
  );
  const other = fields.find((value) => value === 'maritalStatus') ?? fields[0]!;
  await status.selectOption(other);
  await expect(status).toHaveValue(other);
  await status.selectOption('');
  await expect(status).toHaveValue('');

  // The full grid is the same choice seen by field: nothing feeds the field any more.
  await page.getByRole('button', { name: /ver e alterar todas as colunas|see and change every column/i }).click();
  const byField = page.locator(`#map-${other}`);
  await expect(byField).toHaveValue('');
});
