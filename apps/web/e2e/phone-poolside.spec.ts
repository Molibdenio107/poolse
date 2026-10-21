import { expect, test, type Page } from '@playwright/test';
import {
  E2E_EMAIL,
  E2E_INSTRUCTOR_EMAIL,
  E2E_INSTRUCTOR_PASSWORD,
  E2E_PASSWORD,
  INSTRUCTOR_SESSION,
  NO_INSTRUCTOR,
  NO_TEST_USER,
} from './session';
import {
  cancelBehindTheScreen,
  poolsideLesson,
  POOLSIDE_NAMES,
  POOLSIDE_STUDENTS,
  storedMarks,
} from './poolside-fixture';

/**
 * The poolside flows on a phone — POOLSE-88 slice 2, tier 1, on the `iphone`
 * (WebKit) and `android` (Chromium) projects.
 *
 * Flow 2 first: taking the register (QA 5, 6 and 9). Every test runs at 360px,
 * the narrowest phone the ticket names, because a register that fits a Pixel 7
 * can still scroll sideways on a small Android.
 */

test.skip(E2E_EMAIL === undefined || E2E_PASSWORD === undefined, NO_TEST_USER);
test.skip(E2E_INSTRUCTOR_EMAIL === undefined || E2E_INSTRUCTOR_PASSWORD === undefined, NO_INSTRUCTOR);

test.use({ viewport: { width: 360, height: 740 } });

async function openRegister(page: Page, sessionId: string): Promise<void> {
  await page.goto(`/dashboard/calendar/sessions/${sessionId}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /guardar presenças|save the register/i }).waitFor();
}

/** Student n's three states (from 1), by the name the fieldset's legend carries. */
function student(page: Page, n: number) {
  return page.getByRole('group', { name: new RegExp(`${POOLSIDE_NAMES[n - 1]} Poolside`) });
}

/**
 * Tap a control that a hydrating page may not yet answer — the same retry the
 * shell spec's menu needs. A radio's `checked` is the proof the tap landed.
 */
async function tapUntil(page: Page, tap: () => Promise<void>, landed: () => Promise<void>): Promise<void> {
  await expect(async () => {
    await tap();
    await landed();
  }).toPass({ timeout: 15_000 });
}

async function markAllPresent(page: Page): Promise<void> {
  await tapUntil(
    page,
    () => page.getByRole('button', { name: /^(todos presentes|all present)$/i }).tap(),
    () =>
      expect(page.getByText(new RegExp(`${POOLSIDE_STUDENTS} (de|of) ${POOLSIDE_STUDENTS}`))).toBeVisible({
        timeout: 1_000,
      }),
  );
}

/** Whether the bottom bar — the count and Save — is wholly on screen. */
async function actionsOnScreen(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>('[data-register-actions]');
    if (bar === null) return false;
    const box = bar.getBoundingClientRect();
    return box.top >= 0 && box.bottom <= window.innerHeight + 0.5 && box.height > 0;
  });
}

test.describe('the register, as the instructor', () => {
  test.use({ storageState: INSTRUCTOR_SESSION });

  test('QA 5 — fifteen students, no sideways scroll, the count and Save always in reach', async ({ page }) => {
    const lesson = await poolsideLesson();
    await openRegister(page, lesson.sessionId);

    // No sideways scroll at 360px — AC 4.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // Every state is a 44px target, and every row's three fit across the screen.
    const segments = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('fieldset label')).map((el) => {
        const box = el.getBoundingClientRect();
        return { height: box.height, right: box.right, text: el.textContent?.trim() ?? '' };
      }),
    );
    expect(segments).toHaveLength(POOLSIDE_STUDENTS * 3);
    for (const segment of segments) {
      expect(segment.height, segment.text).toBeGreaterThanOrEqual(44);
      expect(segment.right, segment.text).toBeLessThanOrEqual(360);
    }

    // The bar is on screen at the top of the list and still there at the bottom.
    expect(await actionsOnScreen(page)).toBe(true);
    await student(page, POOLSIDE_STUDENTS).scrollIntoViewIfNeeded();
    expect(await actionsOnScreen(page)).toBe(true);

    // Everyone came except number 3.
    await markAllPresent(page);
    const absent = student(page, 3).getByRole('radio', { name: /^(faltou|absent)$/i });
    await tapUntil(
      page,
      () => student(page, 3).getByText(/^(faltou|absent)$/i).tap(),
      () => expect(absent).toBeChecked({ timeout: 1_000 }),
    );

    await page.getByRole('button', { name: /guardar presenças|save the register/i }).tap();
    await expect(page.getByRole('status').filter({ hasText: /guardad|saved/i })).toBeVisible();

    const marks = await storedMarks(lesson.sessionId);
    expect(Object.keys(marks)).toHaveLength(POOLSIDE_STUDENTS);
    expect(marks[lesson.studentIds[2]!]).toBe('absent');
    expect(Object.values(marks).filter((status) => status === 'present')).toHaveLength(POOLSIDE_STUDENTS - 1);

    // Reopened, it shows what was marked.
    await openRegister(page, lesson.sessionId);
    await expect(student(page, 3).getByRole('radio', { name: /^(faltou|absent)$/i })).toBeChecked();
    await expect(student(page, 1).getByRole('radio', { name: /^(presente|present)$/i })).toBeChecked();
  });

  test('QA 6 — a refused save keeps every mark and says why in a toast', async ({ page }) => {
    const lesson = await poolsideLesson();
    await openRegister(page, lesson.sessionId);
    await markAllPresent(page);

    // The office cancels the lesson while the instructor is marking it.
    await cancelBehindTheScreen(lesson.sessionId);
    await page.getByRole('button', { name: /guardar presenças|save the register/i }).tap();

    await expect(page.getByRole('alert').filter({ hasText: /cancelada|cancelled/i })).toBeVisible();
    // FormResetGuard on touch: React's reset after the action must not untick them.
    await expect(page.getByText(new RegExp(`${POOLSIDE_STUDENTS} (de|of) ${POOLSIDE_STUDENTS}`))).toBeVisible();
    for (const n of [1, 8, POOLSIDE_STUDENTS]) {
      await expect(student(page, n).getByRole('radio', { name: /^(presente|present)$/i })).toBeChecked();
    }
    expect(await storedMarks(lesson.sessionId)).toEqual({});
  });
});

test.describe('the register, as the owner', () => {
  test('an owner marks a class they do not teach the same way', async ({ page }) => {
    const lesson = await poolsideLesson();
    await openRegister(page, lesson.sessionId);
    await markAllPresent(page);
    await page.getByRole('button', { name: /guardar presenças|save the register/i }).tap();
    await expect(page.getByRole('status').filter({ hasText: /guardad|saved/i })).toBeVisible();
    expect(Object.values(await storedMarks(lesson.sessionId))).toHaveLength(POOLSIDE_STUDENTS);
  });
});
