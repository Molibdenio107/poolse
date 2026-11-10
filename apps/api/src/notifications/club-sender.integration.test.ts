import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { closeHarness, withScratchTenant, type ScratchTenant } from '../test/harness.js';
import { addressing, clubEmail, clubIdentity, headerSafeName, withClubPhone } from './notifier.js';

/**
 * POOLSE-209 — a club's email leaves under the club's name, from Poolse's own
 * address, with Reply-To the club's email (or the owner's until one is set).
 * Poolse's own mail stays Poolse's. A club's name never reaches a header raw.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

const owner = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 2 });
after(() => owner.end());

async function sql<T extends pg.QueryResultRow>(text: string, values: unknown[]): Promise<T[]> {
  return (await owner.query<T>(text, values)).rows;
}

async function ownerEmail(tenant: ScratchTenant): Promise<string> {
  const [row] = await sql<{ email: string }>(
    `SELECT u.cached_email AS email FROM app_user u JOIN membership m ON m.app_user_id = u.id WHERE m.id = $1`,
    [tenant.ownerMembershipId],
  );
  return row!.email;
}

test('with no reply email set, replies go to the owner (QA 3)', async () => {
  await withScratchTenant(async (tenant) => {
    const identity = await clubIdentity(tenant.organizationId);
    assert.equal(identity?.name, tenant.name);
    assert.equal(identity?.replyTo, await ownerEmail(tenant));
  });
});

test("a club's email leaves under its name with Reply-To its email (QA 2)", async () => {
  await withScratchTenant(async (tenant) => {
    await sql('UPDATE organization SET reply_email = $2 WHERE id = $1', [tenant.organizationId, 'secretaria@clube.pt']);
    const { from, replyTo } = addressing(await clubIdentity(tenant.organizationId));
    assert.equal(replyTo, 'secretaria@clube.pt');
    assert.ok(from.startsWith(`"${headerSafeName(tenant.name)}" <`), from);
    assert.ok(from.endsWith('>'), from);
  });
});

test("Poolse's own email keeps Poolse's sender and no Reply-To", () => {
  const { from, replyTo } = addressing(null);
  assert.equal(replyTo, null);
  assert.ok(!from.includes('"'), 'not wrapped as a club name');
});

test('a club name cannot inject a header (QA 6)', () => {
  const name = headerSafeName('Clube "X"\r\nBcc: a@b.c <evil>\\');
  assert.ok(!/[\r\n"<>\\]/.test(name), name);
  assert.equal(name, 'Clube X Bcc: a@b.c evil');
  assert.equal(headerSafeName('\r\n'), 'Poolse', 'an empty name falls back');
  assert.equal(headerSafeName('A'.repeat(200)).length, 70, 'capped');
});

test('clubEmail stamps the club, and nothing else', () => {
  const email = { to: 'a@b.c', subject: 's', text: 't', html: 'h' };
  assert.deepEqual(clubEmail('org-1', email), { ...email, organizationId: 'org-1' });
});

test('the database refuses a malformed reply or billing email', async () => {
  await withScratchTenant(async (tenant) => {
    await assert.rejects(
      sql('UPDATE organization SET reply_email = $2 WHERE id = $1', [tenant.organizationId, 'not an email']),
      /organization_reply_email_format/,
    );
    await assert.rejects(
      sql('UPDATE organization SET billing_email = $2 WHERE id = $1', [tenant.organizationId, 'x@y']),
      /organization_billing_email_format/,
    );
  });
});

test('a published club phone closes every club email, in its language (POOLSE-210)', async () => {
  await withScratchTenant(async (tenant) => {
    const email = { to: 'a@b.c', subject: 's', text: 'corpo', html: '<p>corpo</p>' };
    assert.deepEqual(withClubPhone(email, await clubIdentity(tenant.organizationId)), email, 'none published: unchanged');

    await sql('UPDATE organization SET contact_phone = $2, locale = $3 WHERE id = $1', [tenant.organizationId, '+351212345678', 'pt-PT']);
    const signed = withClubPhone(email, await clubIdentity(tenant.organizationId));
    assert.equal(signed.text, 'corpo\nTelefone do clube: +351 212 345 678');
    assert.ok(signed.html.endsWith('Telefone do clube: +351 212 345 678</p>'));

    await sql('UPDATE organization SET locale = $2 WHERE id = $1', [tenant.organizationId, 'en']);
    assert.ok(withClubPhone(email, await clubIdentity(tenant.organizationId)).text.endsWith('Club phone: +351 212 345 678'));
    assert.deepEqual(withClubPhone(email, null), email, "Poolse's own mail: unchanged");
  });
});

test('the database refuses a club phone that is not + and digits (POOLSE-210)', async () => {
  await withScratchTenant(async (tenant) => {
    for (const bad of ['912345678', '+351 912 345 678', '+12', 'ligue']) {
      await assert.rejects(
        sql('UPDATE organization SET contact_phone = $2 WHERE id = $1', [tenant.organizationId, bad]),
        /organization_contact_phone_format/,
        bad,
      );
    }
  });
});
