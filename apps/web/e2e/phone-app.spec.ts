import { expect, test, type Page } from '@playwright/test';
import {
  E2E_EMAIL,
  E2E_GUARDIAN_EMAIL,
  E2E_GUARDIAN_PASSWORD,
  E2E_PASSWORD,
  GUARDIAN_SESSION,
  INSTRUCTOR_SESSION,
  NO_INSTRUCTOR,
  E2E_INSTRUCTOR_EMAIL,
  NO_GUARDIAN,
  NO_TEST_USER,
} from './session';
import { poolsideLesson, poolsideTomorrow, poolsideYesterday } from './poolside-fixture';

/**
 * App mode on a phone — POOLSE-90 slice 1, QA 1, 3 and the lesson page, as a
 * guardian of two of the poolside children (Ana and Bruno) and as the owner.
 * QA 4–6 (moved, closed, the water's age) are proved against the database in
 * `apps/api/src/app/agenda.integration.test.ts`; QA 2 (who has which homes) in
 * `src/lib/app-hats.test.ts`. Every app-mode screen is tier 1.
 */

test.skip(E2E_EMAIL === undefined || E2E_PASSWORD === undefined, NO_TEST_USER);
test.skip(E2E_GUARDIAN_EMAIL === undefined || E2E_GUARDIAN_PASSWORD === undefined, NO_GUARDIAN);

test.use({ viewport: { width: 360, height: 740 } });

async function visit(page: Page, path: string): Promise<void> {
  try {
    await page.goto(path, { waitUntil: 'load' });
  } catch (error) {
    if (!String(error).includes('interrupted by another navigation')) throw error;
    await page.goto(path, { waitUntil: 'load' });
  }
}

async function noSidewaysScroll(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
}

test.describe('as a guardian', () => {
  test.use({ storageState: GUARDIAN_SESSION });

  test('QA 1 — /app and /dashboard both land on the family agenda, with no backoffice menu', async ({ page }) => {
    await poolsideLesson();
    await visit(page, '/app');
    await expect(page).toHaveURL(/\/app\/familia$/);
    await expect(page.getByRole('heading', { level: 1, name: /^(agenda|schedule)$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /abrir o menu|open the menu/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /abrir o backoffice|open the backoffice/i })).toHaveCount(0);

    await visit(page, '/dashboard');
    await expect(page).toHaveURL(/\/app\/familia$/);
  });

  test('QA 3 — both children on one agenda, named; the filter narrows; a stranger is a 404', async ({ page }) => {
    const lesson = await poolsideLesson();
    await visit(page, '/app/familia');
    await noSidewaysScroll(page);

    const filter = page.getByRole('navigation', { name: /mostrar as aulas de|show the lessons of/i });
    await expect(filter.getByRole('link')).toHaveCount(3);
    const cards = page.locator(`a[href="/app/familia/aulas/${lesson.sessionId}"]`);
    await expect(cards).toHaveCount(2);
    await expect(cards.filter({ hasText: 'Ana Poolside' })).toHaveCount(1);
    await expect(cards.filter({ hasText: 'Bruno Poolside' })).toHaveCount(1);
    for (const link of await filter.getByRole('link').all()) {
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }

    await visit(page, `/app/familia?child=${lesson.studentIds[0]}`);
    await expect(page.locator(`a[href="/app/familia/aulas/${lesson.sessionId}"]`)).toHaveCount(1);

    // Carla is a poolside child too, but not this guardian's.
    const response = await page.goto(`/app/familia?child=${lesson.studentIds[2]}`);
    expect(response?.status()).toBe(404);
  });

  test("the lesson's page opens from the agenda, with the plan or a sentence saying there is none", async ({ page }) => {
    const lesson = await poolsideLesson();
    await visit(page, '/app/familia');
    const card = page.locator(`a[href="/app/familia/aulas/${lesson.sessionId}"]`).first();
    await expect(async () => {
      if (!page.url().includes('/aulas/')) await card.tap({ timeout: 5_000 });
      await expect(page).toHaveURL(/\/app\/familia\/aulas\//, { timeout: 10_000 });
    }).toPass({ timeout: 45_000 });
    await expect(page.getByRole('heading', { name: /plano da aula|lesson plan/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /voltar à agenda|back to the agenda/i })).toBeVisible();
    await noSidewaysScroll(page);
  });

  test('POOLSE-116 — yesterday from Últimas aulas: a face, a few words, sent one-handed', async ({ page }) => {
    const { sessionId } = await poolsideYesterday();
    await visit(page, '/app/familia');
    const recent = page.getByRole('heading', { name: /últimas aulas|recent lessons/i });
    await expect(recent).toBeVisible();
    const link = page.locator(`a[href="/app/familia/aulas/${sessionId}"]`).first();
    await expect(link).toContainText(/dar feedback|give feedback/i);
    await expect(async () => {
      if (!page.url().includes('/aulas/')) await link.tap({ timeout: 5_000 });
      await expect(page).toHaveURL(/\/app\/familia\/aulas\//, { timeout: 10_000 });
    }).toPass({ timeout: 45_000 });

    await expect(page.getByText(/como correu a aula\?|how did the lesson go\?/i)).toBeVisible();
    const good = page.locator('label').filter({ hasText: /^(bem|good)$/i });
    expect((await good.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await good.boundingBox())!.width).toBeGreaterThanOrEqual(44);
    await good.tap();
    await page.getByRole('textbox').fill('Gostou muito da aula.');
    await expect(page.getByText(/o professor e a secretaria vão ler isto|the instructor and the office will read this/i)).toBeVisible();
    const send = page.getByRole('button', { name: /^(enviar|send)$/i });
    await expect(send).toBeInViewport();
    await send.tap();
    await expect(page.getByText(/feedback enviado|feedback sent/i)).toBeVisible({ timeout: 15_000 });
    await noSidewaysScroll(page);

    await visit(page, '/app/familia');
    await expect(page.locator(`a[href="/app/familia/aulas/${sessionId}"]`).first()).toContainText(/^.*(bem|good)/i);
  });
});

test.describe('as a guardian, before a lesson', () => {
  test.use({ storageState: GUARDIAN_SESSION });

  test("POOLSE-90 QA 7 — Não vou for Ana on tomorrow's lesson, one tap, and the agenda says so", async ({ page }) => {
    const { sessionId } = await poolsideTomorrow();
    await visit(page, `/app/familia/aulas/${sessionId}`);
    // Two of hers are in the lesson, so each question names its child.
    const ana = page.locator('section').filter({ has: page.getByRole('heading', { name: /ana poolside/i }) }).filter({
      has: page.getByRole('button', { name: /^(não vou|i'm not coming)$/i }),
    });
    const notGoing = ana.getByRole('button', { name: /^(não vou|i'm not coming)$/i });
    expect((await notGoing.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await notGoing.tap();
    await expect(page.getByText(/avisado: não vem à aula|sent: not coming to the lesson/i)).toBeVisible({ timeout: 15_000 });
    await expect(notGoing).toHaveAttribute('aria-pressed', 'true');
    await noSidewaysScroll(page);

    await visit(page, '/app/familia');
    await expect(
      page.locator(`a[href="/app/familia/aulas/${sessionId}"]`).filter({ hasText: 'Ana Poolside' }),
    ).toContainText(/avisou que não vem|said they are not coming/i);
  });
});

test.describe('as an instructor', () => {
  test.skip(E2E_INSTRUCTOR_EMAIL === undefined, NO_INSTRUCTOR);
  test.use({ storageState: INSTRUCTOR_SESSION });

  test('POOLSE-90 QA 11 — /app is their lessons, and a lesson opens its register', async ({ page }) => {
    const { sessionId } = await poolsideTomorrow();
    await visit(page, '/app');
    await expect(page).toHaveURL(/\/app\/aulas$/);
    await expect(page.getByRole('heading', { level: 1, name: /^(as minhas aulas|my lessons)$/i })).toBeVisible();
    const lesson = page.locator(`a[href^="/dashboard/calendar/sessions/${sessionId}"]`);
    await expect(lesson).toContainText(/inscrit|enrolled/i);
    await noSidewaysScroll(page);
    await expect(async () => {
      if (!page.url().includes('/calendar/sessions/')) await lesson.tap({ timeout: 5_000 });
      await expect(page).toHaveURL(/\/calendar\/sessions\//, { timeout: 10_000 });
    }).toPass({ timeout: 45_000 });
    await expect(page.getByRole('link', { name: /voltar às minhas aulas|back to my lessons/i })).toBeVisible();
  });
});

test.describe('as the owner', () => {
  test('QA 1 — /app sends an owner to the backoffice', async ({ page }) => {
    await visit(page, '/app');
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
