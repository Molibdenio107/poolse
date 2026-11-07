import { expect, test, type Page } from '@playwright/test';
import { E2E_EMAIL, E2E_PASSWORD, NO_TEST_USER } from './session';

/**
 * Seeing the app as a real person — POOLSE-188, QA 1, 2, 9 and 13, as the owner on
 * a phone. Everything the server refuses is proved against the real middleware in
 * `apps/api/src/app-view/app-view.integration.test.ts`; this is what a person sees.
 * Each test presses *Sair*, because a view left open follows the login everywhere.
 */

test.skip(E2E_EMAIL === undefined || E2E_PASSWORD === undefined, NO_TEST_USER);

/** A view opens by redirecting, and a redirect still landing can interrupt the next goto. */
async function visit(page: Page, path: string): Promise<void> {
  try {
    await page.goto(path, { waitUntil: 'load' });
  } catch (error) {
    if (!String(error).includes('interrupted by another navigation')) throw error;
    await page.goto(path, { waitUntil: 'load' });
  }
}

async function enter(page: Page, option: RegExp, heading: string): Promise<void> {
  await visit(page, '/app/vista');
  await page.getByRole('link', { name: option }).click();
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  await page.locator('main ul button').first().click();
  await expect(page.getByText(/^A ver como /)).toBeVisible({ timeout: 30_000 });
}

async function leave(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page).toHaveURL(/\/app\/vista$/);
}

test('the four ways in, then a family’s app, read-only, with the banner', async ({ page }) => {
  await visit(page, '/app');
  await expect(page).toHaveURL(/\/app\/vista$/);
  await expect(page.getByRole('heading', { name: 'Como quer entrar?' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Backoffice/ })).toBeVisible();

  await enter(page, /Família/, 'Família');
  try {
    await expect(page).toHaveURL(/\/app\/familia/, { timeout: 30_000 });

    await visit(page, '/app/familia/documentos');
    await expect(page.getByText(/^A ver como /)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Documentos' })).toBeVisible();
    await expect(page.locator('main a[href*="/pdf"]')).toHaveCount(0);

    // The profile is the person's, not the reader's account.
    await visit(page, '/app/perfil');
    await expect(page.getByText('A conta desta pessoa não abre nesta vista.')).toBeVisible();

    // The backoffice waits for *Sair*.
    await visit(page, '/dashboard/students');
    await expect(page).toHaveURL(/\/app\/familia/, { timeout: 30_000 });
  } finally {
    await leave(page);
  }
});

test('a button under a view says the view is read-only, and nothing is done', async ({ page }) => {
  await enter(page, /Manutenção/, 'Manutenção');
  try {
    const done = page.getByRole('button', { name: 'Concluir' }).first();
    await expect(done).toBeVisible();
    await done.click();
    await expect(page.getByText('Esta vista é só de leitura.').first()).toBeVisible();
    await expect(done).toBeVisible();
  } finally {
    await leave(page);
  }
});
