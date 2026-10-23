import { expect, test, type Locator, type Page } from '@playwright/test';
import { E2E_EMAIL, E2E_PASSWORD, NO_TEST_USER, PHONE_SESSION } from './session';
import {
  advancementFixture,
  AVAILABLE,
  NO_SEAT_STUDENT,
  QUEUE_STUDENT,
  SAME_INSTRUCTOR,
  SAME_SLOT,
} from './advancement-fixture';

/**
 * The advancement queue picks its turma in `TurmaPicker` — POOLSE-113, QA 1 and
 * 3 in the browser (confirming, a seat gone and an applied proposal are proved
 * through the API in `advancement-by-age.integration.test.ts`; the phone in
 * `phone-tier2.spec.ts`).
 */

test.skip(E2E_EMAIL === undefined || E2E_PASSWORD === undefined, NO_TEST_USER);
test.use({ storageState: PHONE_SESSION, viewport: { width: 1280, height: 900 } });
test.setTimeout(90_000);

test.beforeAll(async () => {
  await advancementFixture(E2E_EMAIL!);
});

async function card(page: Page, student: string): Promise<Locator> {
  await page.goto('/dashboard/students/advancement', { waitUntil: 'load' });
  await page.locator('main').first().waitFor();
  const found = page.locator('main li').filter({ has: page.getByRole('link', { name: student }) }).first();
  await expect(found).toBeVisible();
  return found;
}

test('QA 1 — the candidates are grouped by why they rank, in rank order, and picking one says it back', async ({ page }) => {
  const queued = await card(page, QUEUE_STUDENT);
  const list = queued.getByRole('listbox');
  const headings = list.getByRole('group');
  await expect(headings).toHaveCount(3);
  await expect(headings.nth(0)).toContainText(/mesmo dia e hora|same day and time/i);
  await expect(headings.nth(0)).toContainText(SAME_SLOT);
  await expect(headings.nth(1)).toContainText(/mesmo instrutor|same instructor/i);
  await expect(headings.nth(1)).toContainText(SAME_INSTRUCTOR);
  await expect(headings.nth(2)).toContainText(/com vaga|has a place/i);
  await expect(headings.nth(2)).toContainText(AVAILABLE);
  // A row reads as everywhere else: its slot and how full it is.
  await expect(headings.nth(0)).toContainText(/17:00/);
  await expect(headings.nth(0)).toContainText(/0 \/ 8/);
  // One Confirmar per card, not one per turma.
  await expect(queued.getByRole('button', { name: /^confirmar$|^confirm$/i })).toHaveCount(1);

  await list.getByRole('option', { name: new RegExp(SAME_SLOT) }).click();
  // Said back as one line with a way to change it (and once to a screen reader).
  await expect(queued.getByRole('button', { name: new RegExp(SAME_SLOT) })).toBeVisible();
  await expect(queued.getByRole('listbox')).toHaveCount(0);
});

test('QA 3 — ready with no seat: the sentence, and no picker', async ({ page }) => {
  const waiting = await card(page, NO_SEAT_STUDENT);
  await expect(waiting.getByText(/pronto a avançar, sem vaga|ready to advance, no seat/i)).toBeVisible();
  await expect(waiting.getByRole('listbox')).toHaveCount(0);
  await expect(waiting.getByRole('button', { name: /^confirmar$|^confirm$/i })).toHaveCount(0);
});
