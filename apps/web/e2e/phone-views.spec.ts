import { expect, test, type Page } from '@playwright/test';
import { E2E_EMAIL, E2E_PASSWORD, NO_TEST_USER } from './session';
import { poolsideLesson } from './poolside-fixture';
import { owedDocuments } from './invoicing-fixture';

/**
 * The backoffice's desk-shaped screens on a phone — POOLSE-88 phone views
 * (Rui, 21-10-2026). Below `md` the calendar is a day agenda, the Turmas board
 * is a day-by-day list and Faturação's tables are cards; from `md` up every one
 * of them is exactly the desk screen it was. Both halves are asserted, because
 * "don't break the desktop" was the condition of doing this at all.
 */

test.skip(E2E_EMAIL === undefined || E2E_PASSWORD === undefined, NO_TEST_USER);

const PHONE = { width: 360, height: 740 };
const DESK = { width: 1280, height: 900 };

async function visit(page: Page, path: string): Promise<void> {
  try {
    await page.goto(path, { waitUntil: 'load' });
  } catch (error) {
    if (!String(error).includes('interrupted by another navigation')) throw error;
    await page.goto(path, { waitUntil: 'load' });
  }
  await page.locator('main').first().waitFor();
}

/** Boxes inside the page that scroll sideways — a table wider than its card. */
async function sidewaysScrollers(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('main *'))
      .filter((el) => {
        const style = getComputedStyle(el);
        return (
          (style.overflowX === 'auto' || style.overflowX === 'scroll') &&
          el.getBoundingClientRect().width > 0 &&
          el.scrollWidth > el.clientWidth + 4 &&
          el.closest('[role=tablist]') === null &&
          // A section pill row is one scrolling line on a phone by design
          // (POOLSE-92 E), as the tab strip is; a table or a card is not.
          el.closest('[data-scroll-row]') === null
        );
      })
      .map((el) => `${el.tagName.toLowerCase()} ${el.clientWidth}/${el.scrollWidth}`),
  );
}

test.describe('on a phone', () => {
  test.use({ viewport: PHONE });

  test('the calendar is a day agenda, and a lesson opens its own page', async ({ page }) => {
    test.setTimeout(75_000);
    const lesson = await poolsideLesson();
    await visit(page, '/dashboard/calendar');

    const days = page.getByRole('navigation', { name: /dias da semana|days of the week/i });
    await expect(days).toBeVisible();
    await expect(days.getByRole('link')).toHaveCount(7);
    // The lane grid's pool picker belongs to the desk view and is not shown.
    await expect(page.getByText(/escolha uma piscina|choose a pool/i).first()).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);

    // Today's poolside lesson is in today's agenda, and tapping it opens the lesson.
    const card = page.locator(`a[href^="/dashboard/calendar/sessions/${lesson.sessionId}"]`);
    await expect(card).toBeVisible();
    const box = await card.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    // A first visit compiles the lesson's route on the dev server; tap again until it lands.
    const url = new RegExp(`/sessions/${lesson.sessionId}`);
    await expect(async () => {
      if (!url.test(page.url())) await card.tap({ timeout: 5_000 });
      await expect(page).toHaveURL(url, { timeout: 10_000 });
    }).toPass({ timeout: 45_000 });
  });

  test('the Turmas board reads a day at a time, no card squeezed', async ({ page }) => {
    await poolsideLesson();
    await visit(page, '/dashboard/classes');
    const narrow = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('main h3'))
        .filter((h) => /segunda|terça|monday|tuesday/i.test(h.textContent ?? ''))
        .map((h) => Math.round(h.getBoundingClientRect().width))
        .filter((width) => width < 200),
    );
    expect(narrow, 'a day column narrower than 200px').toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  });

  test('Faturação scrolls no table sideways', async ({ page }) => {
    await poolsideLesson();
    for (const path of ['/dashboard/faturacao', '/dashboard/faturacao?view=owing']) {
      await visit(page, path);
      expect(await sidewaysScrollers(page), path).toEqual([]);
    }
  });

  test('Em dívida keeps its select-all on a phone, above the cards — POOLSE-104 D', async ({ page }) => {
    const owed = await owedDocuments(E2E_EMAIL!);
    await visit(page, `/dashboard/faturacao?facilityId=${owed.facilityId}&view=owing`);
    const all = page.getByRole('checkbox', { name: /selecionar todos em atraso|select all overdue/i });
    await expect(all).toBeVisible();
    // Its words are on screen, not only in the accessible name.
    await expect(page.getByText(/selecionar todos em atraso|select all overdue/i)).toBeVisible();
    // The column titles are not: each card carries them as labels.
    await expect(page.locator('thead th').nth(1)).toBeHidden();
    await all.tap();
    for (const doc of owed.overdue) {
      await expect(page.getByRole('checkbox', { name: new RegExp(doc.documentNo) })).toBeChecked();
    }
    for (const doc of owed.open) {
      await expect(page.getByRole('checkbox', { name: new RegExp(doc.documentNo) })).not.toBeChecked();
    }
    await all.tap();
    await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(0);
    expect(await sidewaysScrollers(page)).toEqual([]);
  });

  test('the lifeguard week is one day at a time, the hours beside it — POOLSE-96', async ({ page }) => {
    await visit(page, '/dashboard/facilities/lifeguards');
    const grid = page.locator('[data-roster-grid]');
    await expect(grid).toBeVisible();
    const shown = () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-roster-grid] > [role=group]'))
          .filter((day) => day.getBoundingClientRect().width > 0)
          .map((day) => day.getAttribute('aria-label')),
      );
    const first = await shown();
    expect(first, 'one day column on a phone').toHaveLength(1);
    // The hour column stays, beside the day.
    const hours = await grid.evaluate((el) => (el.children[8] as HTMLElement).getBoundingClientRect().width);
    expect(hours).toBeGreaterThan(30);

    // › moves to another day, still one.
    const next = page.getByRole('button', { name: /dia seguinte|next day/i });
    if (await next.isEnabled()) {
      await next.tap();
      const after = await shown();
      expect(after).toHaveLength(1);
      expect(after[0]).not.toBe(first[0]);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  });
});

test.describe('on a desk, the same pages are unchanged', () => {
  test.use({ viewport: DESK });

  test('the calendar keeps its lane grid, and the Turmas board its seven columns', async ({ page }) => {
    await poolsideLesson();
    await visit(page, '/dashboard/calendar');
    await expect(page.getByLabel(/piscina|pool/i).first()).toBeVisible();
    await expect(page.getByRole('navigation', { name: /dias da semana|days of the week/i })).toBeHidden();

    await visit(page, '/dashboard/classes');
    const columns = await page.evaluate(() => {
      const monday = Array.from(document.querySelectorAll<HTMLElement>('main h3')).find((h) =>
        /segunda|monday/i.test(h.textContent ?? ''),
      );
      const grid = monday?.parentElement?.parentElement;
      return grid === null || grid === undefined ? 0 : getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    });
    expect(columns).toBeGreaterThanOrEqual(6);
  });

  test('the calendar writes its week out and marks today with a Hoje pill, on this week only — POOLSE-107', async ({ page }) => {
    await poolsideLesson();
    await visit(page, '/dashboard/calendar');
    // "16 a 22 de novembro de 2026": the month in words, no dd-MM-yyyy.
    const heading = page.locator('main p.font-semibold').first();
    await expect(heading).toHaveText(/^\d{1,2} (de [a-zç]+ (de \d{4} )?)?a \d{1,2} de [a-zç]+ de \d{4}$/);
    // The lane grid draws once a pool is chosen — a client choice, so it is
    // made again until React has hydrated the select and the grid is drawn.
    const pills = page.locator('[data-today-pill]');
    await expect(async () => {
      await page.getByRole('combobox', { name: /^(piscina|pool)$/i }).selectOption({ label: 'Tanque Grande' });
      await expect(pills).toHaveCount(1, { timeout: 3_000 });
    }).toPass({ timeout: 30_000 });
    await expect(pills).toHaveText(/^(hoje|today)$/i);

    await page.getByRole('link', { name: /semana seguinte|next week/i }).first().click();
    await expect(heading).not.toHaveText((await heading.textContent()) ?? '');
    // The next week, same pool: the grid is drawn and no column is today.
    await expect(page.getByText(/^lanes?$|^pistas$/i).first()).toBeVisible();
    await expect(page.locator('[data-today-pill]')).toHaveCount(0);
  });

  test('Em dívida keeps its header row, the select-all in the checkbox column — POOLSE-104 D', async ({ page }) => {
    const owed = await owedDocuments(E2E_EMAIL!);
    await visit(page, `/dashboard/faturacao?facilityId=${owed.facilityId}&view=owing`);
    const all = page.getByRole('checkbox', { name: /selecionar todos em atraso|select all overdue/i });
    await expect(all).toBeVisible();
    await expect(page.locator('thead th').nth(1)).toBeVisible();
    // In the header cell above the rows' boxes, its words for a screen reader only.
    const header = (await all.boundingBox())!;
    const first = (await page.locator('tbody input[type=checkbox]').first().boundingBox())!;
    expect(Math.abs(header.x - first.x)).toBeLessThan(4);
    expect(header.y).toBeLessThan(first.y);
  });

  test('the lifeguard week shows all seven days, with no day stepper — POOLSE-96', async ({ page }) => {
    await visit(page, '/dashboard/facilities/lifeguards');
    await expect(page.locator('[data-roster-grid]')).toBeVisible();
    const days = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll('[data-roster-grid] > [role=group]')).filter(
          (day) => day.getBoundingClientRect().width > 0,
        ).length,
    );
    expect(days).toBe(7);
    await expect(page.getByRole('button', { name: /dia seguinte|next day/i })).toBeHidden();
  });
});
