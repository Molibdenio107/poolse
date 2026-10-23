import { expect, test, type Locator, type Page } from '@playwright/test';
import { E2E_EMAIL, E2E_PASSWORD, NO_TEST_USER, PHONE_SESSION } from './session';
import { qualifyingFixture } from './qualifying-fixture';

/**
 * Competição — POOLSE-111, QA 1–3, keyboard included.
 *
 * A draft season ending in 2026 with one standard and no age groups (reset
 * each run): the Tempos tab is a greyed table with the one-click FPN groups,
 * the year wheel on Escalões, and the import's LENEX line.
 */

test.skip(E2E_EMAIL === undefined || E2E_PASSWORD === undefined, NO_TEST_USER);
test.use({ storageState: PHONE_SESSION, viewport: { width: 1280, height: 900 } });
test.setTimeout(90_000);
test.describe.configure({ mode: 'serial' });

let ids: { seasonId: string; standardId: string };
test.beforeAll(async () => {
  ids = await qualifyingFixture(E2E_EMAIL!);
});

async function visit(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'load' });
  await page.locator('main').first().waitFor();
  await page.waitForFunction(() => document.readyState === 'complete');
}

test('QA 1 — no age groups: a greyed grid, the notice and one click to the FPN groups, then a live grid', async ({ page }) => {
  const standard = `/dashboard/students/provas/minimos/${ids.standardId}`;
  await visit(page, `${standard}?tab=times`);

  const notice = page.getByRole('status').filter({ hasText: /ainda não tem escalões fpn|has no fpn age groups yet/i });
  await expect(notice).toBeVisible();
  // Every event is a row, and every cell is there but disabled.
  const cells = page.locator('table input');
  expect(await cells.count()).toBeGreaterThan(20);
  for (const cell of await cells.all()) await expect(cell).toBeDisabled();
  await expect(page.getByRole('button', { name: /guardar os tempos|save the times/i })).toHaveCount(0);
  await expect(notice.getByRole('link', { name: /ir para escalões|go to age groups/i })).toBeVisible();

  // One click, from the keyboard.
  const create = notice.getByRole('button', { name: /criar os escalões fpn desta época|create this season's fpn age groups/i });
  await expect(async () => {
    await create.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/tab=times&section=/, { timeout: 5_000 });
  }).toPass({ timeout: 30_000 });

  // The grid is live, on the first group, and the pills say they are groups.
  await expect(page.getByText(/^escalão:$|^age group:$/i)).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Cadetes C' })).toBeVisible();
  await expect(page.locator('table input').first()).toBeEnabled();
  // Cadetes C: nine and under, so born 2017 or later for a season ending in 2026.
  await expect(page.locator('main section').filter({ has: page.getByRole('heading', { level: 2, name: 'Cadetes C' }) })).toContainText('2017');

  // With groups, a standard opens on Tempos.
  await visit(page, standard);
  await expect(page.locator('table input').first()).toBeEnabled();

  // The FPN's own years for 2025/2026, as Escalões lists them.
  await visit(page, `/dashboard/students/provas/escaloes?season=${ids.seasonId}`);
  const row = (name: string): Locator => page.locator('li', { has: page.getByText(name, { exact: true }) });
  await expect(row('Cadetes A')).toContainText('2014');
  await expect(row('Juniores')).toContainText('2008');
  await expect(row('Juniores')).toContainText('2009');
  await expect(row('Seniores')).toContainText('2007');
});

test('QA 2 — the year wheel: scrolled to 2014 holds 2014; "20" then "15" jumps to 2015; 2016 to 2014 is refused', async ({ page }) => {
  await visit(page, `/dashboard/students/provas/escaloes?season=${ids.seasonId}`);
  const form = page.locator('section', { has: page.getByRole('heading', { name: /acrescentar escalão|add age group/i }) });
  const from = form.getByRole('listbox', { name: /nascidos desde|born from/i });
  const to = form.getByRole('listbox', { name: /nascidos até|born up to|born to/i });
  const fromValue = form.locator('input[type=hidden][name="bornFrom"]');
  const toValue = form.locator('input[type=hidden][name="bornTo"]');
  await expect(from).toBeVisible();

  // Scroll the wheel so 2014 settles in the window, then tab out.
  await from.evaluate((box) => {
    const option = [...box.querySelectorAll('[role=option]')].find((el) => el.textContent === '2014') as HTMLElement;
    box.scrollTop = option.offsetTop - (box as HTMLElement).clientHeight / 2 + option.offsetHeight / 2;
    box.dispatchEvent(new Event('scroll'));
  });
  await expect(fromValue).toHaveValue('2014');
  await from.focus();
  await page.keyboard.press('Tab');
  await expect(fromValue).toHaveValue('2014');

  // Typing a year jumps to it.
  await from.focus();
  await page.keyboard.type('20', { delay: 50 });
  await page.keyboard.type('15', { delay: 50 });
  await expect(fromValue).toHaveValue('2015');
  // And the arrows move one — newest first, so up is the later year.
  await page.keyboard.press('ArrowUp');
  await expect(fromValue).toHaveValue('2016');
  await expect(from).toHaveAttribute('aria-activedescendant', /.+/);

  await to.focus();
  await page.keyboard.type('2014', { delay: 50 });
  await expect(toValue).toHaveValue('2014');

  await form.getByLabel(/^nome$|^name$/i).fill('Teste invertido');
  await form.getByRole('button', { name: /^acrescentar|^add/i }).click();
  await expect(form.getByText(/o último ano não pode ser anterior ao primeiro|last year cannot be before the first/i)).toBeVisible();
});

test('QA 3 — the import says it reads LENEX and links to where to get it', async ({ page }) => {
  await visit(page, `/dashboard/students/provas?season=${ids.seasonId}`);
  const line = page.locator('#meet-import-format');
  await expect(line).toContainText(/ficheiro lenex \(\.lef\/\.lxf\), o formato que a fpn e o ranking nacional exportam|a lenex file/i);
  const link = line.getByRole('link', { name: /como obter o ficheiro|how to get the file/i });
  await expect(link).toHaveAttribute('href', /fpnatacao\.pt/);
  await expect(link).toHaveAttribute('target', '_blank');
  // Described to the button it explains.
  // The visible button — the file input behind it carries the same name.
  await expect(page.locator('button', { hasText: /importar resultados|import results/i })).toHaveAttribute(
    'aria-describedby',
    'meet-import-format',
  );
});
