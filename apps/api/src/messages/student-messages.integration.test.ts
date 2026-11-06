import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { MessagesController } from './messages.controller.js';
import { AppAvisosController, AvisosController } from './avisos.controller.js';
import { StudentMessagesController } from './student-messages.controller.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * POOLSE-191 — a message to one student, by email or WhatsApp, and an aviso by
 * a tick.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

const owner = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 1 });
after(async () => {
  await owner.end();
  await closeHarness();
});

const tab = new StudentMessagesController();
const words = { subject: 'Exame médico', body: 'Lembrete: faça o exame até sexta.' };

async function addStudent(tenant: ScratchTenant, first: string, email: string | null, phone: string | null = null): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name, birth_date, contact_email, contact_phone)
     VALUES ($1, $2, 'Silva', '1990-01-01', $3, $4) RETURNING id`,
    [tenant.organizationId, first, email, phone],
  );
  return row!.id;
}

async function addGuardian(tenant: ScratchTenant, student: string, first: string, email: string, phone: string | null, primary = true): Promise<string> {
  const guardian = await addMember(tenant, first, 'Silva', ['guardian']);
  await owner.query(`UPDATE membership SET email = $2, phone = $3 WHERE id = $1`, [guardian, email, phone]);
  await tenant.sql(
    `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary)
     VALUES ($1, $2, $3, 'Mãe', $4)`,
    [tenant.organizationId, student, guardian, primary],
  );
  return guardian;
}

async function addTurma(tenant: ScratchTenant, instructor: string, student: string): Promise<string> {
  const [group] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_group (organization_id, season_id, facility_id, name, instructor_membership_id)
     VALUES ($1, $2, $3, 'Turma ' || gen_random_uuid(), $4) RETURNING id`,
    [tenant.organizationId, tenant.seasonId, tenant.facilityId, instructor],
  );
  await tenant.sql(
    `INSERT INTO enrollment (organization_id, class_group_id, student_id, status, joined_on)
     VALUES ($1, $2, $3, 'active', club_today() - 10)`,
    [tenant.organizationId, group!.id, student],
  );
  return group!.id;
}

const asOwner = <T>(tenant: ScratchTenant, fn: () => Promise<T>): Promise<T> => actingAs(tenant, { roles: ['owner'] }, fn);

test('QA 1, 2: a minor reaches both guardians, named first; an adult reaches themselves', async () => {
  await withScratchTenant(async (tenant) => {
    const child = await addStudent(tenant, 'Alice', 'alice@x.pt');
    await addGuardian(tenant, child, 'Marta', 'marta@x.pt', '912345678');
    await addGuardian(tenant, child, 'Pedro', 'pedro@x.pt', null, false);
    await asOwner(tenant, async () => {
      const { recipients } = await tab.list(child);
      assert.deepEqual(recipients.map((one) => [one.isGuardian, one.hasEmail, one.hasPhone]), [
        [true, true, true],
        [true, true, false],
      ]);
      await tab.send(child, { channel: 'email', ...words });
    });
    const rows = await tenant.sql<{ email: string }>(
      `SELECT mr.email::text AS email FROM message_recipient mr JOIN message m ON m.id = mr.message_id
        WHERE m.student_id = $1 ORDER BY 1`,
      [child],
    );
    assert.deepEqual(rows.map((one) => one.email), ['marta@x.pt', 'pedro@x.pt']);

    const adult = await addStudent(tenant, 'Rui', 'rui@x.pt');
    await asOwner(tenant, async () => {
      await tab.send(adult, { channel: 'email', ...words });
      assert.equal((await tab.list(adult)).messages[0]!.recipients.length, 1);
    });
  });
});

test('QA 3: nobody to reach is said, and nothing is written', async () => {
  await withScratchTenant(async (tenant) => {
    const nobody = await addStudent(tenant, 'Rui', null);
    await asOwner(tenant, async () => {
      assert.equal((await tab.list(nobody)).recipients[0]!.hasEmail, false);
      await expectStatus(() => tab.send(nobody, { channel: 'email', ...words }), 409);
      await expectStatus(() => tab.send(nobody, { channel: 'whatsapp', ...words }), 409);
    });
    assert.equal((await tenant.sql('SELECT 1 FROM message WHERE student_id = $1', [nobody])).length, 0);
  });
});

test('QA 4: an opted-out address still gets it, with no way out in the mail', async () => {
  await withScratchTenant(async (tenant) => {
    const adult = await addStudent(tenant, 'Rui', 'rui@x.pt');
    await tenant.sql(
      `INSERT INTO email_preference (organization_id, email, token, messages_opted_out_at)
       VALUES ($1, 'rui@x.pt', repeat('a', 40), now())`,
      [tenant.organizationId],
    );
    await asOwner(tenant, () => tab.send(adult, { channel: 'email', ...words }));
    const [row] = await tenant.sql<{ n: string }>(
      `SELECT count(*) AS n FROM message_recipient mr JOIN message m ON m.id = mr.message_id
        WHERE m.student_id = $1 AND mr.email = 'rui@x.pt'`,
      [adult],
    );
    assert.equal(row!.n, '1');
    const { findDelivery } = await import('./messages.repository.js');
    const [message] = await tenant.sql<{ id: string }>('SELECT id FROM message WHERE student_id = $1', [adult]);
    assert.equal((await findDelivery(tenant.organizationId, message!.id))!.optOutAllowed, false);
  });
});

test('QA 5: it shows on the tab and on neither general list', async () => {
  await withScratchTenant(async (tenant) => {
    const adult = await addStudent(tenant, 'Rui', 'rui@x.pt');
    await asOwner(tenant, async () => {
      const { id } = await tab.send(adult, { channel: 'email', ...words, shownUntil: '2099-01-01' });
      assert.equal((await tab.list(adult)).messages.length, 2);
      assert.equal((await new MessagesController().list()).items.length, 0);
      assert.equal((await new AvisosController().list()).avisos.length, 0);
      await expectStatus(() => new MessagesController().one(id), 404);
    });
  });
});

test('QA 6, 7: WhatsApp is a record of an opened link, and never an address or a delivery', async () => {
  await withScratchTenant(async (tenant) => {
    const adult = await addStudent(tenant, 'Rui', null, '912 345 678');
    const sent = await asOwner(tenant, () => tab.send(adult, { channel: 'whatsapp', ...words }));
    assert.equal(sent.links!.length, 1);
    const url = new URL(sent.links![0]!.url);
    assert.equal(url.pathname, '/351912345678');
    assert.equal(url.searchParams.get('text'), `${words.subject}\n\n${words.body}`);

    const [row] = await tenant.sql<{ channel: string; address_count: number; email: string | null; delivered_at: Date | null }>(
      `SELECT m.channel::text AS channel, m.address_count, mr.email::text AS email, mr.delivered_at
         FROM message m JOIN message_recipient mr ON mr.message_id = m.id WHERE m.student_id = $1`,
      [adult],
    );
    assert.deepEqual(row, { channel: 'whatsapp', address_count: 0, email: null, delivered_at: null });

    const noNumber = await addStudent(tenant, 'Ana', null, 'ligar à mãe');
    await asOwner(tenant, async () => {
      assert.equal((await tab.list(noNumber)).recipients[0]!.hasPhone, false);
      await expectStatus(() => tab.send(noNumber, { channel: 'whatsapp', ...words }), 409);
      await expectStatus(() => tab.send(adult, { channel: 'whatsapp', subject: 'a', body: 'x'.repeat(2100) }), 400);
    });
  });
});

test('QA 8, 9: the tick shows it only to this student and their family', async () => {
  await withScratchTenant(async (tenant) => {
    const child = await addStudent(tenant, 'Alice', null);
    const guardian = await addGuardian(tenant, child, 'Marta', 'marta@x.pt', '912345678');
    const other = await addStudent(tenant, 'Bruna', null);
    const otherFamily = await addGuardian(tenant, other, 'Rita', 'rita@x.pt', null);

    await asOwner(tenant, () => tab.send(child, { channel: 'email', ...words, shownUntil: '2099-01-01' }));
    const rows = await tenant.sql<{ channel: string }>('SELECT channel::text AS channel FROM message WHERE student_id = $1', [child]);
    assert.deepEqual(rows.map((one) => one.channel).sort(), ['app', 'email']);

    await actingAs(tenant, { membershipId: guardian, roles: ['guardian'] }, async () => {
      assert.equal((await new AppAvisosController().mine()).avisos.length, 1);
    });
    await actingAs(tenant, { membershipId: otherFamily, roles: ['guardian'] }, async () => {
      assert.equal((await new AppAvisosController().mine()).avisos.length, 0);
    });
    await asOwner(tenant, () => expectStatus(() => tab.send(child, { channel: 'email', ...words, shownUntil: '2001-01-01' }), 400));
  });
});

test('QA 10, 11: an instructor reaches their own students, and reads only what they sent', async () => {
  await withScratchTenant(async (tenant) => {
    const coach = await addMember(tenant, 'Nuno', 'Costa', ['instructor']);
    const mine = await addStudent(tenant, 'Ana', 'ana@x.pt');
    const notMine = await addStudent(tenant, 'Bia', 'bia@x.pt');
    await addTurma(tenant, coach, mine);
    await asOwner(tenant, () => tab.send(mine, { channel: 'email', subject: 'Do escritório', body: 'Só a secretaria.' }));

    await actingAs(tenant, { membershipId: coach, roles: ['instructor'] }, async () => {
      await tab.send(mine, { channel: 'email', ...words });
      const { messages } = await tab.list(mine);
      assert.deepEqual(messages.map((one) => one.subject), [words.subject]);
      await expectStatus(() => tab.send(notMine, { channel: 'email', ...words }), 403);
      await expectStatus(() => tab.list(notMine), 403);
    });
    for (const role of ['guardian', 'student', 'maintenance'] as const) {
      await actingAs(tenant, { roles: [role] }, async () => {
        await expectStatus(() => tab.send(mine, { channel: 'email', ...words }), 403);
        await expectStatus(() => tab.list(mine), 403);
      });
    }
  });
});

test('QA 12: another club is a 404, and the database refuses the reference', async () => {
  await withScratchTenant(async (tenant) => {
    const adult = await addStudent(tenant, 'Rui', 'rui@x.pt');
    await withScratchTenant(async (other) => {
      await asOwner(other, async () => {
        await expectStatus(() => tab.send(adult, { channel: 'email', ...words }), 404);
        await expectStatus(() => tab.list(adult), 404);
      });
      await assert.rejects(
        owner.query(
          `INSERT INTO message (organization_id, audience, student_id, subject, body, sent_by_membership_id, address_count, channel)
           SELECT $1, 'student', $2, 'a', 'b', m.id, 0, 'whatsapp' FROM membership m WHERE m.organization_id = $1 LIMIT 1`,
          [other.organizationId, adult],
        ),
        /message_student_fk/,
      );
    });
  });
});

test('QA 13: a personal email is outside the 20 a day, and WhatsApp outside every ceiling', async () => {
  await withScratchTenant(async (tenant) => {
    const adult = await addStudent(tenant, 'Rui', 'rui@x.pt', '912345678');
    const org = tenant.organizationId;
    await owner.query(
      `INSERT INTO message (organization_id, audience, subject, body, sent_by_membership_id, address_count)
       SELECT $1, 'organization', 'a', 'b', m.id, 0 FROM membership m, generate_series(1, 20)
        WHERE m.organization_id = $1 AND m.id = (SELECT id FROM membership WHERE organization_id = $1 LIMIT 1)`,
      [org],
    );
    await asOwner(tenant, async () => {
      await tab.send(adult, { channel: 'email', ...words });
      await tab.send(adult, { channel: 'whatsapp', ...words });
    });
    assert.equal((await tenant.sql('SELECT 1 FROM message WHERE student_id = $1', [adult])).length, 2);
  });
});

test('QA 14: the words stay as words', async () => {
  await withScratchTenant(async (tenant) => {
    const adult = await addStudent(tenant, 'Rui', 'rui@x.pt');
    const body = '<script>alert(1)</script>';
    await asOwner(tenant, async () => {
      await tab.send(adult, { channel: 'email', subject: 'a', body });
      assert.equal((await tab.list(adult)).messages[0]!.body, body);
    });
    const { clubMessageEmail } = await import('../notifications/club-message-email.js');
    const mail = clubMessageEmail({ to: 'rui@x.pt', organizationName: 'C', subject: 'a', body, locale: 'pt-PT', optOutLink: null });
    assert.equal(mail.html?.includes('<script>'), false, 'the HTML part escapes it');
  });
});

test('retention: when the identity goes, the words go and the row stays', async () => {
  await withScratchTenant(async (tenant) => {
    const adult = await addStudent(tenant, 'Rui', 'rui@x.pt');
    await asOwner(tenant, () => tab.send(adult, { channel: 'email', ...words }));
    await owner.query(`UPDATE student SET archived_at = now() - interval '6 years' WHERE id = $1`, [adult]);
    await tenant.sql(`SELECT * FROM apply_retention()`);
    const [row] = await tenant.sql<{ subject: string; body: string; anon: boolean }>(
      `SELECT m.subject, m.body, s.anonymised_at IS NOT NULL AS anon
         FROM message m JOIN student s ON s.id = m.student_id WHERE m.student_id = $1`,
      [adult],
    );
    if (row!.anon) {
      assert.equal(row!.subject, 'Mensagem anonimizada');
      assert.equal(row!.body, 'Mensagem anonimizada');
    } else {
      assert.fail('the student was not anonymised, so the test proved nothing');
    }
  });
});
