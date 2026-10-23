import { expect, test, type Page } from '@playwright/test';
import { E2E_EMAIL, E2E_PASSWORD, NO_TEST_USER } from './session';
import { poolsideLesson } from './poolside-fixture';

/**
 * A tank's water tab — POOLSE-101, QA 1, 3 and 4, on a phone and at desk width.
 *
 * Registar leitura holds only the club's own form; Laboratório holds the
 * results, *Registar um resultado* and the report import; the import button is
 * as wide as its words, in both themes. A spreadsheet of the club's readings
 * previews as going to the readings (QA 3). A laboratory report's path needs
 * the model, which no development machine has switched on: it is proved by
 * `lab-import.integration.test.ts` and `water-import-routing.test.ts` instead.
 */

test.skip(E2E_EMAIL === undefined || E2E_PASSWORD === undefined, NO_TEST_USER);
test.setTimeout(90_000);

const IMPORT = /^importar relatório$|^import report$/i;
const PHONE = { width: 390, height: 844 };
const DESK = { width: 1280, height: 900 };

let poolId: string;
test.beforeAll(async () => {
  poolId = (await poolsideLesson()).poolId;
});

async function visit(page: Page, section: string): Promise<void> {
  const path = `/dashboard/facilities/pools/${poolId}?tab=water&section=${section}`;
  try {
    await page.goto(path, { waitUntil: 'load' });
  } catch (error) {
    if (!String(error).includes('interrupted by another navigation')) throw error;
    await page.goto(path, { waitUntil: 'load' });
  }
  await page.locator('main').first().waitFor();
}

async function sections(page: Page): Promise<void> {
  // The one-line explainer sits above the pills.
  await visit(page, 'record');
  await expect(
    page.getByText(/leituras próprias todos os dias|your own readings every day/i),
  ).toBeVisible();
  const pills = page.getByRole('navigation', { name: /secções da qualidade da água|water quality sections/i });
  await expect(pills.getByRole('link', { name: /^registar leitura$|^record reading$/i })).toBeVisible();
  await expect(pills.getByRole('link', { name: /^laboratório|^laboratory/i })).toBeVisible();

  // Registar leitura: the club's own form, and no import.
  await expect(page.getByText(/registar uma leitura própria|record your own reading/i)).toBeVisible();
  await expect(page.getByText(/feitas pelo clube|the club does itself/i)).toBeVisible();
  await expect(page.getByRole('button', { name: IMPORT })).toHaveCount(0);

  // Laboratório: the results, Registar um resultado, and the import.
  await visit(page, 'lab');
  await expect(page.getByText(/laboratório acreditado|accredited laboratory/i)).toBeVisible();
  await expect(page.getByText(/^registar um resultado$|^record a result$/i)).toBeVisible();
  await expect(page.getByRole('button', { name: IMPORT })).toBeVisible();
}

/** The import button is as wide as its words, not as wide as the card. */
async function contentWidth(page: Page): Promise<void> {
  await visit(page, 'lab');
  for (const dark of [false, true]) {
    await page.evaluate((on) => document.documentElement.classList.toggle('dark', on), dark);
    const button = page.getByRole('button', { name: IMPORT });
    const [mine, room] = await button.evaluate((el) => [
      el.getBoundingClientRect().width,
      (el.parentElement as HTMLElement).getBoundingClientRect().width,
    ]);
    expect(mine, `button ${mine}px in a ${room}px column (${dark ? 'dark' : 'light'})`).toBeLessThan(room - 24);
  }
}

test.describe('on a phone', () => {
  test.use({ viewport: PHONE });

  test('QA 1 — Registar leitura is the form alone; Laboratório has the results and the import', async ({ page }) => {
    await sections(page);
  });

  test('QA 4 — the import button is content-width, light and dark', async ({ page }) => {
    await contentWidth(page);
  });
});

test.describe('at desk width', () => {
  test.use({ viewport: DESK });

  test('QA 1 — the same sections', async ({ page }) => {
    await sections(page);
  });

  test('QA 4 — the import button is content-width, light and dark', async ({ page }) => {
    await contentWidth(page);
  });

  test('QA 3 — the club\'s own readings log previews as going to the readings', async ({ page }) => {
    await visit(page, 'lab');
    await page.getByRole('button', { name: IMPORT }).click();
    await page.locator('input[type=file][name=file]').setInputFiles({
      name: 'leituras.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('Data;pH;Cloro livre\n01-10-2026;7,4;1,2\n02-10-2026;7,2;1,0\n'),
    });
    const dialog = page.getByRole('dialog');
    // The dialog carries the whole name.
    await expect(dialog.getByText(/importar um relatório do laboratório|import a laboratory report/i).first()).toBeVisible();
    await dialog.getByRole('button', { name: /verificar o ficheiro|check the file/i }).click();
    await expect(dialog.getByRole('columnheader', { name: /vai para|goes to/i })).toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByRole('cell', { name: /^leituras próprias$|^own readings$/i })).toHaveCount(2);
    await expect(dialog.getByText(/resultados do laboratório: 0|laboratory results: 0/i)).toBeVisible();
    // Nothing is written by a preview; leave without importing.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});
