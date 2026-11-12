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

  await page.getByRole('button', { name: /ler o ficheiro|read the file/i }).click();
  const status = page.getByLabel('Status', { exact: true });
  await expect(status).toBeVisible({ timeout: 30_000 });

  // The mapping dropdowns are list pickers (12-11-2026): click, then the option.
  const choose = async (control: typeof status, name: string | RegExp): Promise<void> => {
    await control.click();
    await page.getByRole('listbox').getByRole('option', { name, exact: typeof name === 'string' }).click();
  };
  const SKIP = /^(Não importar|Do not import|Don't import)$/i;

  // Whatever the matcher guessed, Não importar must stay chosen.
  await choose(status, SKIP);
  await expect(status).toHaveText(SKIP);

  // A real field, then Não importar again: both stick.
  await status.click();
  const labels = await page.getByRole('listbox').getByRole('option').allTextContents();
  await page.keyboard.press('Escape');
  const other = labels.map((label) => label.trim()).find((label) => !SKIP.test(label))!;
  await choose(status, other);
  await expect(status).toHaveText(other);
  await choose(status, SKIP);
  await expect(status).toHaveText(SKIP);

  // The full grid is the same choice seen by field: nothing feeds the field any more.
  await page.getByRole('button', { name: /ver e alterar todas as colunas|see and change every column/i }).click();
  const byField = page.getByRole('combobox', { name: other, exact: true });
  await expect(byField).toHaveText(/não importar|not imported/i);
});
