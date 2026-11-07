import { expect, test, type Page } from '@playwright/test';
import { Client } from 'pg';
import { E2E_MAINTENANCE_EMAIL, E2E_MAINTENANCE_PASSWORD, MAINTENANCE_SESSION, NO_MAINTENANCE } from './session';

/**
 * The maintenance home in the phone shell — POOLSE-181, QA 1 to 3, as a login
 * that holds the maintenance role and nothing else. QA 4 (an instructor is
 * refused) is the API's, in the role probe.
 *
 * Each run makes its own task and archives that one afterwards, by id: a task
 * done today is not due again for a week, so it could not be found again.
 */

test.skip(E2E_MAINTENANCE_EMAIL === undefined || E2E_MAINTENANCE_PASSWORD === undefined, NO_MAINTENANCE);

test.use({ storageState: MAINTENANCE_SESSION, viewport: { width: 360, height: 740 } });

async function withDb<T>(work: (db: Client) => Promise<T>): Promise<T> {
  const url = process.env['DATABASE_URL'];
  if (url === undefined) throw new Error('DATABASE_URL is not set — run with --env-file=../../.env');
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    return await work(db);
  } finally {
    await db.end();
  }
}

async function makeTask(title: string): Promise<string> {
  return withDb(async (db) => {
    const site = await db.query<{ organization_id: string; id: string }>(
      `SELECT f.organization_id, f.id
         FROM facility f
         JOIN membership m ON m.organization_id = f.organization_id AND m.archived_at IS NULL
         JOIN app_user u ON u.id = m.app_user_id
        WHERE lower(u.cached_email) = lower($1) AND f.archived_at IS NULL
        ORDER BY f.created_at LIMIT 1`,
      [E2E_MAINTENANCE_EMAIL],
    );
    const { organization_id: org, id: facility } = site.rows[0]!;
    const task = await db.query<{ id: string }>(
      `INSERT INTO maintenance_task (organization_id, facility_id, title, interval_days)
       VALUES ($1, $2, $3, 7) RETURNING id`,
      [org, facility, title],
    );
    return task.rows[0]!.id;
  });
}

async function archiveTask(id: string): Promise<void> {
  await withDb((db) => db.query(`UPDATE maintenance_task SET archived_at = now() WHERE id = $1`, [id]));
}

async function open(page: Page, path: string): Promise<void> {
  // A one-tap action's refresh can still be landing; WebKit reports it as an interruption.
  await expect(async () => {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
  }).toPass({ timeout: 25_000 });
  await page.locator('main').first().waitFor();
}

/** A tap that lands before hydration opens nothing, so it is retried. */
async function openSheet(page: Page, name: RegExp): Promise<void> {
  const row = page.getByRole('button', { name });
  await expect(async () => {
    if ((await page.getByRole('dialog').count()) === 0) await row.tap();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

test('QA 1 — Hoje wears the bar and the club, and Perfil opens the shared profile', async ({ page }) => {
  await open(page, '/app');
  await page.waitForURL(/\/app\/manutencao$/);
  await expect(page.getByText('Clube E2E').first()).toBeVisible();

  const bar = page.getByRole('navigation').last();
  await expect(bar.getByRole('link')).toHaveCount(3);
  await expect(bar.getByRole('link', { name: 'Hoje' })).toBeVisible();
  await expect(bar.getByRole('link', { name: 'Registar' })).toBeVisible();

  await open(page, '/app/perfil?home=maintenance');
  await expect(page.getByRole('navigation').last().getByRole('link')).toHaveCount(3);
  await expect(page.getByRole('link', { name: /definições/i })).toBeVisible();
});

test('QA 2 — Registar › Concluir tarefa lists it, and done, it leaves Hoje', async ({ page }) => {
  const title = `E2E · Tarefa ${Date.now()}`;
  const taskId = await makeTask(title);
  try {
    await open(page, '/app/manutencao/registar');
    await openSheet(page, /concluir tarefa/i);
    const sheet = page.getByRole('dialog');
    const row = sheet.getByRole('listitem').filter({ hasText: title });
    await expect(row).toBeVisible();
    await row.getByRole('button').tap();
    await expect(page.getByRole('status').filter({ hasText: /tarefa concluída|task completed|task done/i })).toBeVisible();

    await open(page, '/app/manutencao');
    await expect(page.getByText(title)).toHaveCount(0);
  } finally {
    await archiveTask(taskId);
  }
});

test('QA 3 — Reportar keeps the bar, and Voltar returns to Registar', async ({ page }) => {
  await open(page, '/app/manutencao/registar');
  const report = page.getByRole('link', { name: /reportar avaria/i });
  const href = await report.getAttribute('href');
  expect(href).toBe('/app/manutencao/reportar?from=registar');

  await open(page, href!);
  // The menu stays on every screen (Rui, 06-11-2026, reversing POOLSE-181's QA 3).
  await expect(page.getByRole('link', { name: 'Registar', exact: true })).toBeVisible();

  const back = page.getByRole('link', { name: /voltar a registar/i });
  await expect(back).toHaveAttribute('href', '/app/manutencao/registar');
  await open(page, (await back.getAttribute('href'))!);
  await expect(page.getByRole('heading', { level: 1, name: 'Registar' })).toBeVisible();
});
