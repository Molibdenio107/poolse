import { expect, test, type Page } from '@playwright/test';
import { E2E_EMAIL, E2E_PASSWORD, NO_TEST_USER, PHONE_SESSION } from './session';

/**
 * The phone's shell — POOLSE-88 slice 1, QA 1–4, on the `iphone` (WebKit) and
 * `android` (Chromium) projects.
 *
 * What emulation can and cannot prove is the whole caveat of this file. It can
 * read the manifest, the Apple metadata, the coarse-pointer sizes, the 16px
 * floor and the shell's offsets; Chromium can say whether the page meets its
 * install criteria. It cannot tap *Adicionar ao ecrã principal*, raise a real
 * keyboard or put a real notch on screen — those are the ticket's real-device
 * passes. A notch and a home bar are stood in for by setting the `--safe-*`
 * variables every shell offset reads (globals.css).
 */

test.skip(E2E_EMAIL === undefined || E2E_PASSWORD === undefined, NO_TEST_USER);

/** The iPhone's notch and home bar, in CSS pixels (iPhone 14). */
const NOTCH = 47;
const HOME_BAR = 34;

/** Pages with fields and buttons, all tier 1 or the shell itself. */
const PAGES_WITH_FIELDS = [
  '/dashboard/students',
  '/dashboard/facilities/incidents/new',
  '/dashboard/students/messages/new',
];

async function open(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await page.locator('main').first().waitFor();
}

/**
 * Open the phone menu. Retried until the sheet is up, because the button is in
 * the server's markup before React has hydrated it, and a tap in that moment
 * lands on a button with no handler yet.
 */
async function openMenu(page: Page): Promise<void> {
  const menu = page.getByRole('button', { name: /abrir o menu|open the menu/i });
  await expect(async () => {
    if ((await page.getByRole('dialog').count()) === 0) await menu.tap();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

/** Width and height of a PNG, read from its IHDR chunk. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** Every visible element carrying `cls`, with its height and font size. */
async function measure(page: Page, cls: string): Promise<{ what: string; height: number; font: number }[]> {
  return page.evaluate((name) => {
    return Array.from(document.querySelectorAll<HTMLElement>(`.${name}`))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
      })
      .map((el) => ({
        what: `${el.tagName.toLowerCase()} "${(el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 30)}"`,
        height: Math.round(el.getBoundingClientRect().height * 10) / 10,
        font: parseFloat(getComputedStyle(el).fontSize),
      }));
  }, cls);
}

/** Visible text fields whose text is under 16px — each one a page iOS zooms. */
async function smallFields(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>(
        "input:not([type='checkbox']):not([type='radio']):not([type='hidden']):not([type='file']):not([type='range']), select, textarea",
      ),
    )
      .filter((el) => el.getBoundingClientRect().width > 0)
      .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16)
      .map((el) => `${el.tagName.toLowerCase()}[name=${el.getAttribute('name')}] ${getComputedStyle(el).fontSize}`),
  );
}

// ---------------------------------------------------------------------------
// QA 1 — installable
// ---------------------------------------------------------------------------

test('QA 1: the manifest makes Poolse an app that opens standalone at its front door', async ({ request }) => {
  const response = await request.get('/manifest.webmanifest');
  expect(response.status()).toBe(200);
  const manifest = (await response.json()) as {
    name: string;
    short_name: string;
    display: string;
    start_url: string;
    theme_color: string;
    background_color: string;
    icons: { src: string; sizes: string; purpose?: string }[];
  };

  expect(manifest.short_name).toBe('Poolse');
  expect(manifest.display).toBe('standalone');
  // App mode's front door since POOLSE-90: it sends each role to its own home.
  expect(manifest.start_url).toBe('/app');
  expect(manifest.theme_color).toMatch(/^#[0-9A-F]{6}$/i);
  expect(manifest.background_color).toMatch(/^#[0-9A-F]{6}$/i);

  // Every icon is there, is a PNG, and is the size it claims.
  const purposes = new Set<string>();
  for (const icon of manifest.icons) {
    const file = await request.get(icon.src);
    expect(file.status(), icon.src).toBe(200);
    const [w, h] = icon.sizes.split('x').map(Number);
    expect(pngSize(await file.body()), icon.src).toEqual({ width: w, height: h });
    purposes.add(icon.purpose ?? 'any');
  }
  expect(manifest.icons.map((icon) => icon.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  expect([...purposes]).toEqual(expect.arrayContaining(['any', 'maskable']));
});

test('QA 1: the page carries what iOS reads to add it to the home screen', async ({ page, request }) => {
  await open(page, '/dashboard');

  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'Poolse');
  // Next writes the standard name; iOS 16.4+ reads it alongside the Apple one.
  await expect(
    page.locator('meta[name="apple-mobile-web-app-capable"], meta[name="mobile-web-app-capable"]').first(),
  ).toHaveAttribute('content', 'yes');
  await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute('content', /^#[0-9A-F]{6}$/i);
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/);

  // iOS takes the home-screen icon from here, not from the manifest.
  const touch = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  expect(touch).not.toBeNull();
  const icon = await request.get(touch!);
  expect(icon.status()).toBe(200);
  expect(pngSize(await icon.body())).toEqual({ width: 180, height: 180 });
});

test('QA 1: Chrome on Android finds nothing standing between the page and Instalar app', async ({ page }, info) => {
  test.skip(info.project.name !== 'android', 'An installability report is a Chromium protocol call.');
  await open(page, '/dashboard');

  const cdp = await page.context().newCDPSession(page);
  const { installabilityErrors } = (await cdp.send('Page.getInstallabilityErrors')) as {
    installabilityErrors: { errorId: string }[];
  };
  expect(installabilityErrors.map((error) => error.errorId)).toEqual([]);

  const { url } = (await cdp.send('Page.getAppManifest')) as { url: string };
  expect(url).toMatch(/\/manifest\.webmanifest$/);
});

// ---------------------------------------------------------------------------
// QA 2 — 44px and 16px under a finger, 36px and 15px under a mouse
// ---------------------------------------------------------------------------

test('QA 2: under a finger every control is 44px tall with 16px text', async ({ page }) => {
  for (const path of ['/dashboard', ...PAGES_WITH_FIELDS]) {
    await open(page, path);
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), 'a phone is a coarse pointer').toBe(true);

    const heights = await measure(page, 'h-control');
    expect(heights.length, `${path} has controls`).toBeGreaterThan(0);
    expect(heights.filter((c) => c.height !== 44), `${path}: not 44px`).toEqual([]);

    const texts = await measure(page, 'text-control');
    expect(texts.filter((c) => c.font !== 16), `${path}: not 16px`).toEqual([]);
  }
});

test('QA 2: under a mouse the same controls stay 36px and 15px', async ({ browser }) => {
  const desk = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    hasTouch: false,
    isMobile: false,
    storageState: PHONE_SESSION,
    locale: 'pt-PT',
  });
  const page = await desk.newPage();
  try {
    for (const path of ['/dashboard', ...PAGES_WITH_FIELDS]) {
      await open(page, path);
      expect(await page.evaluate(() => matchMedia('(pointer: fine)').matches)).toBe(true);

      const heights = await measure(page, 'h-control');
      expect(heights.length).toBeGreaterThan(0);
      expect(heights.filter((c) => c.height !== 36), `${path}: not 36px`).toEqual([]);
      const texts = await measure(page, 'text-control');
      expect(texts.filter((c) => c.font !== 15), `${path}: not 15px`).toEqual([]);
    }
  } finally {
    await desk.close();
  }
});

// ---------------------------------------------------------------------------
// QA 3 — focusing a field never zooms the page
// ---------------------------------------------------------------------------

test('QA 3: no text field is under 16px, and focusing one leaves the page unzoomed', async ({ page }) => {
  for (const path of PAGES_WITH_FIELDS) {
    await open(page, path);

    // Zoom stays the reader's: never `maximum-scale` or `user-scalable=no`.
    const viewport = (await page.locator('meta[name="viewport"]').getAttribute('content')) ?? '';
    expect(viewport).not.toMatch(/maximum-scale|user-scalable\s*=\s*(no|0)/);

    expect(await smallFields(page), path).toEqual([]);

    const field = page
      .locator("input:not([type='hidden']):not([type='checkbox']):not([type='radio']), textarea")
      .filter({ visible: true })
      .first();
    await field.tap();
    await expect(field).toBeFocused();
    /*
     * A sanity check, not the proof: neither engine's emulation zooms on focus
     * the way a real iPhone does, so the 16px floor above is the assertion
     * that matters. The real-device pass is slice 3's.
     */
    expect(await page.evaluate(() => window.visualViewport?.scale ?? 1), `${path} zoomed`).toBe(1);
  }
});

// ---------------------------------------------------------------------------
// QA 4 — nothing under the notch or the home bar, light and dark
// ---------------------------------------------------------------------------

/** Stand in for an iPhone's notch and home bar. */
async function notched(page: Page): Promise<void> {
  await page.evaluate(
    ([top, bottom]) => {
      const root = document.documentElement.style;
      root.setProperty('--safe-top', `${top}px`);
      root.setProperty('--safe-bottom', `${bottom}px`);
    },
    [NOTCH, HOME_BAR],
  );
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

/**
 * Interactive elements on screen that sit in the notch or the home bar. Things
 * scrolled behind the sticky app bar are not on screen, so they are left out.
 *
 * Pass 0 for an edge not being judged. Content in the middle of a long page
 * passes under the home bar as it scrolls, which is ordinary; what must never
 * happen is a button *left* there when nothing more can scroll — so the home
 * bar is judged at the end of the page, and the notch at its top.
 */
async function underTheBars(page: Page, notch: number, homeBar: number, within = 'body'): Promise<string[]> {
  return page.evaluate(
    ([top, bottom, scope]) => {
      const bar = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
      const height = window.innerHeight;
      return Array.from(
        document
          .querySelector(scope as string)!
          .querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [role="button"]'),
      )
        .filter((el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden') return false;
          if (r.bottom <= 0 || r.top >= height) return false; // off screen
          // Page content scrolled up under the sticky app bar is not on screen.
          // The menu sheet sits above the app bar, so inside it nothing is.
          const covered = scope === 'body' && el.closest('header') === null && r.bottom <= bar;
          if (covered) return false;
          return (top > 0 && r.top < top - 0.5) || (bottom > 0 && r.bottom > height - bottom + 0.5);
        })
        .map((el) => `${el.tagName.toLowerCase()} "${(el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 30)}"`);
    },
    [notch, homeBar, within] as const,
  );
}

for (const scheme of ['light', 'dark'] as const) {
  test(`QA 4 (${scheme}): no button under the home bar and nothing under the notch`, async ({ page, context, baseURL }, info) => {
    /*
     * The way a phone gets there: the preference left on *Segue o sistema* and
     * the operating system in light or dark. Not a `poolse-theme=dark` cookie —
     * the dashboard resets the cookie to the person's stored preference, and a
     * cookie that disagrees with it races that reset.
     */
    await context.addCookies([{ name: 'poolse-theme', value: 'system', url: baseURL! }]);
    await page.emulateMedia({ colorScheme: scheme });
    await open(page, '/dashboard');
    await notched(page);

    // The theme really is the one under test.
    expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(scheme === 'dark');

    // The app bar pads itself clear of the notch.
    const menu = page.getByRole('button', { name: /abrir o menu|open the menu/i });
    await expect(menu).toBeVisible();
    expect((await menu.boundingBox())!.y).toBeGreaterThanOrEqual(NOTCH);

    expect(await underTheBars(page, NOTCH, 0), 'at the top of the page').toEqual([]);

    /*
     * The content pads itself clear of the home bar — asserted directly,
     * because the page's own bottom padding (40px) would hide a missing
     * `pb-safe-bottom` from the position check below.
     */
    const contentPadding = await page.evaluate(() => {
      const main = document.querySelector('main');
      return main?.parentElement === null || main === null
        ? 0
        : parseFloat(getComputedStyle(main.parentElement).paddingBottom);
    });
    expect(contentPadding).toBe(HOME_BAR);

    // The last thing on the page sits above the home bar once scrolled to.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(null))));
    expect(await underTheBars(page, NOTCH, HOME_BAR), 'at the end of the page').toEqual([]);

    // The menu sheet too, top and bottom.
    await page.evaluate(() => window.scrollTo(0, 0));
    await openMenu(page);
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    expect((await sheet.boundingBox())!.y).toBeGreaterThanOrEqual(NOTCH);
    await sheet.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    expect(await underTheBars(page, NOTCH, HOME_BAR, '[role="dialog"]'), 'in the menu sheet').toEqual([]);

    await info.attach(`${info.project.name}-${scheme}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
}

test('the phone menu: no sidebar, a sheet with the same sections, closed by going somewhere', async ({ page }) => {
  await open(page, '/dashboard');

  await expect(page.locator('aside')).toBeHidden();
  // Nothing scrolls sideways at a phone's width.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await openMenu(page);
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('navigation')).toBeVisible();

  await sheet.getByRole('link', { name: /^Alunos$/ }).tap();
  await page.waitForURL(/\/dashboard\/students/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
