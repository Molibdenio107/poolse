import { expect, test, type Locator, type Page } from '@playwright/test';
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
  POOLSIDE_GUARDIAN_PHONE,
  POOLSIDE_NAMES,
  POOLSIDE_STUDENTS,
  storedMarks,
} from './poolside-fixture';

/**
 * The poolside flows on a phone — POOLSE-88 slice 2, tier 1, on the `iphone`
 * (WebKit) and `android` (Chromium) projects.
 *
 * Every tier-1 flow the two test users can reach: the week (1), the register
 * (2, QA 5 and 6), the plan (3), cancelling and the stand-in (4), finding a
 * student and ringing home (5, QA 7), the keyboards (QA 8) and a fee paid (9).
 * Incidents, water readings and messages are pages of ordinary fields, held to
 * the shell's sizes by `phone-shell.spec.ts`. Every test runs at 360px,
 * the narrowest phone the ticket names, because a register that fits a Pixel 7
 * can still scroll sideways on a small Android.
 */

test.skip(E2E_EMAIL === undefined || E2E_PASSWORD === undefined, NO_TEST_USER);
test.skip(E2E_INSTRUCTOR_EMAIL === undefined || E2E_INSTRUCTOR_PASSWORD === undefined, NO_INSTRUCTOR);

test.use({ viewport: { width: 360, height: 740 } });

/**
 * `page.goto`, once more if the dev server interrupts it. Next's dev server
 * full-reloads a route it compiles for the first time ("Fast Refresh had to
 * perform a full reload"), which lands on a cold run as "navigation interrupted
 * by another navigation" — to the same page. Never seen against a build.
 */
async function visit(page: Page, path: string, waitUntil: 'load' | 'domcontentloaded' = 'domcontentloaded'): Promise<void> {
  try {
    await page.goto(path, { waitUntil });
  } catch (error) {
    if (!String(error).includes('interrupted by another navigation')) throw error;
    await page.waitForLoadState('load');
    await page.goto(path, { waitUntil });
  }
}

async function openRegister(page: Page, sessionId: string): Promise<void> {
  await visit(page, `/dashboard/calendar/sessions/${sessionId}`, 'domcontentloaded');
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

/** The control a finger presses — every one of them 44px or taller. */
async function expectTouchSized(locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  expect(box, 'the control is on screen').not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
}

test.describe('the lesson, as the instructor', () => {
  test.use({ storageState: INSTRUCTOR_SESSION });

  test('flow 1 — a lesson in my week opens on its own page', async ({ page }) => {
    const lesson = await poolsideLesson();
    await visit(page, '/dashboard', 'domcontentloaded');
    const link = page.locator(`a[href^="/dashboard/calendar/sessions/${lesson.sessionId}"]`).first();
    await tapUntil(
      page,
      () => link.tap(),
      () => expect(page).toHaveURL(new RegExp(`/sessions/${lesson.sessionId}`), { timeout: 2_000 }),
    );
    await page.getByRole('button', { name: /guardar presenças|save the register/i }).waitFor();
  });

  test('flow 3 — the plan is written and read back on the lesson page', async ({ page }) => {
    const lesson = await poolsideLesson();
    await openRegister(page, lesson.sessionId);
    const stamp = `8 × 25 costas — ${Date.now()}`;

    const openPlan = page.getByRole('button', { name: /^(plano de treino|training plan)$/i });
    await expectTouchSized(openPlan);
    await tapUntil(
      page,
      () => openPlan.tap(),
      () => expect(page.getByRole('dialog')).toBeVisible({ timeout: 2_000 }),
    );

    // Full width on a phone: the sheet is the screen, not a box beside it.
    const sheet = await page.getByRole('dialog').boundingBox();
    expect(sheet!.width).toBeGreaterThanOrEqual(359);

    const box = page.getByRole('dialog').getByLabel(/plano desta aula|this lesson/i);
    await box.fill(stamp);
    const save = page.getByRole('dialog').getByRole('button', { name: /^(guardar|save)$/i });
    await expectTouchSized(save);
    // Wait for the save itself: navigating away mid-flight aborts the action.
    const saved = page.waitForResponse((response) => response.request().method() === 'POST');
    await save.tap();
    await saved;

    // Opened by the dashboard's own link, the sheet is up and the plan is there.
    // Re-read until it is: "Guardado por" was already on screen from a run before.
    await expect(async () => {
      await visit(page, `/dashboard/calendar/sessions/${lesson.sessionId}?plan=open`, 'load');
      await expect(page.getByRole('dialog').getByLabel(/plano desta aula|this lesson/i)).toHaveValue(stamp, {
        timeout: 3_000,
      });
    }).toPass({ timeout: 20_000 });
  });

  test('flow 4 — the instructor calls the lesson off, this week only, and takes it back', async ({ page }) => {
    const lesson = await poolsideLesson();
    await openRegister(page, lesson.sessionId);

    const cancel = page.getByRole('button', { name: /^(cancelar aula|cancel class)$/i });
    await expectTouchSized(cancel);
    await tapUntil(
      page,
      () => cancel.tap(),
      () => expect(page.getByRole('dialog')).toBeVisible({ timeout: 2_000 }),
    );
    // One lesson is the only answer an instructor has, so it is not asked.
    await expect(page.getByRole('dialog').getByRole('radio')).toHaveCount(0);
    const dialog = await page.getByRole('dialog').boundingBox();
    expect(dialog!.width).toBeGreaterThanOrEqual(359);

    await page.getByRole('dialog').getByRole('button', { name: /cancelar esta aula|cancel this class/i }).tap();
    await expect(page.getByText(/esta aula foi cancelada|this class was cancelled/i)).toBeVisible();

    // No Anular for an instructor: restoring is owner and admin by design
    // (round 5), so a toast offering it would offer a refusal.
    await expect(page.getByText(/aula cancelada|class cancelled/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^(anular|undo)$/i })).toHaveCount(0);
  });

  test('flow 5, QA 7 — a student is found by name and home is one tap away', async ({ page }) => {
    await poolsideLesson();
    await visit(page, '/dashboard/students?search=Ana%20Poolside', 'domcontentloaded');
    const ana = page.getByRole('link', { name: /^Ana Poolside$/ }).first();
    await tapUntil(
      page,
      () => ana.tap(),
      () => expect(page.getByRole('heading', { level: 1, name: /Ana Poolside/ })).toBeVisible({ timeout: 2_000 }),
    );

    const call = page.locator(`a[href="tel:${POOLSIDE_GUARDIAN_PHONE.replace(/\s/g, '')}"]`);
    await expect(call).toBeVisible();
    await expect(call).toContainText(POOLSIDE_GUARDIAN_PHONE);
    await expectTouchSized(call);
    // The seguro, in words on the record — an instructor has no Pagamentos tab.
    await expect(page.getByText(/sem seguro registado|no insurance on record/i)).toBeVisible();
  });
});

test.describe('the lesson, as the owner', () => {
  test('flow 4 — a stand-in is chosen on the lesson page', async ({ page }) => {
    const lesson = await poolsideLesson();
    await openRegister(page, lesson.sessionId);

    const picker = page.getByLabel(/professor desta aula|teacher for this lesson/i);
    await expect(picker).toBeEnabled();
    await expectTouchSized(picker);
    // Somebody free: a busy or absent candidate carries its reason after " · ",
    // and the server refuses the busy one as a clash, by design.
    const current = await picker.inputValue();
    const someone = await picker
      .locator('option:not([disabled])')
      .evaluateAll(
        (options, now) =>
          options
            .map((o) => o as HTMLOptionElement)
            .find((o) => o.value !== '' && o.value !== now && !o.text.includes(' · '))?.value,
        current,
      );
    expect(someone, 'the club has a free instructor to offer').toBeDefined();

    await picker.selectOption(someone!);
    await expect(picker).toBeEnabled();
    await expect(page.getByText(/não foi possível alterar o professor|já tem uma aula/i)).toHaveCount(0);
    await expect(async () => {
      await openRegister(page, lesson.sessionId);
      await expect(page.getByLabel(/professor desta aula|teacher for this lesson/i)).toHaveValue(someone!, {
        timeout: 2_000,
      });
    }).toPass({ timeout: 15_000 });
  });

  test('flow 4 — the owner calls the lesson off and puts it back from the toast', async ({ page }) => {
    const lesson = await poolsideLesson();
    await openRegister(page, lesson.sessionId);

    await tapUntil(
      page,
      () => page.getByRole('button', { name: /^(cancelar aula|cancel class)$/i }).tap(),
      () => expect(page.getByRole('dialog')).toBeVisible({ timeout: 2_000 }),
    );
    // Management is asked the scope; "this week" is already chosen.
    await expect(page.getByRole('dialog').getByRole('radio')).toHaveCount(2);
    await page.getByRole('dialog').getByRole('button', { name: /cancelar esta aula|cancel this class/i }).tap();
    await expect(page.getByText(/esta aula foi cancelada|this class was cancelled/i)).toBeVisible();

    // Anular, from the toast that outlived the redraw.
    await page.getByRole('button', { name: /^(anular|undo)$/i }).tap();
    await expect(page.getByRole('button', { name: /guardar presenças|save the register/i })).toBeVisible();
  });

  test('flow 9 — a mensalidade is marked paid and unmarked with one tap each', async ({ page }) => {
    const lesson = await poolsideLesson();
    await visit(page, `/dashboard/students/${lesson.studentIds[0]}?tab=fees`, 'domcontentloaded');

    const paid = page.getByRole('checkbox').first();
    await expectTouchSized(paid);
    const before = (await paid.getAttribute('aria-checked')) ?? 'false';
    const after = before === 'true' ? 'false' : 'true';

    await tapUntil(
      page,
      () => page.getByRole('checkbox').first().tap(),
      () => expect(page.getByRole('checkbox').first()).toHaveAttribute('aria-checked', after, { timeout: 3_000 }),
    );
    await page.getByRole('checkbox').first().tap();
    await expect(page.getByRole('checkbox').first()).toHaveAttribute('aria-checked', before);
  });

  test('QA 8 — a NIF opens digits, a phone the dialer pad, a reading the decimal pad', async ({ page }) => {
    const lesson = await poolsideLesson();
    await visit(page, `/dashboard/students/${lesson.studentIds[0]}`, 'load');
    await expect(page.locator('input[name="taxNumber"]')).toHaveAttribute('inputmode', 'numeric');
    await expect(page.locator('input[name="contactPhone"]')).toHaveAttribute('type', 'tel');

    await visit(page, `/dashboard/facilities/pools/${lesson.poolId}?tab=water&section=record`, 'domcontentloaded');
    await expect(page.locator('input[name="ph"]')).toHaveAttribute('inputmode', 'decimal');
  });
});
