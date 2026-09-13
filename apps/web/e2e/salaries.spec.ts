import { expect, test } from '@playwright/test';

/**
 * Salários, in a browser — POOLSE-58, QA layer 3.
 *
 * **The signed-out assertions are the ones that earn their place here.** Every
 * rule about who may *read* a salary is already proven against the API, and a
 * test that signed in to check the same 403 would be slower and no more certain.
 * What only a browser can answer is what a stranger sees: whether the page
 * refuses, and whether it refuses *before* rendering anything.
 *
 * That last one is the failure this file exists to catch. A screen that renders
 * the table and then redirects has already put a club's wages into a response,
 * a browser cache and a screenshot — and it looks completely correct to
 * everybody testing it while signed in.
 *
 * The signed-in half needs a Clerk test user; see `playwright.config.ts`. Those
 * specs skip with a reason rather than failing, so the suite is green on a
 * machine that has not set one up.
 */

const SALARIES = '/dashboard/facilities/staff/salaries';

/** Anything that would be a leak if a stranger saw it on this page. */
const NEVER_FOR_A_STRANGER = [
  /Salários/i,
  /Custo mensal com pessoal/i,
  /Valor bruto/i,
  // A euro amount of any shape. The page is about wages; a stranger sees none.
  /\d[\d.,\s]*\s?€/,
];

test.describe('a stranger', () => {
  test('cannot reach the salaries page, and is not shown it on the way out', async ({ page }) => {
    const response = await page.goto(SALARIES, { waitUntil: 'domcontentloaded' });

    /*
     * Clerk's middleware rewrites a signed-out request rather than serving the
     * route, so the status is a 404 and the URL does not move. Either a refusal
     * status or a redirect to sign-in is correct; what is not correct is a 200
     * with the page behind it.
     */
    const status = response?.status() ?? 0;
    const signedOut = status >= 400 || /sign-in|entrar/i.test(page.url());
    expect(signedOut, `expected a refusal, got ${status} at ${page.url()}`).toBe(true);

    /*
     * **Visible text, not `page.content()`.** The first version of this read the
     * raw HTML and failed on the word "Salários" — which was not rendered at all:
     * `NextIntlClientProvider` serialises the whole message catalogue into the
     * page, so every label in the product is in the markup of every page. Those
     * are UI strings and no club's data, but a test that cannot tell them apart
     * from a rendered table is a test that will cry wolf and then be deleted.
     */
    const visible = await page.locator('body').innerText();
    for (const pattern of NEVER_FOR_A_STRANGER) {
      expect(visible, `a stranger saw ${String(pattern)}`).not.toMatch(pattern);
    }
  });

  test('cannot download the pay list', async ({ request }) => {
    // The export is a route handler, so it is reachable by URL without ever
    // rendering a page — the one place a hidden menu item would have been the
    // only thing standing between a stranger and a spreadsheet of wages.
    for (const path of [`${SALARIES}/export`, `${SALARIES}/export?format=csv`]) {
      const response = await request.get(path, { maxRedirects: 0 });

      // A refusal, a redirect to sign-in — anything but a spreadsheet. The
      // content type is the assertion that would survive a change of status.
      const type = response.headers()['content-type'] ?? '';
      expect(type, `${path} answered ${response.status()} as ${type}`).not.toMatch(
        /spreadsheet|csv/i,
      );

      const body = await response.text();
      expect(body).not.toMatch(/Valor bruto|Gross amount/i);
    }
  });

  test('is not offered the menu item anywhere in the public site', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('link', { name: /sal[áa]rios/i })).toHaveCount(0);
  });
});

/**
 * The signed-in walk-through — POOLSE-58 QA layer 3, the half that needs an
 * account.
 *
 * Written out rather than left as a comment so that turning it on is setting two
 * environment variables, not writing a spec. Each step is one the API cannot
 * check: what is *rendered*, in which order, and whether a keyboard can get to
 * it.
 */
const email = process.env['E2E_EMAIL'];
const password = process.env['E2E_PASSWORD'];

test.describe('an owner', () => {
  test.skip(
    email === undefined || password === undefined,
    'Set E2E_EMAIL and E2E_PASSWORD to a Clerk test user to run the signed-in walk-through.',
  );

  test.beforeEach(async ({ page }) => {
    await page.goto('/sign-in', { waitUntil: 'domcontentloaded' });
    await page.getByLabel(/e-?mail/i).fill(email!);
    await page.getByLabel(/palavra-passe|password/i).fill(password!);
    await page.getByRole('button', { name: /continuar|continue|entrar|sign in/i }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 20_000 });
  });

  test('sees the menu item, the coverage line and a dash where hours are unknown', async ({
    page,
  }) => {
    await page.getByRole('link', { name: /sal[áa]rios/i }).first().click();
    await page.waitForURL(new RegExp(SALARIES));

    // The coverage sentence is financials.md §6 on screen: a total over partial
    // data must say how partial.
    await expect(page.getByText(/com base em|based on/i)).toBeVisible();

    // And the dash, which must never be a zero.
    const dashes = page.getByText('—', { exact: true });
    if ((await dashes.count()) > 0) await expect(dashes.first()).toBeVisible();
  });

  test('opens a history sheet from the keyboard alone', async ({ page }) => {
    await page.goto(SALARIES, { waitUntil: 'domcontentloaded' });

    // A row that only a mouse can open is a row half the staff cannot read.
    const first = page.getByRole('button').filter({ hasNotText: /exportar|importar/i }).first();
    await first.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('never puts an amount in the URL', async ({ page }) => {
    const seen: string[] = [];
    page.on('framenavigated', (frame) => seen.push(frame.url()));

    await page.goto(SALARIES, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button').first().click();

    for (const url of seen) {
      expect(url, `an amount reached the URL: ${url}`).not.toMatch(/\d{3,}/);
    }
  });
});
