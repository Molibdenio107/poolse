import { expect, test, type Page } from '@playwright/test';
import { Client } from 'pg';
import { E2E_EMAIL, E2E_PASSWORD, NO_TEST_USER } from './session';

/**
 * Voltar returns to where you came from — POOLSE-91, QA 9.
 *
 * The rule (Rui, 22-10-2026): Voltar goes back to the screen and context the
 * person came from — the same tab, section, page and filters — and a page
 * opened from the main menu has no Voltar. Cases 1–6 of the ticket, walked at
 * a desk's width and a phone's, as the owner.
 *
 * Named `phone-*` so it runs in the iphone and android projects, which carry
 * the owner's saved session; the desk half sets its own viewport, as
 * `phone-views.spec.ts` does.
 *
 * **Each case seeds what it needs and takes it away again.** The E2E club is
 * also the club somebody clicks through by hand, and the dashboard shows four
 * cards a band: a waiting pre-registration or sixteen lapsed certificates
 * escalate their cards and push Subscrição off it, which is exactly what case 1
 * needs to find. Removal is a soft delete or a decision, never a DELETE.
 */

test.skip(E2E_EMAIL === undefined || E2E_PASSWORD === undefined, NO_TEST_USER);

const PHONE = { width: 360, height: 740 };
const DESK = { width: 1280, height: 900 };

/** Enough to need a second page of Atenção — the list pages at 15. */
const OVERDUE_TYPES = 16;
const TYPE_PREFIX = 'E2E · Voltar';
const TASK_TITLE = 'E2E · Voltar — limpar pré-filtro';
/** A pre-registration left waiting three days lifts Pedidos into the dashboard's four. */
const LEAD_EMAIL = 'e2e+voltar@example.com';

interface Club {
  org: string;
  ownerId: string;
  facilityId: string;
}

async function withDb<T>(work: (db: Client) => Promise<T>): Promise<T> {
  const url = process.env['DATABASE_URL'];
  if (url === undefined) throw new Error('DATABASE_URL is not set — run with --env-file=../../.env');
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    await db.query('BEGIN');
    const result = await work(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    await db.end();
  }
}

async function club(): Promise<Club> {
  return withDb(async (db) => {
    const owner = (
      await db.query<{ membership_id: string; organization_id: string }>(
        `SELECT m.id AS membership_id, m.organization_id
           FROM app_user u
           JOIN membership m ON m.app_user_id = u.id AND m.archived_at IS NULL
           JOIN membership_role r ON r.membership_id = m.id AND r.role = 'owner' AND r.archived_at IS NULL
          WHERE u.cached_email = $1
          LIMIT 1`,
        [E2E_EMAIL],
      )
    ).rows[0];
    if (owner === undefined) throw new Error(`No owner membership for ${E2E_EMAIL}`);
    const facilityId = (
      await db.query<{ id: string }>(
        `SELECT id FROM facility WHERE organization_id = $1 AND archived_at IS NULL ORDER BY created_at LIMIT 1`,
        [owner.organization_id],
      )
    ).rows[0]?.id;
    if (facilityId === undefined) throw new Error('The E2E club has no site');
    return { org: owner.organization_id, ownerId: owner.membership_id, facilityId };
  });
}

/** One recurring task on the site's Manutenção tab. */
async function seedTask({ org, facilityId }: Club): Promise<string> {
  return withDb(async (db) => {
    const found = (
      await db.query<{ id: string }>(
        `SELECT id FROM maintenance_task
          WHERE organization_id = $1 AND facility_id = $2 AND title = $3 AND archived_at IS NULL`,
        [org, facilityId, TASK_TITLE],
      )
    ).rows[0]?.id;
    if (found !== undefined) return found;
    return (
      await db.query<{ id: string }>(
        `INSERT INTO maintenance_task (organization_id, facility_id, title, interval_days)
         VALUES ($1, $2, $3, 7) RETURNING id`,
        [org, facilityId, TASK_TITLE],
      )
    ).rows[0]!.id;
  });
}

/** Sixteen types the owner holds a lapsed record of, so Atenção has a page 2. */
async function seedOverdue({ org, ownerId }: Club): Promise<void> {
  await withDb(async (db) => {
    for (let n = 1; n <= OVERDUE_TYPES; n += 1) {
      const name = `${TYPE_PREFIX} ${String(n).padStart(2, '0')}`;
      let typeId = (
        await db.query<{ id: string }>(
          `SELECT id FROM qualification_type WHERE organization_id = $1 AND name = $2 AND archived_at IS NULL`,
          [org, name],
        )
      ).rows[0]?.id;
      typeId ??= (
        await db.query<{ id: string }>(
          `INSERT INTO qualification_type (organization_id, name) VALUES ($1, $2) RETURNING id`,
          [org, name],
        )
      ).rows[0]!.id;
      await db.query(
        `INSERT INTO qualification (organization_id, membership_id, qualification_type_id, expires_on)
         SELECT $1, $2, $3, (now() AT TIME ZONE 'Europe/Lisbon')::date - 10
          WHERE NOT EXISTS (
            SELECT 1 FROM qualification
             WHERE organization_id = $1 AND membership_id = $2 AND qualification_type_id = $3
               AND archived_at IS NULL)`,
        [org, ownerId, typeId],
      );
    }
  });
}

/** A pre-registration waiting five days. */
async function seedLead({ org }: Club): Promise<void> {
  await withDb((db) =>
    db.query(
      `INSERT INTO lead (organization_id, swimmer_first_name, swimmer_last_name, swimmer_birth_date,
                         email, consent_text_version, consented_at, created_at)
       SELECT $1, 'Voltar', 'E2E', DATE '2018-03-01', $2, 'e2e',
              now() - interval '5 days', now() - interval '5 days'
        WHERE NOT EXISTS (SELECT 1 FROM lead WHERE organization_id = $1 AND email = $2 AND status = 'new')`,
      [org, LEAD_EMAIL],
    ),
  );
}

/** Everything the seeds made, archived or decided — never deleted. */
async function tidy({ org }: Club): Promise<void> {
  await withDb(async (db) => {
    await db.query(
      `UPDATE lead SET status = 'dismissed', dismissed_reason = 'E2E', decided_at = now()
        WHERE organization_id = $1 AND email = $2 AND status = 'new'`,
      [org, LEAD_EMAIL],
    );
    await db.query(
      `UPDATE qualification q SET archived_at = now()
         FROM qualification_type t
        WHERE q.organization_id = $1 AND t.organization_id = $1 AND t.id = q.qualification_type_id
          AND t.name LIKE $2 AND q.archived_at IS NULL`,
      [org, `${TYPE_PREFIX} %`],
    );
    await db.query(
      `UPDATE qualification_type SET archived_at = now()
        WHERE organization_id = $1 AND name LIKE $2 AND archived_at IS NULL`,
      [org, `${TYPE_PREFIX} %`],
    );
    await db.query(
      `UPDATE maintenance_task SET archived_at = now()
        WHERE organization_id = $1 AND title = $2 AND archived_at IS NULL`,
      [org, TASK_TITLE],
    );
  });
}

async function visit(page: Page, path: string): Promise<void> {
  try {
    await page.goto(path, { waitUntil: 'load' });
  } catch (error) {
    if (!String(error).includes('interrupted by another navigation')) throw error;
    await page.goto(path, { waitUntil: 'load' });
  }
  await page.locator('main').first().waitFor();
}

/** The page's Voltar — `BackLink` names its destination to assistive tech. */
function voltar(page: Page) {
  return page.locator('main').getByRole('link', { name: /^(voltar|back)\b/i }).first();
}

/** Follow a link and wait for the page it opens. */
async function follow(page: Page, selector: string): Promise<void> {
  const link = page.locator(selector).first();
  await expect(link).toBeVisible();
  /*
   * Wait for React to own the link before clicking it. On a page still
   * streaming in, WebKit takes a click on a link that has not hydrated, React
   * replays it after hydration, and the replay never navigates — a tap a person
   * makes a second later, but a robot makes at once.
   */
  await link.evaluate((el) =>
    new Promise<void>((done) => {
      const hydrated = () => Object.keys(el).some((key) => key.startsWith('__reactProps'));
      const check = () => (hydrated() ? done() : setTimeout(check, 50));
      check();
    }),
  );
  const href = await link.getAttribute('href');
  expect(href, 'every link into another page carries where it was followed from').toContain('from=');
  await link.click();
  // `commit`, not `load`: a client-side navigation fires no fresh load event,
  // and WebKit can sit waiting for one. The page's own `main` is the real signal.
  await page.waitForURL((url) => url.pathname === new URL(href!, url.origin).pathname, { waitUntil: 'commit' });
  await page.locator('main').first().waitFor();
}

/** The same page in the same state: path, and the query as a set — order is the router's. */
function samePlace(url: URL, expected: string): boolean {
  const want = new URL(expected, url.origin);
  if (url.pathname !== want.pathname) return false;
  const sorted = (q: URLSearchParams) => [...q.entries()].map(([k, v]) => `${k}=${v}`).sort().join('&');
  return sorted(url.searchParams) === sorted(want.searchParams);
}

/** Click Voltar and land on exactly the page and state it names. */
async function goBack(page: Page, expected: string): Promise<void> {
  await expect(voltar(page)).toBeVisible();
  await voltar(page).evaluate((el) =>
    new Promise<void>((done) => {
      const check = () =>
        Object.keys(el).some((key) => key.startsWith('__reactProps')) ? done() : setTimeout(check, 50);
      check();
    }),
  );
  await voltar(page).click();
  await page.waitForURL((url) => samePlace(url, expected), { waitUntil: 'commit' });
  await page.locator('main').first().waitFor();
}

for (const [width, viewport] of [['desk', DESK], ['phone', PHONE]] as const) {
  test.describe(`Voltar on a ${width}`, () => {
    test.use({ viewport });

    let at: Club;
    test.beforeAll(async () => {
      at = await club();
      await tidy(at);
    });
    test.afterAll(async () => {
      await tidy(at);
    });

    // Case 1 followed the dashboard's subscription card, which left the
    // dashboard on 28-10-2026 (Rui); Subscrição is reached from the profile only.

    test('2 · Profile → subscription, and Voltar returns to Profile', async ({ page }) => {
      await visit(page, '/dashboard/profile');
      await follow(page, 'main a[href^="/dashboard/profile/subscription"]');
      await goBack(page, '/dashboard/profile');
    });

    test('3 · the dashboard → Pedidos, and Voltar returns to the dashboard', async ({ page }) => {
      await seedLead(at);
      await visit(page, '/dashboard');
      await follow(page, 'main a[href^="/dashboard/students/pedidos"]');
      await goBack(page, '/dashboard');
    });

    test('4 · a site on Manutenção → a task, and Voltar returns to the same tab', async ({ page }) => {
      const taskId = await seedTask(at);
      const tab = `/dashboard/facilities/${at.facilityId}?tab=maintenance`;
      await visit(page, tab);
      await follow(page, `main a[href^="/dashboard/facilities/tasks/${taskId}"]`);
      await goBack(page, tab);
    });

    test('5 · Qualificações on Atenção, page 2 → a person, and Voltar returns to page 2', async ({ page }) => {
      await seedOverdue(at);
      const list = '/dashboard/facilities/staff/qualifications?section=attention&page=2';
      await visit(page, list);
      expect(samePlace(new URL(page.url()), list), `Atenção has no page 2: ${page.url()}`).toBe(true);
      await follow(page, 'main a[href^="/dashboard/facilities/staff/"][href*="tab=qualifications"]');
      await goBack(page, list);
    });

    test('6 · Staff from the menu has no Voltar; from a site it returns to the site', async ({ page }) => {
      await visit(page, '/dashboard/facilities/staff');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(voltar(page)).toHaveCount(0);

      const site = `/dashboard/facilities/${at.facilityId}`;
      await visit(page, site);
      await follow(page, 'main a[href^="/dashboard/facilities/staff"]');
      await goBack(page, site);
    });
  });
}
