import { expect, test } from '@playwright/test';
import { INSTRUCTOR_SESSION, MAINTENANCE_SESSION, PHONE_SESSION } from './session';

/**
 * *Custos*, in a browser — POOLSE-183. The figures are proved against the API
 * (`cost-overview.test.ts`, `costs.integration.test.ts`); what only a browser can
 * answer is who reaches the page, whether the palette finds it, and whether the
 * file a person downloads says what the screen says.
 */

const COSTS = '/dashboard/faturacao/custos';
const flat = (text: string): string => text.replace(/\s+/g, ' ').trim();

test.describe('the office', () => {
  test.use({ storageState: PHONE_SESSION });

  test('QA 1 — the rulers change the window, and the same page reads either way', async ({ page }) => {
    await page.goto(COSTS, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: /^(custos|costs)$/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /^(ano civil|civil year)$/i })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText(/^(faturado|invoiced)$/i)).toBeVisible();
    await expect(page.getByText(/^(estimado|estimated)$/i)).toBeVisible();
    await expect(page.getByText(/^total \((faturado \+ estimado|invoiced \+ estimated)\)$/i).first()).toBeVisible();
    await expect(page.getByText(/início do ano civil|start of the civil year/i)).toBeVisible();

    await page.getByRole('link', { name: /^(com iva|with vat)$/i }).click();
    await expect(page).toHaveURL(/vat=1/);
    await expect(page.getByText(/com iva\.|with vat\./i)).toBeVisible();
  });

  test('QA 5 — Ctrl+K finds Custos', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await expect(async () => {
      await page.keyboard.press('Control+k');
      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await page.keyboard.type('Custos');
    await expect(page.getByRole('dialog').getByText(/^(custos|costs)$/i).first()).toBeVisible();
  });

  test('QA 7 — the CSV totals are the tiles, to the cent', async ({ page }) => {
    await page.goto(COSTS, { waitUntil: 'domcontentloaded' });
    const total = page
      .getByText(/^total \((faturado \+ estimado|invoiced \+ estimated)\)$/i)
      .first()
      .locator('..');
    const shown = flat(await total.locator('span').nth(1).innerText());

    const response = await page.request.get(`${COSTS}/export?ruler=civil`);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/csv');
    const lines = (await response.text()).trim().split(/\r?\n/);
    const last = lines.at(-1)!.split(/[;,](?=(?:[^"]*"[^"]*")*[^"]*$)/).map((cell) => cell.replace(/^"|"$/g, ''));
    expect(flat(last.at(-1)!)).toBe(shown);
  });
});

for (const [role, session] of [
  ['an instructor', INSTRUCTOR_SESSION],
  ['maintenance', MAINTENANCE_SESSION],
] as const) {
  test.describe(role, () => {
    test.use({ storageState: session });

    test(`QA 4 — ${role} gets no menu entry, no figure and no file`, async ({ page }) => {
      await page.goto(COSTS, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('main')).toBeVisible();
      await expect(page.getByRole('link', { name: /^(custos|costs)$/i })).toHaveCount(0);
      await expect(page.getByText(/\d\s?€/)).toHaveCount(0);
      const file = await page.request.get(`${COSTS}/export?ruler=civil`);
      expect(file.status()).toBe(403);
    });
  });
}
