import { expect, test } from '@playwright/test';
import { E2E_EMAIL, E2E_PASSWORD, NO_TEST_USER, PHONE_SESSION } from './session';
import { INVITED_EMAIL, invitationFixture } from './invitation-fixture';

/**
 * An invitation is read before an account exists, and accepted only with one —
 * 29-10-2026. Signed out: the club, the roles and the address, and *Criar conta*
 * / *Entrar* returning to the same link with the address seeded; no Voltar.
 * Signed in as somebody else: the page says so and offers *Terminar sessão e
 * continuar* first. Neither test accepts, so the invitation stays pending.
 */

test.skip(E2E_EMAIL === undefined || E2E_PASSWORD === undefined, NO_TEST_USER);

let token: string;
let club: string;
test.beforeAll(async () => {
  ({ token, club } = await invitationFixture(E2E_EMAIL!));
});

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('the invitation reads with no account, and the account links come back to it', async ({ page }) => {
    await page.goto(`/join?token=${encodeURIComponent(token)}`, { waitUntil: 'load' });
    await expect(page.getByText(club).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(INVITED_EMAIL).first()).toBeVisible();
    await expect(page.getByText(/^aluno$|^student$/i).first()).toBeVisible();

    const signUp = page.getByRole('link', { name: /^criar conta$|^sign up$/i });
    const href = decodeURIComponent((await signUp.getAttribute('href'))!);
    expect(href).toContain(`redirect_url=/join?token=${token}`);
    expect(href).toContain(`email=${INVITED_EMAIL}`);
    await expect(page.getByRole('link', { name: /^entrar$|^sign in$/i })).toHaveAttribute('href', /redirect_url=/);

    await expect(page.getByRole('link', { name: /voltar|back/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /aceitar|accept/i })).toHaveCount(0);
  });
});

test.describe('signed in as somebody else', () => {
  test.use({ storageState: PHONE_SESSION });

  test('the page names both addresses and offers to sign out first', async ({ page }) => {
    await page.goto(`/join?token=${encodeURIComponent(token)}`, { waitUntil: 'load' });
    const warning = page.getByText(/foi enviado para|was sent to/i);
    await expect(warning).toBeVisible({ timeout: 30_000 });
    await expect(warning).toContainText(INVITED_EMAIL);
    await expect(warning).toContainText(E2E_EMAIL!);
    await expect(page.getByRole('button', { name: /^terminar sessão e continuar$|^sign out and continue$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^aceitar com |^accept as /i })).toBeVisible();
  });
});
