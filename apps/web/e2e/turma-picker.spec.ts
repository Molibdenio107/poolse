import { expect, test, type Locator, type Page } from '@playwright/test';
import { E2E_EMAIL, E2E_PASSWORD, NO_TEST_USER, PHONE_SESSION } from './session';
import { FULL_TURMA, LEVEL, OPEN_TURMA, REQUEST_SWIMMER, leadsFixture } from './leads-fixture';

/**
 * Pedidos de inscrição's turma picker — POOLSE-110, QA 1–5.
 *
 * A request for Iniciação, the club's eighteen turmas plus two Iniciação ones:
 * Golfinhos (two slots, an instructor, 3 / 12) and a full one. Nothing is
 * submitted — answering the request would create a student each run; what is
 * under test is the choosing.
 */

test.skip(E2E_EMAIL === undefined || E2E_PASSWORD === undefined, NO_TEST_USER);
test.use({ storageState: PHONE_SESSION, viewport: { width: 1280, height: 900 } });
test.setTimeout(90_000);

test.beforeAll(async () => {
  await leadsFixture(E2E_EMAIL!);
});

async function openDialog(page: Page, button: RegExp): Promise<Locator> {
  await page.goto('/dashboard/students/pedidos', { waitUntil: 'load' });
  const card = page.locator('li', { hasText: `${REQUEST_SWIMMER.first} ${REQUEST_SWIMMER.last}` }).first();
  await card.scrollIntoViewIfNeeded();
  const dialog = page.getByRole('dialog');
  // The button answers once React has hydrated it.
  await expect(async () => {
    await card.getByRole('button', { name: button }).click();
    await expect(dialog).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  return dialog;
}

function option(dialog: Locator, name: string): Locator {
  return dialog.getByRole('option').filter({ hasText: name });
}

test('QA 1 — the requested level comes first, under Nível pedido, each turma with slots, instructor and fill', async ({ page }) => {
  const dialog = await openDialog(page, /^inscrever$/i);
  const groups = dialog.getByRole('group');
  await expect(groups.first()).toHaveAccessibleName(new RegExp(`nível pedido — ${LEVEL}`, 'i'));
  const golfinhos = option(groups.first(), OPEN_TURMA);
  await expect(golfinhos).toContainText(/seg 18:00 · qua 18:00/i);
  await expect(golfinhos).toContainText('3 / 12');
  await expect(golfinhos).not.toContainText(/sem professor/i);
  // A <select> is gone: the list is a listbox of rows.
  await expect(dialog.locator('select[name="classGroupId"]')).toHaveCount(0);
});

test('QA 2 — a full turma is greyed and not pickable for Inscrever, and pickable for Lista de espera', async ({ page }) => {
  let dialog = await openDialog(page, /^inscrever$/i);
  const full = option(dialog, FULL_TURMA);
  await expect(full).toHaveAttribute('aria-disabled', 'true');
  await expect(full).toContainText(/cheia/i);
  // A disabled row ignores the click: forced, to prove it changes nothing.
  await full.click({ force: true });
  await expect(dialog.getByRole('button', { name: /^alterar a turma/i })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: /^inscrever$/i })).toBeDisabled();
  await page.keyboard.press('Escape');

  dialog = await openDialog(page, /lista de espera/i);
  const waiting = option(dialog, FULL_TURMA);
  await expect(waiting).toHaveAttribute('aria-disabled', 'false');
  await expect(waiting).toContainText(/só lista de espera/i);
  await waiting.click();
  await expect(dialog.getByRole('button', { name: /^alterar a turma/i })).toBeVisible();
  await expect(dialog).toContainText(`${FULL_TURMA} · Sex 17:00 · 1 / 1`);
});

test('QA 3 — typing "Gol" leaves only the matching turmas', async ({ page }) => {
  const dialog = await openDialog(page, /^inscrever$/i);
  await dialog.getByRole('combobox').fill('Gol');
  const shown = dialog.getByRole('option');
  await expect(option(dialog, OPEN_TURMA)).toBeVisible();
  await expect(dialog.getByRole('option').filter({ hasText: 'Ref · Hidro Sénior A' })).toHaveCount(0);
  // Every row left matches by turma, level or instructor.
  const count = await shown.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    const group = await shown.nth(i).locator('xpath=ancestor::*[@role="group"][1]').getAttribute('aria-labelledby');
    const heading = (await dialog.locator(`[id="${group}"]`).textContent()) ?? '';
    expect(`${heading} ${await shown.nth(i).textContent()}`).toMatch(/gol/i);
  }
});

test('QA 4 — a picked turma is shown back with Alterar, and Aula experimental then offers its next dates', async ({ page }) => {
  const dialog = await openDialog(page, /aula experimental/i);
  await expect(dialog.getByText(/escolha primeiro a turma|choose the class first/i)).toBeVisible();
  await expect(dialog.getByLabel(/data da aula|trial date/i)).toHaveCount(0);

  await option(dialog, OPEN_TURMA).click();
  await expect(dialog).toContainText(`${OPEN_TURMA} · Seg 18:00 · Qua 18:00 · 3 / 12`);
  await expect(dialog.getByRole('button', { name: /^alterar a turma/i })).toBeVisible();

  const dates = dialog.locator('select[name="sessionId"] option:not([value=""])');
  await expect(dates).toHaveCount(3, { timeout: 15_000 });

  // Alterar reopens the list, and the choice can be changed.
  await dialog.getByRole('button', { name: /^alterar a turma/i }).click();
  await expect(dialog.getByRole('combobox', { name: /^turma$|^class$/i })).toBeFocused();
});

test('QA 5 — scenario 1 with the keyboard alone', async ({ page }) => {
  await page.goto('/dashboard/students/pedidos', { waitUntil: 'load' });
  await page.waitForFunction(() => document.readyState === 'complete');
  const card = page.locator('li', { hasText: `${REQUEST_SWIMMER.first} ${REQUEST_SWIMMER.last}` }).first();
  const enrol = card.getByRole('button', { name: /^inscrever$/i });
  const dialog = page.getByRole('dialog');
  await expect(async () => {
    await enrol.focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });

  // Tab to the search box — the list's own control.
  const search = dialog.getByRole('combobox');
  for (let i = 0; i < 6 && !(await search.evaluate((el) => el === document.activeElement)); i += 1) {
    await page.keyboard.press('Tab');
  }
  await expect(search).toBeFocused();

  // The first row the arrows reach is the requested level's first pickable turma.
  await page.keyboard.press('ArrowDown');
  const activeId = await search.getAttribute('aria-activedescendant');
  expect(activeId).not.toBeNull();
  await expect(dialog.locator(`[id="${activeId}"]`)).toContainText(OPEN_TURMA);

  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('status')).toHaveText(new RegExp(`escolhida: ${OPEN_TURMA}`, 'i'));
  const change = dialog.getByRole('button', { name: /alterar a turma/i });
  await expect(change).toBeFocused();
  await expect(dialog.getByRole('button', { name: /^inscrever$/i })).toBeEnabled();

  // Alterar, then Escape: back to the choice, and the dialog stays open.
  await page.keyboard.press('Enter');
  await expect(search).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(change).toBeFocused();

  // Escape from outside the list closes the question.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('on a phone the picker fills the screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = await openDialog(page, /^inscrever$/i);
  const box = await dialog.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(389);
  expect(box!.height).toBeGreaterThanOrEqual(840);
  await expect(dialog.getByRole('listbox')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});
