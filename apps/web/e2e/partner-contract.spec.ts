import { expect, test, type Page } from '@playwright/test';
import {
  E2E_EMAIL,
  E2E_INSTRUCTOR_EMAIL,
  E2E_PASSWORD,
  INSTRUCTOR_SESSION,
  NO_INSTRUCTOR,
  NO_TEST_USER,
  PHONE_SESSION,
} from './session';
import { partnerContractFixture } from './partner-contract-fixture';

/**
 * A partnership's signed contract — POOLSE-105, QA 1–4.
 *
 * A partner with no agreement (reset each run): the contract goes up before
 * any terms, a .pptx is refused, a .docx downloads under its own name, a
 * replaced file is listed with who and when, and a coach downloads it with no
 * control to change it. Needs the storage container (S3Mock).
 */

test.skip(E2E_EMAIL === undefined || E2E_PASSWORD === undefined, NO_TEST_USER);
test.use({ storageState: PHONE_SESSION, viewport: { width: 1280, height: 900 } });
test.setTimeout(90_000);
test.describe.configure({ mode: 'serial' });

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n', 'latin1');
const zip = (part: string): Buffer =>
  Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]), Buffer.from(`....${part}<x/>`, 'latin1')]);
const DOCX = zip('word/document.xml');
const PPTX = zip('ppt/presentation.xml');
const WORD = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const DECK = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

let partnerId: string;
test.beforeAll(async () => {
  ({ partnerId } = await partnerContractFixture(E2E_EMAIL!));
});

async function visit(page: Page): Promise<void> {
  await page.goto(`/dashboard/facilities/partners/${partnerId}?tab=agreement`, { waitUntil: 'load' });
  await page.locator('main').first().waitFor();
  await page.waitForFunction(() => document.readyState === 'complete');
}

const picker = (page: Page) => page.locator('main input[type=file]');

test('QA 1 — a partner with no terms takes the contract, and says its terms are pending', async ({ page }) => {
  await visit(page);
  await expect(page.getByText(/ainda não há acordo registado|no agreement recorded yet/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /juntar documento|attach document/i })).toBeVisible();
  await expect(page.getByText(/pdf, word \(\.docx\) ou fotografia|a pdf, a word file/i)).toBeVisible();
  await expect(picker(page)).toHaveAttribute('accept', /\.docx/);

  await picker(page).setInputFiles({ name: 'Protocolo assinado.pdf', mimeType: 'application/pdf', buffer: PDF });
  await expect(page.getByText(/^termos por preencher$|^terms to be filled in$/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Protocolo assinado.pdf')).toBeVisible();
  await expect(page.getByRole('link', { name: /ver documento|view document/i })).toHaveAttribute('target', '_blank');
  await expect(page.getByRole('button', { name: /registar os termos|record the terms/i })).toBeVisible();
});

test('QA 2 — a .pptx is refused with a message; a .docx downloads with its name', async ({ page }) => {
  await visit(page);
  await picker(page).setInputFiles({ name: 'Apresentação.pptx', mimeType: DECK, buffer: PPTX });
  await expect(page.getByText(/word \(\.docx\) para contratos|word \(\.docx\) for contracts/i)).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText('Protocolo assinado.pdf')).toBeVisible();

  await picker(page).setInputFiles({ name: 'Contrato Escola 2026.docx', mimeType: WORD, buffer: DOCX });
  const link = page.getByRole('link', { name: /descarregar documento|download document/i });
  await expect(link).toBeVisible({ timeout: 15_000 });
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
  expect(download.suggestedFilename()).toBe('Contrato Escola 2026.docx');
});

test('QA 3 — the replaced contract is a previous version, with who and when', async ({ page }) => {
  await visit(page);
  const previous = page
    .locator('div', { has: page.getByRole('heading', { name: /versões anteriores|previous versions/i }) })
    .last()
    .getByRole('listitem');
  await expect(previous).toHaveCount(1);
  await expect(previous.first().getByRole('link', { name: 'Protocolo assinado.pdf' })).toBeVisible();
  // Who replaced it, and a dd-MM-yyyy date.
  await expect(previous.first()).toContainText(
    /deixou de estar em vigor em \d{2}-\d{2}-\d{4}.*, por \S+|superseded on \d{2}-\d{2}-\d{4}.* by \S+/i,
  );
});

test.describe('QA 4 — a coach', () => {
  test.skip(E2E_INSTRUCTOR_EMAIL === undefined, NO_INSTRUCTOR);
  test.use({ storageState: INSTRUCTOR_SESSION });

  test('downloads the contract and is offered no control and no terms', async ({ page }) => {
    await visit(page);
    await expect(
      page.getByText(/os termos e os preços são da secretaria|its terms and prices are for the office/i),
    ).toBeVisible();
    const link = page.getByRole('link', { name: /descarregar documento|download document/i });
    const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
    expect(download.suggestedFilename()).toBe('Contrato Escola 2026.docx');
    await expect(page.locator('main input[type=file]')).toHaveCount(0);
    await expect(
      page.locator('main').getByRole('button', { name: /substituir|replace|retirar|remove|juntar|attach/i }),
    ).toHaveCount(0);
    await expect(page.getByText(/^termos por preencher$|^terms to be filled in$/i)).toHaveCount(0);
  });
});
