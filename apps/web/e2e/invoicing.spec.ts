import { expect, test, type Page } from '@playwright/test';
import { E2E_EMAIL, E2E_PASSWORD, NO_TEST_USER, PHONE_SESSION } from './session';
import { owedDocuments, OWED_PAYERS, type OwedDocuments } from './invoicing-fixture';

/**
 * Faturação — POOLSE-104, QA 1–4, on a desk.
 *
 * A document's Voltar goes back to the view it came from; the numbering books
 * live on the site's Dados do clube tab; the logo heads Fotografias and prints
 * on the document; and Em dívida's header checkbox selects the overdue rows and
 * nothing else. The phone half of D is in `phone-views.spec.ts`.
 */

test.skip(E2E_EMAIL === undefined || E2E_PASSWORD === undefined, NO_TEST_USER);
test.use({ storageState: PHONE_SESSION, viewport: { width: 1280, height: 900 } });
test.setTimeout(90_000);

const BACK = /^voltar à faturação$|^back to invoicing$/i;
const TICK_ALL = /selecionar todos em atraso|select all overdue/i;
const OPEN_DIALOG = /enviar lembrete por email|send a reminder by email/i;
/** A 1×1 PNG: an image by its first bytes, which is how the upload judges it. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

let owed: OwedDocuments;

test.beforeAll(async () => {
  owed = await owedDocuments(E2E_EMAIL!);
});

async function visit(page: Page, path: string): Promise<void> {
  try {
    await page.goto(path, { waitUntil: 'load' });
  } catch (error) {
    if (!String(error).includes('interrupted by another navigation')) throw error;
    await page.goto(path, { waitUntil: 'load' });
  }
  await page.locator('main').first().waitFor();
}

function row(page: Page, documentNo: string) {
  return page.locator('tbody tr', { has: page.getByRole('link', { name: documentNo, exact: true }) });
}

test('QA 1 — Voltar on a document returns to Em dívida, or to the month it was opened from', async ({ page }) => {
  const doc = owed.overdue[0]!;

  await visit(page, `/dashboard/faturacao?facilityId=${owed.facilityId}&view=owing`);
  await row(page, doc.documentNo).getByRole('link', { name: doc.documentNo, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: doc.documentNo })).toBeVisible();
  // One way back, the shell's — the page's own foot link is gone.
  await expect(page.getByRole('link', { name: BACK })).toHaveCount(1);
  await page.getByRole('link', { name: BACK }).click();
  await expect(page).toHaveURL(/view=owing/);
  await expect(page.getByRole('heading', { name: /em dívida|outstanding/i }).first()).toBeVisible();

  await visit(page, `/dashboard/faturacao?facilityId=${owed.facilityId}&month=2026-09`);
  await page.getByRole('link', { name: doc.documentNo, exact: true }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: doc.documentNo })).toBeVisible();
  await page.getByRole('link', { name: BACK }).click();
  await expect(page).toHaveURL(/month=2026-09/);
  await expect(page).not.toHaveURL(/view=owing/);
});

test('QA 2 — no Configuração on Faturação; the books are on Dados do clube and still save', async ({ page }) => {
  await visit(page, `/dashboard/faturacao?facilityId=${owed.facilityId}`);
  const pills = page.getByRole('navigation', { name: /vistas|views/i });
  await expect(pills.getByRole('link')).toHaveText([/este mês|this month/i, /em dívida|outstanding/i]);

  // An old bookmark lands on the month.
  await visit(page, `/dashboard/faturacao?facilityId=${owed.facilityId}&view=settings`);
  await expect(pills.getByRole('link', { name: /este mês|this month/i })).toHaveAttribute('aria-current', /.+/);
  await expect(page.getByRole('heading', { name: /livros de numeração|numbering books/i })).toHaveCount(0);

  // The signpost line leads to the tab.
  await page.getByRole('link', { name: /abrir os dados do clube|open the club details/i }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/facilities/${owed.facilityId}\\?.*tab=club`));
  const books = page.locator('section', {
    has: page.getByRole('heading', { name: /livros de numeração|numbering books/i }),
  });
  await expect(books).toBeVisible();
  // Under Como pagar.
  const payment = page.getByRole('heading', { name: /^como pagar$|^how to pay$/i }).first();
  expect((await payment.boundingBox())!.y).toBeLessThan((await books.boundingBox())!.y);

  // Rename the invoice book and put it back.
  const first = books.locator('li').first();
  const original = (await first.locator('span.font-medium').first().textContent())!.trim();
  for (const name of [`${original} E2E`, original]) {
    await first.getByRole('button', { name: /editar livro|edit book/i }).click();
    const field = first.getByLabel(/^nome$|^name$/i);
    await field.fill(name);
    await first.getByRole('button', { name: /^guardar$|^save$/i }).click();
    await expect(first.locator('span.font-medium').first()).toHaveText(name);
  }
});

test('QA 3 — the logo heads Fotografias, above the site photographs, and prints on the document', async ({ page }) => {
  await page.addInitScript(() => {
    window.print = () => undefined;
  });

  await visit(page, `/dashboard/facilities/${owed.facilityId}?tab=club`);
  await expect(page.getByRole('heading', { name: /logótipo do clube|club logo/i })).toHaveCount(0);

  await visit(page, `/dashboard/facilities/${owed.facilityId}?tab=photos`);
  const logo = page.getByRole('heading', { name: /logótipo do clube|club logo/i });
  const photos = page.getByRole('heading', { name: /fotografias da instalação|facility photographs/i });
  await expect(logo).toBeVisible();
  await expect(photos).toBeVisible();
  expect((await logo.boundingBox())!.y).toBeLessThan((await photos.boundingBox())!.y);

  const logoCard = page.locator('section', { has: logo });
  const remove = logoCard.getByRole('button', { name: /retirar logótipo|remove logo/i });
  const hadOne = (await remove.count()) > 0;
  if (!hadOne) {
    await logoCard.locator('input[type=file]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
    await expect(remove).toBeVisible({ timeout: 20_000 });
  }

  await visit(page, `/dashboard/faturacao/${owed.overdue[0]!.id}/print?facilityId=${owed.facilityId}`);
  await expect(page.getByRole('img', { name: /logótipo do clube|club logo/i })).toBeVisible();

  // A logo this test added is taken away again.
  if (!hadOne) {
    await visit(page, `/dashboard/facilities/${owed.facilityId}?tab=photos`);
    await remove.click();
    const confirm = page.getByRole('dialog').getByRole('button', { name: /retirar|remove/i });
    if ((await confirm.count()) > 0) await confirm.first().click();
    await expect(logoCard.getByRole('button', { name: /carregar logótipo|upload logo/i })).toBeVisible({ timeout: 20_000 });
  }
});

test('QA 4 — select all ticks the 3 overdue and not the 2 open; again unticks; the dialog lists 3 families', async ({ page }) => {
  await visit(page, `/dashboard/faturacao?facilityId=${owed.facilityId}&view=owing`);
  const all = page.getByRole('checkbox', { name: TICK_ALL });
  await expect(all).toBeVisible();
  const box = (documentNo: string) => row(page, documentNo).getByRole('checkbox');

  await all.check();
  for (const doc of owed.overdue) await expect(box(doc.documentNo)).toBeChecked();
  for (const doc of owed.open) await expect(box(doc.documentNo)).not.toBeChecked();
  await expect(page.getByRole('button', { name: OPEN_DIALOG })).toContainText('3');

  await all.uncheck();
  for (const doc of [...owed.overdue, ...owed.open]) await expect(box(doc.documentNo)).not.toBeChecked();

  // One row by hand: the header is indeterminate, and a click then ticks the rest.
  await box(owed.overdue[1]!.documentNo).check();
  expect(await all.evaluate((el) => (el as HTMLInputElement).indeterminate)).toBe(true);
  await all.click();
  for (const doc of owed.overdue) await expect(box(doc.documentNo)).toBeChecked();
  expect(await all.evaluate((el) => (el as HTMLInputElement).indeterminate)).toBe(false);

  await page.getByRole('button', { name: OPEN_DIALOG }).click();
  const dialog = page.getByRole('dialog');
  for (const payer of OWED_PAYERS.slice(0, 3)) await expect(dialog.getByText(payer).first()).toBeVisible();
  for (const payer of OWED_PAYERS.slice(3)) await expect(dialog.getByText(payer)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
