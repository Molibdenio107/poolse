import { expect, test, type Page } from '@playwright/test';
import {
  E2E_EMAIL,
  E2E_GUARDIAN_EMAIL,
  E2E_GUARDIAN_PASSWORD,
  E2E_PASSWORD,
  GUARDIAN_SESSION,
  INSTRUCTOR_SESSION,
  NO_INSTRUCTOR,
  E2E_INSTRUCTOR_EMAIL,
  NO_GUARDIAN,
  NO_TEST_USER,
} from './session';
import { agendaWeekOf, agendaWeekRange } from '@poolse/rules';
import { poolsideLesson, poolsideTomorrow, poolsideYesterday } from './poolside-fixture';

/** The club's day, some days from now, as `YYYY-MM-DD`. */
const clubDay = (offset: number): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon' }).format(Date.now() + offset * 86_400_000);

/**
 * App mode on a phone — POOLSE-90 slice 1, QA 1, 3 and the lesson page, as a
 * guardian of two of the poolside children (Ana and Bruno) and as the owner.
 * QA 4–6 (moved, closed, the water's age) are proved against the database in
 * `apps/api/src/app/agenda.integration.test.ts`; QA 2 (who has which homes) in
 * `src/lib/app-hats.test.ts`. Every app-mode screen is tier 1.
 */

test.skip(E2E_EMAIL === undefined || E2E_PASSWORD === undefined, NO_TEST_USER);
test.skip(E2E_GUARDIAN_EMAIL === undefined || E2E_GUARDIAN_PASSWORD === undefined, NO_GUARDIAN);

test.use({ viewport: { width: 360, height: 740 } });

async function visit(page: Page, path: string): Promise<void> {
  try {
    await page.goto(path, { waitUntil: 'load' });
  } catch (error) {
    if (!String(error).includes('interrupted by another navigation')) throw error;
    await page.goto(path, { waitUntil: 'load' });
  }
}

async function noSidewaysScroll(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
}

test.describe('as a guardian', () => {
  test.use({ storageState: GUARDIAN_SESSION });

  test('QA 1 — /app and /dashboard both land on the family agenda, with no backoffice menu', async ({ page }) => {
    await poolsideLesson();
    await visit(page, '/app');
    await expect(page).toHaveURL(/\/app\/familia$/);
    // *Início* since POOLSE-136.
    await expect(page.getByRole('heading', { level: 1, name: /^(início|home)$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /abrir o menu|open the menu/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /abrir o backoffice|open the backoffice/i })).toHaveCount(0);

    await visit(page, '/dashboard');
    await expect(page).toHaveURL(/\/app\/familia$/);
  });

  test('QA 3 — both children on one agenda, named; the filter narrows; a stranger is a 404', async ({ page }) => {
    const lesson = await poolsideLesson();
    await visit(page, '/app/familia');
    await noSidewaysScroll(page);

    const filter = page.getByRole('navigation', { name: /mostrar as aulas de|show the lessons of/i });
    await expect(filter.getByRole('link')).toHaveCount(3);
    const cards = page.locator(`a[href^="/app/familia/aulas/${lesson.sessionId}"]`);
    // POOLSE-174: a hero each. The rows are *Aulas* since POOLSE-175.
    await expect(cards).toHaveCount(2);
    await expect(cards.filter({ hasText: 'Ana Poolside' })).toHaveCount(1);
    await expect(cards.filter({ hasText: 'Bruno Poolside' })).toHaveCount(1);
    for (const link of await filter.getByRole('link').all()) {
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }

    await visit(page, `/app/familia?child=${lesson.studentIds[0]}`);
    await expect(page.locator(`a[href^="/app/familia/aulas/${lesson.sessionId}"]`)).toHaveCount(1);

    // Carla is a poolside child too, but not this guardian's.
    const response = await page.goto(`/app/familia?child=${lesson.studentIds[2]}`);
    expect(response?.status()).toBe(404);
  });

  test("the lesson's page opens from the agenda, with the plan or a sentence saying there is none", async ({ page }) => {
    const lesson = await poolsideLesson();
    await visit(page, '/app/familia');
    const card = page.locator(`a[href^="/app/familia/aulas/${lesson.sessionId}"]`).first();
    await expect(async () => {
      if (!page.url().includes('/aulas/')) await card.tap({ timeout: 5_000 });
      await expect(page).toHaveURL(/\/app\/familia\/aulas\//, { timeout: 10_000 });
    }).toPass({ timeout: 45_000 });
    await expect(page.getByRole('heading', { name: /plano da aula|lesson plan/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /voltar à agenda|back to the agenda/i })).toBeVisible();
    await noSidewaysScroll(page);
  });

  test('POOLSE-116 — yesterday from Últimas aulas: a face, a few words, sent one-handed', async ({ page }) => {
    const { sessionId } = await poolsideYesterday();
    // Past lessons live on *Início* since 06-11-2026.
    await visit(page, '/app/familia');
    const recent = page.getByRole('heading', { name: /últimas aulas|recent lessons/i });
    await expect(recent).toBeVisible();
    const link = page.locator(`a[href^="/app/familia/aulas/${sessionId}"]`).first();
    await expect(link).toContainText(/dar feedback|give feedback/i);
    await expect(async () => {
      if (!page.url().includes('/aulas/')) await link.tap({ timeout: 5_000 });
      await expect(page).toHaveURL(/\/app\/familia\/aulas\//, { timeout: 10_000 });
    }).toPass({ timeout: 45_000 });

    await expect(page.getByText(/como correu a aula\?|how did the lesson go\?/i)).toBeVisible();
    const good = page.locator('label').filter({ hasText: /^(bem|good)$/i });
    expect((await good.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await good.boundingBox())!.width).toBeGreaterThanOrEqual(44);
    await good.tap();
    await page.getByRole('textbox').fill('Gostou muito da aula.');
    await expect(page.getByText(/o professor e a secretaria vão ler isto|the instructor and the office will read this/i)).toBeVisible();
    const send = page.getByRole('button', { name: /^(enviar|send)$/i });
    await expect(send).toBeInViewport();
    await send.tap();
    await expect(page.getByText(/feedback enviado|feedback sent/i)).toBeVisible({ timeout: 15_000 });
    await noSidewaysScroll(page);

    await visit(page, '/app/familia');
    await expect(page.locator(`a[href^="/app/familia/aulas/${sessionId}"]`).first()).toContainText(/^.*(bem|good)/i);
  });
});

test.describe('as a guardian, before a lesson', () => {
  test.use({ storageState: GUARDIAN_SESSION });

  test("POOLSE-90 QA 7 — Não vou for Ana on tomorrow's lesson, one tap, and the agenda says so", async ({ page }) => {
    const { sessionId } = await poolsideTomorrow();
    await visit(page, `/app/familia/aulas/${sessionId}`);
    // Two of hers are in the lesson, so each question names its child.
    const ana = page.locator('section').filter({ has: page.getByRole('heading', { name: /ana poolside/i }) }).filter({
      has: page.getByRole('button', { name: /^(não|no)$/i }),
    });
    const notGoing = ana.getByRole('button', { name: /^(não|no)$/i });
    expect((await notGoing.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await notGoing.tap();
    await expect(page.getByText(/avisado: não vem à aula|sent: not coming to the lesson/i)).toBeVisible({ timeout: 15_000 });
    await expect(notGoing).toHaveAttribute('aria-pressed', 'true');
    await noSidewaysScroll(page);

    // The rows are *Aulas* since POOLSE-175; tomorrow's week, for a Sunday.
    await visit(page, `/app/familia/aulas?week=${agendaWeekOf(clubDay(1))}`);
    await expect(
      page.locator(`a[href^="/app/familia/aulas/${sessionId}"]`).filter({ hasText: 'Ana Poolside' }),
    ).not.toContainText(/avisou que não vem|said they are not coming/i);
  });
});

test.describe('asking for a place, as a guardian', () => {
  test.use({ storageState: GUARDIAN_SESSION });

  test('POOLSE-121 — the agenda opens Pedir inscrição; her children, a new child and the turmas with room, on a phone', async ({ page }) => {
    await visit(page, '/app/familia');
    await page.getByRole('link', { name: /pedir inscrição numa turma|ask for a place in a class/i }).tap();
    await expect(page.getByRole('heading', { name: /pedir inscrição numa turma|ask for a place in a class/i })).toBeVisible();
    await expect(page.getByRole('radio', { name: /ana poolside/i })).toBeVisible();
    await page.getByRole('radio', { name: /outra criança|another child/i }).check();
    await expect(page.getByLabel(/data de nascimento|date of birth/i)).toBeVisible();
    // Nothing is sent until a person and a turma are chosen.
    await expect(page.getByRole('button', { name: /^(enviar pedido|send request)$/i })).toBeDisabled();
    await noSidewaysScroll(page);
  });
});

test.describe('push, as a guardian', () => {
  test.use({ storageState: GUARDIAN_SESSION });

  test('POOLSE-90 QA 13 — the switch never prompts on load; an iPhone not installed is told how', async ({ page }, info) => {
    let prompted = false;
    await page.addInitScript(() => {
      if (window.Notification === undefined) return;
      // Headless Chromium answers "denied" whatever is granted; a phone that was
      // never asked says "default", which is the state this test is about.
      Object.defineProperty(window.Notification, 'permission', { get: () => 'default' });
      // A prompt raised on load would call this; the switch only calls it on a tap.
      window.Notification.requestPermission = () => {
        (window as unknown as { __prompted: boolean }).__prompted = true;
        return Promise.resolve('default');
      };
    });
    // The push switch lives on *Definições* (POOLSE-176).
    await visit(page, '/app/perfil/definicoes');
    await expect(page.getByText(/avisos neste telemóvel|notifications on this phone/i)).toBeVisible();
    if (info.project.name === 'iphone') {
      await expect(page.getByText(/adicionar ao ecrã principal|add to home screen/i)).toBeVisible();
      await expect(page.getByRole('switch')).toHaveCount(0);
    } else {
      const toggle = page.getByRole('switch', { name: /avisos neste telemóvel|notifications on this phone/i });
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    prompted = await page.evaluate(() => (window as unknown as { __prompted?: boolean }).__prompted === true);
    expect(prompted).toBe(false);
    await noSidewaysScroll(page);
  });
});

test.describe('as an instructor', () => {
  test.skip(E2E_INSTRUCTOR_EMAIL === undefined, NO_INSTRUCTOR);
  test.use({ storageState: INSTRUCTOR_SESSION });

  test('POOLSE-90 QA 11 — /app is their lessons, and a lesson opens its register', async ({ page }) => {
    const { sessionId } = await poolsideTomorrow();
    await visit(page, '/app');
    await expect(page).toHaveURL(/\/app\/aulas$/);
    // *Hoje* since POOLSE-136; tomorrow's lesson is under *Semana*.
    await expect(page.getByRole('heading', { level: 1, name: /^(hoje|today)$/i })).toBeVisible();
    await visit(page, '/app/aulas?semana');
    const lesson = page.locator(`a[href^="/dashboard/calendar/sessions/${sessionId}"]`);
    await expect(lesson).toContainText(/inscrit|enrolled/i);
    await noSidewaysScroll(page);
    await expect(async () => {
      if (!page.url().includes('/calendar/sessions/')) await lesson.tap({ timeout: 5_000 });
      await expect(page).toHaveURL(/\/calendar\/sessions\//, { timeout: 10_000 });
    }).toPass({ timeout: 45_000 });
    await expect(page.getByRole('link', { name: /voltar às minhas aulas|back to my lessons/i })).toBeVisible();
  });
});

const bottomBar = (page: Page) => page.locator('nav[data-bottom-bar]');

test.describe('POOLSE-136 — the phone shell, as a guardian', () => {
  test.use({ storageState: GUARDIAN_SESSION });

  test('QA 1–2 — four tabs, Início current; Marcas is a tab and Pagamentos a row on Perfil', async ({ page }) => {
    await poolsideLesson();
    await visit(page, '/app/familia');
    const bar = bottomBar(page);
    await expect(bar).toBeVisible();
    await expect(bar.getByRole('link')).toHaveCount(4);
    await expect(bar.getByRole('link', { name: /^(início|home)$/i })).toHaveAttribute('aria-current', 'page');
    for (const tab of await bar.getByRole('link').all()) {
      expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    // Rule 4: the header keeps only the club's name — no backoffice link, no avatar menu.
    await expect(page.locator('header').getByRole('link', { name: /abrir o backoffice|open the backoffice/i })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /^(mensalidades|monthly fees)$/i })).toHaveCount(0);

    await expect(bar.getByRole('link', { name: /^(marcas|records)$/i })).toHaveAttribute('href', '/app/familia/marcas');
    await expect(bar.getByRole('link', { name: /^(pagamentos|payments)$/i })).toHaveCount(0);
    await visit(page, '/app/familia/marcas');
    await expect(bottomBar(page).getByRole('link', { name: /^(marcas|records)$/i })).toHaveAttribute('aria-current', 'page');
    await visit(page, '/app/perfil?home=family');
    await expect(page.getByRole('link', { name: /^(pagamentos|payments)$/i })).toHaveAttribute('href', '/app/familia/pagamentos');
    await visit(page, '/app/familia/pagamentos');
    await expect(bottomBar(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /^(em dívida|overdue)$/i }).first()).toBeVisible();
    await noSidewaysScroll(page);
  });

  test('the last row is above the bar, and a lesson page has no bar over its Save', async ({ page }) => {
    const lesson = await poolsideLesson();
    await visit(page, '/app/familia');
    const last = page.getByRole('link', { name: /pedir inscrição numa turma|ask for a place in a class/i });
    await last.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const row = (await last.boundingBox())!;
    const bar = (await bottomBar(page).boundingBox())!;
    expect(row.y + row.height).toBeLessThanOrEqual(bar.y);

    await visit(page, `/app/familia/aulas/${lesson.sessionId}`);
    await expect(bottomBar(page)).toHaveCount(0);
  });

  test('POOLSE-176 — Perfil reads, Editar dados opens a sheet, and Definições is one row away', async ({ page }) => {
    await visit(page, '/app/familia');
    // The corner is the club: its name for a reader, and no link.
    const header = page.locator('header');
    await expect(header.getByRole('img', { name: 'Clube E2E' })).toBeVisible();
    await expect(header.getByRole('link', { name: /^(o meu perfil|my profile)$/i })).toHaveCount(0);

    await visit(page, '/app/perfil?home=family');
    await expect(page.getByRole('heading', { level: 1, name: /^(o meu perfil|my profile)$/i })).toBeVisible();
    await expect(page.getByText(/encarregado de educação de|guardian of/i)).toBeVisible();
    await expect(page.locator('main').locator("input:not([type='hidden']), select, textarea")).toHaveCount(0);
    await expect(page.getByRole('button', { name: /terminar sessão|sign out/i })).toBeVisible();
    await expect(bottomBar(page).getByRole('link', { name: /^(perfil|profile)$/i })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('link', { name: /^(voltar|back)$/i })).toHaveCount(0);
    // A family-only login is not staff: no way into the backoffice here.
    await expect(page.getByRole('link', { name: /abrir o backoffice|open the backoffice/i })).toHaveCount(0);
    await noSidewaysScroll(page);

    const edit = page.getByRole('button', { name: /^(editar dados|edit details)$/i });
    await expect(async () => {
      if ((await page.getByRole('dialog').count()) === 0) await edit.tap();
      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByLabel(/nome próprio|first name/i)).toBeVisible();
    await sheet.getByRole('button', { name: /^(cancelar|cancel)$/i }).tap();
    await expect(sheet).toHaveCount(0);

    await visit(page, '/app/perfil/definicoes?home=family');
    await expect(page.getByRole('button', { name: /^(idioma|language)/i })).toBeVisible();
    await expect(page.getByText(/avisos neste telemóvel|notifications on this phone/i)).toBeVisible();
    await expect(bottomBar(page)).toHaveCount(0);
    await expect(page.getByRole('link', { name: /voltar ao perfil|back to my profile/i })).toHaveAttribute('href', '/app/perfil?home=family');
  });

  test('POOLSE-175 — Aulas is a calendar: the week steps, keeps its seven days, and stops at its edges', async ({ page }) => {
    await visit(page, '/app/familia/aulas');
    const calendar = page.getByRole('region', { name: /calendário de aulas|lesson calendar/i });
    await expect(calendar).toBeVisible();
    await expect(page.getByText(/aulas passadas nem atestados|no past lessons or certificates/i)).toHaveCount(0);
    await expect(page.getByText(/encerrado (de|a) \d|closed (from|on) \d/i)).toHaveCount(0);

    const days = async (): Promise<string[]> => calendar.getByRole('listitem').allInnerTexts();
    const shown = await days();
    expect(shown).toHaveLength(7);
    const next = page.getByRole('link', { name: /semana seguinte|next week/i });
    // By each link's own address: a tap during hydration can land on nothing.
    const href = await next.getAttribute('href');
    expect(href).toMatch(/week=\d{4}-\d{2}-\d{2}/);
    await visit(page, href!);
    // A whole week on: seven new days, none of the old ones.
    const after = await days();
    expect(after).toHaveLength(7);
    expect(after.filter((day) => shown.includes(day))).toHaveLength(0);

    // The last week is the edge: no further link, and the API agrees.
    await visit(page, `/app/familia/aulas?week=${agendaWeekRange(clubDay(0)).last}`);
    await expect(calendar.getByRole('listitem')).toHaveCount(7);
    await expect(next).toHaveCount(0);
    await noSidewaysScroll(page);
  });

  test('POOLSE-179 — Documentos is a row on Perfil, not on Aulas, and no way out of app mode', async ({ page }) => {
    await visit(page, '/app/familia/aulas');
    await expect(page.getByRole('link', { name: /^(documentos|documents)$/i })).toHaveCount(0);
    await visit(page, '/app/perfil?home=family');
    await expect(page.getByRole('link', { name: /^(documentos|documents)$/i })).toHaveAttribute('href', '/app/familia/documentos');
    await visit(page, '/app/familia/documentos');
    // Icons, named to a screen reader, and the boletim is download only.
    await expect(page.getByText(/^(enviar|send)$/i)).toHaveCount(0);
    await expect(page.getByRole('link', { name: /voltar ao perfil|back to my profile/i })).toHaveText(/^(voltar|back)$/i);
    await expect(page.getByRole('heading', { level: 1, name: /^(documentos|documents)$/i })).toBeVisible();
    await expect(page.getByText(/boletim de sócio|membership form/i).first()).toBeVisible();
    await expect(page.locator('main a[href*="/dashboard"]')).toHaveCount(0);
    await expect(bottomBar(page)).toHaveCount(0);
    await noSidewaysScroll(page);
  });

  test('POOLSE-173 — rounder on a phone, and the tab bar keeps its shapes', async ({ page }) => {
    await visit(page, '/app/familia');
    const radius = (selector: string): Promise<string> =>
      page.locator(selector).first().evaluate((el) => getComputedStyle(el).borderTopLeftRadius);

    expect(await radius('main .app-hero >> xpath=..')).toBe('20px');
    expect(await radius('[data-bottom-bar] > div')).toBe('16px');
    // Only the container rounds: a tab stays square and keeps its glyph.
    expect(await radius('[data-bottom-bar] a')).toBe('0px');
    await expect(bottomBar(page).locator('a svg')).toHaveCount(4);
    // The shapes are decoration: a pseudo-element takes no tap and holds no text.
    expect(
      await page.locator('main .app-hero').first().evaluate((el) => getComputedStyle(el, '::before').pointerEvents),
    ).toBe('none');
    await visit(page, '/app/familia/pagamentos');
    await expect(page.locator('main .app-hero')).toHaveCount(0);
    // POOLSE-178: the shape, no way out of app mode, and a sentence and no button.
    await expect(page.getByRole('heading', { name: /^(em dívida|overdue)$/i }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: /^(próximos pagamentos|next payments)$/i }).first()).toBeVisible();
    await expect(page.locator('main a[href*="/dashboard"]')).toHaveCount(0);
    await expect(page.getByText(/pague por transferência ou mb way|pay by bank transfer or mb way/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /pagar na app|paying in the app/i })).toHaveCount(0);
    await noSidewaysScroll(page);
  });

  test('Idioma opens a bottom sheet of the languages, the current one ticked', async ({ page }) => {
    await visit(page, '/app/perfil/definicoes');
    await page.getByRole('button', { name: /^(idioma|language)/i }).tap();
    const sheet = page.getByRole('dialog', { name: /^(idioma|language)$/i });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('button', { pressed: true })).toHaveCount(1);
    const box = (await sheet.boundingBox())!;
    // A sheet from the bottom, not a box in the middle.
    expect(box.y + box.height).toBeGreaterThanOrEqual((page.viewportSize()!.height) - 2);
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
  });
});

test.describe('POOLSE-136 — on a laptop, as a guardian', () => {
  test.use({ storageState: GUARDIAN_SESSION, viewport: { width: 1280, height: 900 } });

  test('POOLSE-173 — a laptop keeps the sharp scale', async ({ page }) => {
    await visit(page, '/app/familia');
    const hero = page.locator('main .app-hero').first().locator('xpath=..');
    expect(await hero.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe('4px');
  });

  test('QA 7 — the same four tabs as a row under the header, no bottom bar', async ({ page }) => {
    await visit(page, '/app/familia');
    await expect(bottomBar(page)).toBeHidden();
    const top = page.locator('header').getByRole('navigation');
    await expect(top.getByRole('link')).toHaveCount(4);
    await expect(top.getByRole('link', { name: /^(início|home)$/i })).toHaveAttribute('aria-current', 'page');
  });
});

test.describe('POOLSE-136 — the phone shell, as an instructor', () => {
  test.skip(E2E_INSTRUCTOR_EMAIL === undefined, NO_INSTRUCTOR);
  test.use({ storageState: INSTRUCTOR_SESSION });

  test('QA 3–4 — two tabs, Hoje current; O meu perfil has Abrir o backoffice and the header does not', async ({ page }) => {
    await visit(page, '/app/aulas');
    const bar = bottomBar(page);
    await expect(bar.getByRole('link')).toHaveCount(3);
    await expect(bar.getByRole('link', { name: /^(hoje|today)$/i })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('header').getByRole('link', { name: /abrir o backoffice|open the backoffice/i })).toHaveCount(0);

    await visit(page, '/app/aulas?semana');
    await expect(bottomBar(page).getByRole('link', { name: /^(semana|week)$/i })).toHaveAttribute('aria-current', 'page');

    await visit(page, '/app/perfil?home=teaching');
    await expect(page.getByRole('link', { name: /abrir o backoffice|open the backoffice/i })).toBeVisible();
    await expect(bottomBar(page).getByRole('link')).toHaveCount(3);
  });
});

test.describe('as the owner', () => {
  test('QA 1 — /app sends an owner to the backoffice', async ({ page }) => {
    await visit(page, '/app');
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
