import { expect, test, type Page } from '@playwright/test';
import { E2E_EMAIL, E2E_PASSWORD, NO_TEST_USER, PHONE_SESSION } from './session';
import { poolsideLesson } from './poolside-fixture';

/**
 * A student's *Semana* tab — POOLSE-108, QA 1–3.
 *
 * Stepping a week rewrote the address from the path alone, which dropped
 * `?tab=week` and `?from=`: a reload landed on *Geral* and Voltar forgot the
 * screen the page was opened from. Each scenario steps, then does the thing
 * that re-reads the address — a reload, Voltar — and asks where it is. Ana, the
 * poolside fixture's first swimmer, is the student; signed in as the E2E owner.
 */

test.skip(E2E_EMAIL === undefined || E2E_PASSWORD === undefined, NO_TEST_USER);
test.use({ storageState: PHONE_SESSION });
test.setTimeout(90_000);

const PREVIOUS = /^(semana anterior|previous week)$/i;
const NEXT = /^(semana seguinte|next week)$/i;

/** The Semana card: the section holding the stepper. */
function weekCard(page: Page) {
  return page.locator('section', { has: page.getByRole('button', { name: PREVIOUS }) });
}

function heading(page: Page) {
  return weekCard(page).locator('p').first();
}

/** One step, finished: the heading has moved and the buttons are back. */
async function step(page: Page, button: RegExp): Promise<void> {
  const before = await heading(page).textContent();
  await weekCard(page).getByRole('button', { name: button }).click();
  await expect(heading(page)).not.toHaveText(before ?? '', { timeout: 20_000 });
  await expect(weekCard(page).getByRole('button', { name: button })).toBeEnabled();
}

function mondayWeeksBack(weeks: number): string {
  // The club's day, as the page computes it, then back to its Monday.
  const day = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Lisbon' }));
  day.setHours(12, 0, 0, 0);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7) - 7 * weeks);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}

let studentId: string;

test.beforeAll(async () => {
  studentId = (await poolsideLesson()).studentIds[0]!;
});

test('QA 1 — two weeks back, reload, still on Semana two weeks back', async ({ page }) => {
  await page.goto(`/dashboard/students/${studentId}?tab=week`, { waitUntil: 'load' });
  // Wait for React to own the stepper before pressing it.
  await expect(weekCard(page).getByRole('button', { name: PREVIOUS })).toBeEnabled();
  await page.waitForFunction(() => document.readyState === 'complete');

  await step(page, PREVIOUS);
  await step(page, PREVIOUS);
  const twoBack = mondayWeeksBack(2);
  await expect(page).toHaveURL(new RegExp(`[?&]week=${twoBack}`));
  await expect(page).toHaveURL(/[?&]tab=week\b/);
  const shown = await heading(page).textContent();

  await page.reload({ waitUntil: 'load' });
  await expect(page).toHaveURL(/[?&]tab=week\b/);
  await expect(weekCard(page)).toBeVisible();
  await expect(heading(page)).toHaveText(shown ?? '');
});

test('QA 2 — from Turmas, a step, then Voltar lands on Turmas', async ({ page }) => {
  await page.goto(`/dashboard/students/${studentId}?tab=week&from=${encodeURIComponent('/dashboard/classes')}`, {
    waitUntil: 'load',
  });
  await expect(weekCard(page).getByRole('button', { name: NEXT })).toBeEnabled();
  await page.waitForFunction(() => document.readyState === 'complete');

  await step(page, NEXT);
  await expect(page).toHaveURL(/[?&]from=%2Fdashboard%2Fclasses/);
  await expect(page).toHaveURL(/[?&]tab=week\b/);

  await page.reload({ waitUntil: 'load' });
  const voltar = page.locator('main').getByRole('link', { name: /^(voltar|back)\b/i }).first();
  await expect(voltar).toHaveAttribute('href', /^\/dashboard\/classes(\?|$)/);
  // A click before hydration is replayed and never navigates; ask again until it does.
  await expect(async () => {
    if (!/\/dashboard\/classes/.test(page.url())) await voltar.click({ timeout: 2000 });
    await expect(page).toHaveURL(/\/dashboard\/classes(\?|$)/, { timeout: 5000 });
  }).toPass({ timeout: 40_000 });
});

test('QA 3 — the week and its days written out, in both languages', async ({ browser }) => {
  for (const [locale, range, monday] of [
    ['pt-PT', /^16 a 22 de novembro de 2026$/, /Segunda\s+16 de novembro/],
    // Chromium's ICU writes the dash with thin spaces (16 – 22); Node's writes none.
    ['en', /^16\s?–\s?22 November 2026$/, /Monday\s+16 November/],
  ] as const) {
    const context = await browser.newContext({ storageState: PHONE_SESSION });
    await context.addCookies([{ name: 'poolse-locale', value: locale, url: 'http://localhost:3000' }]);
    const page = await context.newPage();
    await page.goto(`/dashboard/students/${studentId}?tab=week&week=2026-11-16`, { waitUntil: 'load' });
    await expect(heading(page)).toHaveText(range);
    await expect(weekCard(page)).toContainText(monday);
    await context.close();
  }
});
