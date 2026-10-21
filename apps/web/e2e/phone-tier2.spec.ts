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
import { poolsideLesson, type PoolsideLesson } from './poolside-fixture';

/**
 * Tier 2 on a phone — POOLSE-88 slice 3: "must work on a phone, plainly".
 *
 * Not a flow each, but the two promises every tier-2 page owes at 360px, as the
 * owner and as the instructor: **nothing scrolls sideways** (AC 4), and **no
 * field is squeezed**. The second is the one a height survey misses: the
 * owner's student form sat beside the photo upload and shrank to a 138px column
 * on a phone, every box in it too narrow to read what was typed, and nothing
 * overflowed. A text field narrower than 160px on a 360px screen is that bug;
 * a select or a short value (a time, a number of minutes) gets 96px, since
 * those are sized to what they hold by design.
 */

test.skip(E2E_EMAIL === undefined || E2E_PASSWORD === undefined, NO_TEST_USER);
test.skip(E2E_INSTRUCTOR_EMAIL === undefined || E2E_INSTRUCTOR_PASSWORD === undefined, NO_INSTRUCTOR);

test.use({ viewport: { width: 360, height: 740 } });

/** The tier-2 screens, built from the poolside fixture's own records. */
function tier2(lesson: PoolsideLesson): string[] {
  const ana = `/dashboard/students/${lesson.studentIds[0]}`;
  const turma = `/dashboard/classes/${lesson.classGroupId}`;
  return [
    '/dashboard',
    '/dashboard/profile',
    '/dashboard/students/new',
    '/dashboard/students/levels',
    '/dashboard/students/guardians',
    '/dashboard/calendar/closures',
    ...['general', 'fees', 'turmas', 'week', 'credits', 'activity'].map((tab) => `${ana}?tab=${tab}`),
    ...['general', 'schedule', 'students', 'activity'].map((tab) => `${turma}?tab=${tab}`),
    `${turma}/skills`,
  ];
}

/** `page.goto`, once more if Next's dev server full-reloads a cold route. */
async function visit(page: Page, path: string): Promise<void> {
  try {
    await page.goto(path, { waitUntil: 'load' });
  } catch (error) {
    if (!String(error).includes('interrupted by another navigation')) throw error;
    await page.goto(path, { waitUntil: 'load' });
  }
}

async function plainly(page: Page, path: string): Promise<void> {
  await visit(page, path);
  await page.locator('main').first().waitFor();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(0);

  const squeezed = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>(
        "main input:not([type='checkbox']):not([type='radio']):not([type='hidden']):not([type='file']):not([type='color']), main textarea, main select",
      ),
    )
      .filter((el) => el.getBoundingClientRect().width > 0 && el.closest('details:not([open])') === null)
      // The frame a person sees: a search box's input sits inside a styled shell.
      .map((el) => ({ el, frame: el.closest<HTMLElement>('label > span, .h-control') ?? el }))
      // A select may be sized to its options ("Mensal") on purpose, and a short
      // value ("18:00", "45") needs no more; a box a person types words into
      // needs room for what they type.
      .filter(({ el, frame }) => {
        const short =
          el.tagName === 'SELECT' ||
          ['time', 'number', 'date', 'datetime-local'].includes(el.getAttribute('type') ?? '') ||
          ['numeric', 'decimal'].includes(el.getAttribute('inputmode') ?? '');
        return frame.getBoundingClientRect().width < (short ? 96 : 160);
      })
      .map(({ el, frame }) => `${el.getAttribute('name') ?? el.getAttribute('placeholder')} ${Math.round(frame.getBoundingClientRect().width)}px`),
  );
  expect(squeezed, `${path} has fields too narrow to read`).toEqual([]);
}

test('tier 2, as the owner — nothing scrolls sideways, no field is squeezed', async ({ page }) => {
  test.setTimeout(180_000);
  const lesson = await poolsideLesson();
  for (const path of tier2(lesson)) await plainly(page, path);
});

test.describe('as the instructor', () => {
  test.use({ storageState: INSTRUCTOR_SESSION });

  test('tier 2, as the instructor — nothing scrolls sideways, no field is squeezed', async ({ page }) => {
    test.setTimeout(180_000);
    const lesson = await poolsideLesson();
    for (const path of tier2(lesson)) await plainly(page, path);
  });
});
