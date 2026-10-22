import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { E2E_EMAIL, E2E_PASSWORD, NO_TEST_USER, PHONE_SESSION } from './session';

/**
 * The theme menu — POOLSE-99, QA 1–4, in both locales.
 *
 * The bug was invisible to every check but a browser: one click flipped the
 * class, the server decided nothing had changed, and the next navigation put
 * the old theme back from the router cache. So each scenario chooses, then
 * moves — a menu entry, a reload, a language switch — and asks `<html>` again.
 * Signed in as the E2E owner; the theme and the language are put back after.
 */

test.skip(E2E_EMAIL === undefined || E2E_PASSWORD === undefined, NO_TEST_USER);
test.use({ storageState: PHONE_SESSION });
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const OPTION = {
  'pt-PT': { system: 'Sistema', light: 'Claro', dark: 'Escuro' },
  en: { system: 'System', light: 'Light', dark: 'Dark' },
} as const;
type Locale = keyof typeof OPTION;
type Choice = keyof (typeof OPTION)['en'];

const LANGUAGE: Record<Locale, RegExp> = {
  'pt-PT': /^(português|portuguese)$/i,
  en: /^(inglês|english)$/i,
};

async function isDark(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.classList.contains('dark'));
}

async function themeCookie(page: Page): Promise<string | undefined> {
  return (await page.context().cookies()).find((cookie) => cookie.name === 'poolse-theme')?.value;
}

async function choose(page: Page, locale: Locale, choice: Choice): Promise<void> {
  const trigger = page.getByRole('button', { name: /^(tema|theme):/i });
  const item = page.getByRole('menuitemradio', { name: OPTION[locale][choice] });
  // The first click can land before hydration; ask again until the menu opens.
  await expect(async () => {
    if (!(await item.isVisible())) await trigger.click();
    await expect(item).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await item.click();
  await expect(trigger).toHaveAccessibleName(new RegExp(`${OPTION[locale][choice]}$`));
}

async function speak(page: Page, locale: Locale): Promise<void> {
  const button = page.getByRole('button', { name: LANGUAGE[locale] });
  if ((await button.getAttribute('aria-current')) === 'true') return;
  await button.click();
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
}

/** Counts every moment `<html>` is without `dark` from here on — a flash included. */
async function watchForLight(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { lightMoments: number };
    w.lightMoments = 0;
    new MutationObserver(() => {
      if (!document.documentElement.classList.contains('dark')) w.lightMoments += 1;
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  });
}

async function lightMoments(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { lightMoments: number }).lightMoments);
}

async function openDashboard(page: Page): Promise<void> {
  await page.goto('/dashboard', { waitUntil: 'load' });
  await expect(page.getByRole('button', { name: /^(tema|theme):/i })).toBeVisible();
}

/*
 * One browser context for every test, synced with the account once.
 *
 * The saved session's cookies are whatever they were when it was saved, and the
 * account is whatever the last run left. Where they disagree, the dashboard's
 * PreferenceSync puts the account's answer back a moment after the page loads —
 * correctly — and would undo a language or theme a test had just chosen. So the
 * context lets that happen once, here, and every test then starts agreed.
 */
let shared: BrowserContext;
let started: Choice;

const it = test.extend<{ page: Page }>({
  page: async ({}, use) => {
    const page = await shared.newPage();
    await use(page);
    await page.close();
  },
});

test.beforeAll(async ({ browser }) => {
  shared = await browser.newContext({ storageState: PHONE_SESSION });
  const page = await shared.newPage();
  await openDashboard(page);
  // The sync, if one is owed, is a server action and a revalidation away.
  await page.waitForTimeout(4000);
  await page.reload({ waitUntil: 'load' });
  started = ((await themeCookie(page)) ?? 'system') as Choice;
  await page.close();
});

test.afterAll(async () => {
  const page = await shared.newPage();
  await openDashboard(page);
  await speak(page, 'pt-PT');
  await choose(page, 'pt-PT', started);
  await shared.close();
});

for (const locale of ['pt-PT', 'en'] as const) {
  test.describe(`in ${locale}`, () => {
    it('QA 1 — dark at once, and still dark after a menu entry and a reload', async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'light' });
      await openDashboard(page);
      await speak(page, locale);

      await choose(page, locale, 'light');
      expect(await isDark(page)).toBe(false);

      await choose(page, locale, 'dark');
      expect(await isDark(page)).toBe(true);
      // The save before this one may still be on its way back; the last word is this one.
      await expect.poll(() => themeCookie(page)).toBe('dark');

      // A menu entry: the router cache must not hand the old class back.
      // A cold route compiles on first visit in dev, hence the long waits.
      await page.locator('nav a[href="/dashboard/classes"]').first().click();
      await expect(page).toHaveURL(/\/dashboard\/classes/, { timeout: 30_000 });
      await expect(page.locator('html')).toHaveClass(/\bdark\b/);
      await page.locator('nav a[href="/dashboard"]').first().click();
      await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
      await expect(page.locator('html')).toHaveClass(/\bdark\b/);

      await page.reload({ waitUntil: 'load' });
      await expect(page.locator('html')).toHaveClass(/\bdark\b/);
      await expect(page.getByRole('button', { name: /^(tema|theme):/i })).toHaveAccessibleName(
        new RegExp(`${OPTION[locale].dark}$`),
      );
    });

    it('QA 2 — dark survives a change of language', async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'light' });
      await openDashboard(page);
      await speak(page, locale);
      await choose(page, locale, 'dark');
      await watchForLight(page);

      const other: Locale = locale === 'en' ? 'pt-PT' : 'en';
      await speak(page, other);
      await expect(page.locator('html')).toHaveClass(/\bdark\b/);
      await speak(page, locale);
      await expect(page.locator('html')).toHaveClass(/\bdark\b/);
      expect(await lightMoments(page)).toBe(0);
    });

    it('QA 3 — Sistema on a dark OS never turns light on a server re-render', async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await openDashboard(page);
      await speak(page, locale);
      await choose(page, locale, 'system');
      expect(await isDark(page)).toBe(true);
      await expect.poll(() => themeCookie(page)).toBe('system');
      await watchForLight(page);

      // Two server re-renders of the whole layout: the language switch revalidates
      // it, and choosing the theme again does too.
      const other: Locale = locale === 'en' ? 'pt-PT' : 'en';
      await speak(page, other);
      await speak(page, locale);
      await choose(page, locale, 'system');
      await page.locator('nav a[href="/dashboard/classes"]').first().click();
      await expect(page).toHaveURL(/\/dashboard\/classes/, { timeout: 30_000 });

      await expect(page.locator('html')).toHaveClass(/\bdark\b/);
      expect(await lightMoments(page)).toBe(0);
    });
  });
}

it('QA 4 — a second browser picks up the stored theme', async ({ page, browser }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openDashboard(page);
  await speak(page, 'pt-PT');
  await choose(page, 'pt-PT', 'dark');

  const fresh = await secondBrowser(browser);
  await fresh.goto('/dashboard', { waitUntil: 'load' });
  // The stored choice reaches this browser through PreferenceSync, after the first render.
  await expect(fresh.locator('html')).toHaveClass(/\bdark\b/, { timeout: 15_000 });
  await expect.poll(() => themeCookie(fresh)).toBe('dark');
  await fresh.reload({ waitUntil: 'load' });
  await expect(fresh.locator('html')).toHaveClass(/\bdark\b/);
  await fresh.context().close();
});

/** The same signed-in person on a browser that has never chosen a theme. */
async function secondBrowser(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ storageState: PHONE_SESSION, colorScheme: 'light' });
  await context.clearCookies({ name: 'poolse-theme' });
  return context.newPage();
}
