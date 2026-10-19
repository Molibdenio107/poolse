import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { MessagesController } from '../messages/messages.controller.js';
import { ClosuresController } from '../classes/sessions.controller.js';
import { deliverMessage } from '../messages/delivery.js';
import { OwnEmailPreferenceController, PublicEmailPreferenceController } from './email-preferences.controller.js';
import type { Email } from './notifier.js';
import { actingAs, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * Opting out of a club's general messages — POOLSE-86, slice 3.0c.
 *
 * Rui's rule is the assertion that matters: **only general club messages** may
 * be stopped. A closure warning reaches an address that opted out, and carries
 * no link; a general message leaves it out, in the preview and in the send, and
 * says how many it left out.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

async function turmaOfTwo(tenant: ScratchTenant): Promise<string> {
  const [group] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_group (organization_id, season_id, facility_id, name)
     VALUES ($1, $2, $3, 'Golfinhos') RETURNING id`,
    [tenant.organizationId, tenant.seasonId, tenant.facilityId],
  );
  for (const [first, email] of [['Ana', 'ana.optout@example.test'], ['Jorge', 'jorge.optout@example.test']]) {
    const [student] = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name, contact_email)
       VALUES ($1, $2, 'Teste', $3::citext) RETURNING id`,
      [tenant.organizationId, first, email],
    );
    await tenant.sql(
      `INSERT INTO enrollment (organization_id, class_group_id, student_id, status) VALUES ($1, $2, $3, 'active')`,
      [tenant.organizationId, group!.id, student!.id],
    );
  }
  return group!.id;
}

function outbox(): { sent: Email[]; send: (email: Email) => Promise<boolean> } {
  const sent: Email[] = [];
  return { sent, send: async (email) => (sent.push(email), true) };
}

/** Send a general message and return what each address received. */
async function sendGeneral(tenant: ScratchTenant, groupId: string): Promise<Map<string, Email>> {
  const { id } = await new MessagesController().send({
    audience: 'class_group',
    targetId: groupId,
    subject: 'Festa de Natal',
    body: 'Sábado às 16h.',
    commit: true,
  });
  const box = outbox();
  await deliverMessage(tenant.organizationId, id!, box.send);
  return new Map(box.sent.map((email) => [email.to, email]));
}

const tokenOf = (email: Email): string => /\/email\/([A-Za-z0-9_-]{32,})/.exec(email.text)![1]!;

test('a general message carries the link; following it leaves the address out of the next one, and says so', async () => {
  await withScratchTenant(async (tenant) => {
    const groupId = await turmaOfTwo(tenant);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const first = await sendGeneral(tenant, groupId);
      const jorge = first.get('jorge.optout@example.test')!;
      assert.match(jorge.text, /deixar de receber as mensagens gerais/);
      const token = tokenOf(jorge);
      assert.notEqual(token, tokenOf(first.get('ana.optout@example.test')!), 'one token per address');

      const page = new PublicEmailPreferenceController();
      assert.deepEqual(await page.read(token), { clubName: tenant.name, locale: 'pt-PT', optedOut: false });
      assert.equal((await page.set(token, { optedOut: true })).optedOut, true);

      const preview = await new MessagesController().send({ audience: 'class_group', targetId: groupId });
      assert.equal(preview.addressCount, 1);
      assert.equal(preview.optedOutCount, 1, 'the confirmation says how many were left out');

      const second = await sendGeneral(tenant, groupId);
      assert.deepEqual([...second.keys()], ['ana.optout@example.test']);

      // The link opts back in, from the same page.
      assert.equal((await page.set(token, { optedOut: false })).optedOut, false);
      const third = await sendGeneral(tenant, groupId);
      assert.equal(third.size, 2);
    });
  });
});

test('a closure warning reaches an address that opted out, and carries no link', async () => {
  await withScratchTenant(async (tenant) => {
    const groupId = await turmaOfTwo(tenant);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const first = await sendGeneral(tenant, groupId);
      await new PublicEmailPreferenceController().set(tokenOf(first.get('jorge.optout@example.test')!), {
        optedOut: true,
      });

      await tenant.sql(
        `INSERT INTO class_session (organization_id, class_group_id, starts_at, duration_minutes, occurs_on)
         VALUES ($1, $2, (current_date + 10) + time '10:00', 45, current_date + 10)`,
        [tenant.organizationId, groupId],
      );
      const [day] = await tenant.sql<{ d: string }>(`SELECT to_char(current_date + 10, 'YYYY-MM-DD') AS d`);
      const { id: closureId } = await new ClosuresController().create({
        startsOn: day!.d,
        endsOn: day!.d,
        reason: 'Avaria na caldeira',
        facilityId: tenant.facilityId,
      });

      const messages = new MessagesController();
      const preview = await messages.send({ audience: 'closure', targetId: closureId });
      assert.equal(preview.addressCount, 2, 'a closure warning always goes');
      assert.equal(preview.optedOutCount, 0);

      const { id } = await messages.send({
        audience: 'closure',
        targetId: closureId,
        subject: 'Piscina encerrada',
        body: 'Não há aula.',
        commit: true,
      });
      const box = outbox();
      await deliverMessage(tenant.organizationId, id!, box.send);
      const jorge = box.sent.find((email) => email.to === 'jorge.optout@example.test');
      assert.ok(jorge, 'the opted-out address is warned of the closure');
      assert.doesNotMatch(jorge!.text, /\/email\//);
    });
  });
});

test('the link answers 404 to a token that is not one, and 400 to a body that is not a choice', async () => {
  const page = new PublicEmailPreferenceController();
  await expectStatus(() => page.read('x'.repeat(43)), 404);
  await expectStatus(() => page.read('not a token'), 404);
  await expectStatus(() => page.set('x'.repeat(43), { optedOut: true }), 404);
  await expectStatus(() => page.set('x'.repeat(43), { optedOut: 'yes' }), 400);
});

test("a member opts out of their own club's messages on the profile, per club", async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const mine = new OwnEmailPreferenceController();
      const before = await mine.read();
      assert.equal(before.optedOut, false);
      assert.notEqual(before.email, null);
      assert.equal((await mine.set({ optedOut: true })).optedOut, true);
      assert.equal((await mine.read()).optedOut, true);
      await expectStatus(() => mine.set({ optedOut: 'no' }), 400);
    });

    await withScratchTenant(async (other) => {
      await actingAs(other, { roles: ['owner'] }, async () => {
        assert.equal((await new OwnEmailPreferenceController().read()).optedOut, false, 'another club is asked separately');
      });
    });
  });
});
