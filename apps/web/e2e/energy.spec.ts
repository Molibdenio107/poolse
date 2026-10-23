import { expect, test, type Page } from '@playwright/test';
import { E2E_EMAIL, E2E_PASSWORD, NO_TEST_USER, PHONE_SESSION } from './session';
import { energyFixture, STALE_METER, type EnergyFixture } from './energy-fixture';

/**
 * Energia — POOLSE-106, QA 1–5 in a browser.
 *
 * The club-wide dashboard, the missing bill and its link, the *Importar fatura*
 * card that folds and is remembered, a dropped PDF opening it, and the form
 * saying automatic reading is off — which it is on every development machine,
 * so QA 4's preview of a read bill is not reachable here and QA 5 is.
 * QA 6 (maintenance, no euros) is asserted on the API, where the euros are
 * withheld: there is no maintenance test login.
 */

test.skip(E2E_EMAIL === undefined || E2E_PASSWORD === undefined, NO_TEST_USER);
test.use({ storageState: PHONE_SESSION, viewport: { width: 1280, height: 900 } });
test.setTimeout(90_000);

const CARD = /importar fatura — pdf ou valores à mão|import a bill — pdf or values by hand/i;

let fixture: EnergyFixture;
test.beforeAll(async () => {
  fixture = await energyFixture(E2E_EMAIL!);
});

async function visit(page: Page, path = '/dashboard/energy'): Promise<void> {
  try {
    await page.goto(path, { waitUntil: 'load' });
  } catch (error) {
    if (!String(error).includes('interrupted by another navigation')) throw error;
    await page.goto(path, { waitUntil: 'load' });
  }
  await page.locator('main').first().waitFor();
}

function card(page: Page) {
  return page.locator('details#importar');
}

async function isOpen(page: Page): Promise<boolean> {
  return card(page).evaluate((el) => (el as HTMLDetailsElement).open);
}

test('QA 1 — the dashboard shows this month, twelve months, cost per lesson hour and per swimmer, and the chart', async ({ page }) => {
  await visit(page);
  const dashboard = page.getByRole('region', { name: /custos de funcionamento|running costs/i });
  await expect(dashboard).toBeVisible();
  for (const heading of [/^este mês|^this month/i, /últimos 12 meses|last 12 months/i, /custo por hora de aula|cost per lesson hour/i, /custo por nadador|cost per swimmer/i]) {
    await expect(dashboard.getByRole('heading', { name: heading })).toBeVisible();
  }
  // A year of electricity and gas, in euros, with a named legend.
  await expect(dashboard.locator('figure li', { hasText: /eletricidade|electricity/i })).toBeVisible();
  await expect(dashboard.locator('figure li', { hasText: /^gás$|^gas$/i })).toBeVisible();
  const months = dashboard.locator('figure [tabindex="0"]');
  await expect(months).toHaveCount(12);

  // A month's figures on keyboard focus, not on hover alone.
  await months.nth(10).focus();
  await expect(months.nth(10).locator('[role=presentation]')).toBeVisible();

  // And as a table, one click away.
  await dashboard.getByText(/ver os valores em tabela|show the figures as a table/i).click();
  await expect(dashboard.locator('figure table tbody tr')).toHaveCount(12);
});

test('QA 2 — a supply with no bill for 50 days is listed, and its link opens the import card on it', async ({ page }) => {
  await visit(page);
  const notice = page.getByRole('status').filter({ hasText: /sem fatura há mais de 45 dias|no bill for more than 45 days/i });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(STALE_METER);
  await notice.getByRole('link', { name: /importar fatura|import a bill/i }).click();
  await expect(page).toHaveURL(new RegExp(`import=${fixture.staleMeterId}`));
  await expect.poll(() => isOpen(page)).toBe(true);
});

test('QA 3 — the card opens on a click, closes on the next, and a reload remembers it', async ({ page }) => {
  await visit(page);
  await page.evaluate(() => window.localStorage.removeItem('poolse.energy.importOpen'));
  await visit(page);
  expect(await isOpen(page)).toBe(false);

  const summary = page.getByText(CARD);
  await summary.click();
  await expect.poll(() => isOpen(page)).toBe(true);
  await summary.click();
  await expect.poll(() => isOpen(page)).toBe(false);

  await summary.click();
  await expect.poll(() => isOpen(page)).toBe(true);
  await visit(page);
  await expect.poll(() => isOpen(page)).toBe(true);

  await page.getByText(CARD).click();
  await expect.poll(() => isOpen(page)).toBe(false);
  await visit(page);
  await expect.poll(() => isOpen(page)).toBe(false);
});

test('QA 4 and 5 — a PDF dropped on the page opens the card; with reading off it says so and the form can be typed', async ({ page }) => {
  await visit(page);
  await page.evaluate(() => window.localStorage.setItem('poolse.energy.importOpen', 'closed'));
  await visit(page);
  expect(await isOpen(page)).toBe(false);

  // Drop a PDF on the page body.
  await page.waitForFunction(() => document.readyState === 'complete');
  await expect(async () => {
    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['%PDF-1.4\n'], 'fatura.pdf', { type: 'application/pdf' }));
      for (const type of ['dragenter', 'dragover', 'drop']) {
        window.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }));
      }
    });
    expect(await isOpen(page)).toBe(true);
  }).toPass({ timeout: 15_000 });

  // QA 5: automatic reading is off on this machine, and the card says so in words.
  const inCard = card(page);
  await expect(inCard.getByText(/a leitura automática de faturas não está ativa|automatic bill reading is not enabled/i).first()).toBeVisible();
  await inCard.getByRole('button', { name: /preencher à mão|type it in/i }).click();
  await expect(inCard.getByLabel(/^fornecedor|^supplier/i)).toBeVisible();
  await inCard.getByLabel(/^fornecedor|^supplier/i).fill('EDP Comercial');
  await expect(inCard.getByLabel(/^fornecedor|^supplier/i)).toHaveValue('EDP Comercial');
});

test('on a phone the page scrolls nothing sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await visit(page);
  await expect(page.getByRole('region', { name: /custos de funcionamento|running costs/i })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});
