import { expect, test, type Page } from '@playwright/test';
import {
  E2E_EMAIL,
  E2E_GUARDIAN_EMAIL,
  E2E_INSTRUCTOR_EMAIL,
  E2E_PASSWORD,
  GUARDIAN_SESSION,
  INSTRUCTOR_SESSION,
  NO_GUARDIAN,
  NO_INSTRUCTOR,
  NO_TEST_USER,
  PHONE_SESSION,
} from './session';
import { auditedReads, certificateFixture, CONTACT_FIRST, CONTACT_PHONE, type CertificateFixture } from './medical-certificate-fixture';

/**
 * Saúde e consentimentos — POOLSE-109, QA 1–4 in the browser.
 *
 * The owner finds the emergency contact by name and files Ana's atestado; the
 * coach is told it is attached and refused the file; the test guardian sends
 * one from app mode for Ana and is never offered Carla's leave; every download
 * is audited. Needs the storage container (S3Mock) and SENSITIVE_DATA_KEY.
 */

test.skip(E2E_EMAIL === undefined || E2E_PASSWORD === undefined, NO_TEST_USER);
test.setTimeout(90_000);
test.describe.configure({ mode: 'serial' });

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n', 'latin1');
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

let ids: CertificateFixture;
let officeFileId: string;
test.beforeAll(async () => {
  ids = await certificateFixture();
});

async function visit(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'load' });
  await page.locator('main').first().waitFor();
  await page.waitForFunction(() => document.readyState === 'complete');
}

test.describe('the office', () => {
  test.use({ storageState: PHONE_SESSION, viewport: { width: 1280, height: 900 } });

  test('QA 1 — the emergency contact is found by typing, with roles; clearing it brings the free fields back', async ({ page }) => {
    await visit(page, `/dashboard/students/${ids.anaId}/sensitive?tab=emergency`);
    const search = page.getByLabel(/^pessoa do clube$|^person in the club$/i);
    await expect(page.getByRole('combobox')).toHaveCount(0);
    await search.fill(CONTACT_FIRST.slice(0, 5));
    const option = page.getByRole('button', { name: new RegExp(CONTACT_FIRST) });
    await expect(option).toBeVisible({ timeout: 10_000 });
    await expect(option).toContainText(/encarregado de educação|guardian/i);
    await option.click();
    await expect(page.getByLabel(/^nome$|^name$/i)).toHaveCount(0);

    // Alterar takes the person away and offers the typed pair again.
    await page.getByRole('button', { name: /^alterar$|^change$/i }).click();
    await expect(page.getByLabel(/^nome$|^name$/i)).toBeVisible();
    await search.fill(CONTACT_FIRST);
    await page.getByRole('button', { name: new RegExp(CONTACT_FIRST) }).click();
    await page.getByLabel(/^relação$|^relationship$/i).fill('Tia');
    await page.getByRole('button', { name: /^guardar$|^save$/i }).click();
    await expect(page.getByText(/^guardado|^saved/i).first()).toBeVisible({ timeout: 10_000 });

    await visit(page, `/dashboard/students/${ids.anaId}/sensitive?tab=emergency`);
    await expect(page.locator('main')).toContainText(CONTACT_FIRST);
  });

  test('QA 2 — reception files a PDF atestado on the leave, and the office opens it', async ({ page }) => {
    await visit(page, `/dashboard/students/${ids.anaId}/sensitive?tab=leave`);
    // The leave is no longer folded (28-10-2026): nothing to open first.
    const row = page.locator('li').filter({ hasText: 'E2E · Lesão no pulso' });
    await expect(row.getByText(/cifrado|encrypted/i)).toBeVisible();
    await row.locator('input[type=file]').setInputFiles({ name: 'Atestado Ana.pdf', mimeType: 'application/pdf', buffer: PDF });
    await expect(row.getByText('Atestado Ana.pdf')).toBeVisible({ timeout: 15_000 });

    const link = row.getByRole('link', { name: /ver documento|view document/i });
    const href = (await link.getAttribute('href'))!;
    officeFileId = href.split('/').pop()!;
    const before = await auditedReads(officeFileId);
    const response = await page.request.get(href);
    expect(response.status()).toBe(200);
    expect((await response.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    // QA 4: that download is on the record.
    expect(await auditedReads(officeFileId)).toBe(before + 1);
  });
});

test.describe('the coach', () => {
  test.skip(E2E_INSTRUCTOR_EMAIL === undefined, NO_INSTRUCTOR);
  test.use({ storageState: INSTRUCTOR_SESSION, viewport: { width: 1280, height: 900 } });

  test('QA 2 — sees "atestado anexado" and the dates, never the file; the saved contact reads with its phone', async ({ page }) => {
    await visit(page, `/dashboard/students/${ids.anaId}/sensitive?tab=leave`);
    // The leave is no longer folded (28-10-2026): nothing to open first.
    const row = page.locator('li').filter({ hasText: 'E2E · Lesão no pulso' });
    await expect(row.getByText(/atestado anexado em \d{2}-\d{2}-\d{4}|certificate attached on \d{2}-\d{2}-\d{4}/i)).toBeVisible();
    await expect(row.getByText(/^\d{2}-\d{2}-\d{4} (a|to) \d{2}-\d{2}-\d{4}$/)).toBeVisible();
    await expect(row.getByText('Atestado Ana.pdf')).toHaveCount(0);
    await expect(row.getByRole('link')).toHaveCount(0);
    await expect(row.locator('input[type=file]')).toHaveCount(0);
    const before = await auditedReads(officeFileId);
    expect((await page.request.get(`/files/${officeFileId}`)).status()).toBe(403);
    expect(await auditedReads(officeFileId)).toBe(before);

    await visit(page, `/dashboard/students/${ids.anaId}/sensitive?tab=emergency`);
    await expect(page.locator('main')).toContainText(CONTACT_FIRST);
    await expect(page.locator('main')).toContainText(CONTACT_PHONE);
  });
});

test.describe('a guardian in the app', () => {
  test.skip(E2E_GUARDIAN_EMAIL === undefined, NO_GUARDIAN);
  test.use({ storageState: GUARDIAN_SESSION, viewport: { width: 360, height: 740 } });

  test('QA 3 — sends the atestado for their own child, and is never offered another child’s leave', async ({ page }) => {
    await visit(page, '/app/familia');
    const section = page.locator('section', { has: page.getByRole('heading', { name: /atestados médicos|medical certificates/i }) });
    await expect(section).toBeVisible();
    await expect(section.getByRole('listitem')).toHaveCount(1);
    await expect(section).toContainText(/Ana/);
    await expect(section).not.toContainText(/Carla/);
    await expect(section).not.toContainText('Lesão no pulso');
    // The office's file is already on Ana's leave.
    await expect(section.getByText(/atestado enviado em|certificate sent on/i)).toBeVisible();

    await section.locator('input[type=file]').setInputFiles({ name: 'atestado-foto.png', mimeType: 'image/png', buffer: PNG });
    const mine = section.getByRole('link', { name: /atestado-foto/ });
    await expect(mine).toBeVisible({ timeout: 15_000 });
    const response = await page.request.get((await mine.getAttribute('href'))!);
    expect(response.status()).toBe(200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  });
});
