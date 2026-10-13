import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'express';
import { LeadsController, RegistrationSettingsController } from './leads.controller.js';
import { PublicLeadsController, forgetOrigins } from './public-leads.controller.js';
import { LeadRetentionService } from './lead-retention.service.js';
import { issueStamp } from './form-stamp.js';
import { findRegister } from '../classes/attendance.repository.js';
import { leadHasWaited, leads as leadsResolver } from '../dashboard/resolvers.js';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';

/**
 * Online pre-registration — POOLSE-69, the ticket's QA 1–8.
 *
 * The public half is called the way the browser calls it: a body, a slug and a
 * request whose `ip` is the visitor. Every public answer is compared whole,
 * because "the response is the same" is the property and a status code alone
 * would pass a body that named the club.
 *
 * Run: pnpm api:test   (needs pnpm db:up and SENSITIVE_DATA_KEY)
 */

after(closeHarness);
beforeEach(forgetOrigins);

const publicApi = new PublicLeadsController();
let visitor = 0;

/**
 * A fresh visitor per call unless one is given, so QA 3 is the only test that
 * floods. `ip` is the Next server, the same for everybody, as in production.
 */
function from(ip?: string): Request {
  visitor += 1;
  return {
    ip: '10.0.0.1',
    headers: { 'x-poolse-client-ip': ip ?? `203.0.113.${visitor % 250}` },
  } as unknown as Request;
}

/** A stamp issued ten seconds ago — old enough to be a person, young enough to be fresh. */
function stamp(slug: string): string {
  return issueStamp(slug, new Date(Date.now() - 10_000));
}

function minor(slug: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    swimmerFirstName: 'Tomás',
    swimmerLastName: 'Reis',
    swimmerBirthDate: '2018-03-04',
    guardianName: 'Marta Reis',
    guardianRelationship: 'Mãe',
    email: `marta.${visitor}.${Date.now()}@example.pt`,
    phone: '912345678',
    preferredDays: [2, 4],
    consent: true,
    stamp: stamp(slug),
    website: '',
    ...overrides,
  };
}

async function openClub(tenant: ScratchTenant): Promise<string> {
  const [row] = await tenant.sql<{ slug: string }>(
    `UPDATE organization SET public_registration_open = true WHERE id = $1 RETURNING slug`,
    [tenant.organizationId],
  );
  return row!.slug;
}

async function leadCount(tenant: ScratchTenant): Promise<number> {
  const [row] = await tenant.sql<{ n: number }>('SELECT count(*)::int AS n FROM lead');
  return row!.n;
}

async function onlyLead(tenant: ScratchTenant): Promise<string> {
  const rows = await tenant.sql<{ id: string }>('SELECT id FROM lead ORDER BY created_at');
  assert.equal(rows.length, 1);
  return rows[0]!.id;
}

/** A turma of `capacity` with one future occurrence. */
async function turma(
  tenant: ScratchTenant,
  capacity: number | null,
): Promise<{ groupId: string; sessionId: string }> {
  const [pool] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name, kind)
     VALUES ($1, $2, 'Tanque', 'indoor') RETURNING id`,
    [tenant.organizationId, tenant.facilityId],
  );
  const [group] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_group (organization_id, season_id, facility_id, name, capacity)
     VALUES ($1, $2, $3, 'Iniciação A', $4) RETURNING id`,
    [tenant.organizationId, tenant.seasonId, tenant.facilityId, capacity],
  );
  const [session] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_session
       (organization_id, class_group_id, pool_id, starts_at, duration_minutes, occurs_on)
     VALUES ($1, $2, $3, now() + interval '7 days', 45, (now() + interval '7 days')::date)
     RETURNING id`,
    [tenant.organizationId, group!.id, pool!.id],
  );
  return { groupId: group!.id, sessionId: session!.id };
}

const RECEIVED = { received: true };

test('QA 1: an open club takes a lead with its consent, and the answer names nothing', async () => {
  await withScratchTenant(async (tenant) => {
    const slug = await openClub(tenant);

    const form = await publicApi.form(slug);
    assert.equal(form.form.clubName, tenant.name);
    assert.deepEqual(Object.keys(form).sort(), ['consentVersion', 'form', 'stamp']);

    const answer = await publicApi.submit(slug, minor(slug), from());
    assert.deepEqual(answer, RECEIVED);

    const [lead] = await tenant.sql<{
      status: string;
      consented_at: Date | null;
      consent_text_version: string;
      preferred_days: number[];
      guardian_relationship: string;
    }>(
      `SELECT status::text AS status, consented_at, consent_text_version,
              preferred_days::int[] AS preferred_days, guardian_relationship FROM lead`,
    );
    assert.equal(lead!.status, 'new');
    assert.ok(lead!.consented_at instanceof Date);
    assert.equal(lead!.consent_text_version, form.consentVersion);
    assert.deepEqual(lead!.preferred_days, [2, 4]);
    assert.equal(lead!.guardian_relationship, 'Mãe');
  });
});

test('QA 2: an unknown slug and a closed club answer exactly like an open one', async () => {
  await withScratchTenant(async (tenant) => {
    const [row] = await tenant.sql<{ slug: string }>(
      'SELECT slug FROM organization WHERE id = $1',
      [tenant.organizationId],
    );
    const closed = row!.slug;

    assert.deepEqual(await publicApi.submit(closed, minor(closed), from()), RECEIVED);
    assert.deepEqual(
      await publicApi.submit('nao-existe-de-todo', minor('nao-existe-de-todo'), from()),
      RECEIVED,
    );
    assert.equal(await leadCount(tenant), 0);

    // The form itself: a closed club and an unknown slug are the same 404.
    await expectStatus(() => publicApi.form(closed), 404);
    await expectStatus(() => publicApi.form('nao-existe-de-todo'), 404);
  });
});

test('QA 3: a honeypot, a stale stamp and a flooding origin write nothing and answer the same', async () => {
  await withScratchTenant(async (tenant) => {
    const slug = await openClub(tenant);

    assert.deepEqual(
      await publicApi.submit(slug, minor(slug, { website: 'http://spam.example' }), from()),
      RECEIVED,
    );
    assert.deepEqual(
      await publicApi.submit(
        slug,
        minor(slug, { stamp: issueStamp(slug, new Date(Date.now() - 25 * 3600_000)) }),
        from(),
      ),
      RECEIVED,
    );
    assert.deepEqual(await publicApi.submit(slug, minor(slug, { stamp: undefined }), from()), RECEIVED);
    // A stamp from another club's page does not open this one.
    assert.deepEqual(
      await publicApi.submit(slug, minor(slug, { stamp: stamp('outro-clube') }), from()),
      RECEIVED,
    );
    assert.equal(await leadCount(tenant), 0, 'honeypot or stamp wrote a lead');

    // Twenty in a minute from one address: five land, every answer is the same.
    for (let i = 0; i < 20; i += 1) {
      assert.deepEqual(await publicApi.submit(slug, minor(slug), from('198.51.100.7')), RECEIVED);
    }
    assert.equal(await leadCount(tenant), 5);
  });
});

test('a malformed body is a 400 naming fields, decided before any club is looked at', async () => {
  const slug = 'nao-existe-de-todo';
  await expectStatus(
    () => publicApi.submit(slug, minor(slug, { guardianName: '', swimmerTaxNumber: '123456780' }), from()),
    400,
  );
  try {
    await publicApi.submit(slug, minor(slug, { guardianName: '', swimmerTaxNumber: '123456780' }), from());
  } catch (error) {
    const body = (error as { getResponse(): { fields: Record<string, string> } }).getResponse();
    assert.deepEqual(Object.keys(body.fields).sort(), ['guardianName', 'swimmerTaxNumber']);
  }
});

test('QA 4: a lead whose NIF is already a student attaches to that student', async () => {
  await withScratchTenant(async (tenant) => {
    const slug = await openClub(tenant);
    const { groupId } = await turma(tenant, 10);
    const [existing] = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name, tax_number)
       VALUES ($1, 'Tomás', 'Reis', '123456789') RETURNING id`,
      [tenant.organizationId],
    );

    await publicApi.submit(slug, minor(slug, { swimmerTaxNumber: '123 456 789' }), from());
    const leadId = await onlyLead(tenant);

    const placed = await actingAs(tenant, { roles: ['admin'] }, () =>
      new LeadsController().convert(leadId, { classGroupId: groupId }),
    );
    assert.equal(placed.studentId, existing!.id);
    assert.equal(placed.attached, true);

    const [count] = await tenant.sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM student WHERE last_name = 'Reis'`,
    );
    assert.equal(count!.n, 1, 'a second Tomás was created');
  });
});

test('converting writes the student, the guardian and the enrolment; waitlisting a waiting place', async () => {
  await withScratchTenant(async (tenant) => {
    const slug = await openClub(tenant);
    const { groupId } = await turma(tenant, 10);

    await publicApi.submit(slug, minor(slug), from());
    await publicApi.submit(slug, minor(slug, { swimmerFirstName: 'Rita' }), from());
    const [tomas, rita] = await tenant.sql<{ id: string }>(
      `SELECT id FROM lead ORDER BY swimmer_first_name DESC`,
    );

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const api = new LeadsController();
      await api.convert(tomas!.id, { classGroupId: groupId });
      await api.waitlist(rita!.id, { classGroupId: groupId });
    });

    const rows = await tenant.sql<{ first_name: string; status: string; guardians: number }>(
      `SELECT s.first_name, e.status::text AS status,
              (SELECT count(*)::int FROM guardian_link g
                WHERE g.student_id = s.id AND g.archived_at IS NULL) AS guardians
         FROM student s JOIN enrollment e ON e.student_id = s.id
        ORDER BY s.first_name`,
    );
    assert.deepEqual(
      rows.map((r) => [r.first_name, r.status, r.guardians]),
      [
        ['Rita', 'waiting', 1],
        ['Tomás', 'active', 1],
      ],
    );

    const statuses = await tenant.sql<{ status: string }>(
      `SELECT status::text AS status FROM lead ORDER BY swimmer_first_name`,
    );
    assert.deepEqual(statuses.map((s) => s.status), ['waitlisted', 'converted']);

    // A placed lead is not placed twice.
    await actingAs(tenant, { roles: ['owner'] }, () =>
      expectStatus(() => new LeadsController().convert(tomas!.id, { classGroupId: groupId }), 409),
    );
  });
});

test('a full turma refuses the conversion and leaves no student behind', async () => {
  await withScratchTenant(async (tenant) => {
    const slug = await openClub(tenant);
    const { groupId } = await turma(tenant, 1);
    await tenant.sql(
      `WITH s AS (INSERT INTO student (organization_id, first_name, last_name)
                  VALUES ($1, 'Ana', 'Costa') RETURNING id)
       INSERT INTO enrollment (organization_id, class_group_id, student_id, status)
       SELECT $1, $2, id, 'active' FROM s`,
      [tenant.organizationId, groupId],
    );

    await publicApi.submit(slug, minor(slug), from());
    const leadId = await onlyLead(tenant);

    await actingAs(tenant, { roles: ['owner'] }, () =>
      expectStatus(() => new LeadsController().convert(leadId, { classGroupId: groupId }), 409),
    );
    const [count] = await tenant.sql<{ n: number }>('SELECT count(*)::int AS n FROM student');
    assert.equal(count!.n, 1, 'the refused conversion left a student behind');
  });
});

test('QA 5: a trial into a full occurrence is a 409 carrying its numbers', async () => {
  await withScratchTenant(async (tenant) => {
    const slug = await openClub(tenant);
    const { groupId, sessionId } = await turma(tenant, 1);

    await publicApi.submit(slug, minor(slug), from());
    await publicApi.submit(slug, minor(slug, { swimmerFirstName: 'Rita' }), from());
    const [tomas, rita] = await tenant.sql<{ id: string }>(
      `SELECT id FROM lead ORDER BY swimmer_first_name DESC`,
    );

    await actingAs(tenant, { roles: ['admin'] }, async () => {
      const api = new LeadsController();
      const before = await api.options(groupId);
      assert.equal(before.options[0]!.freeSeats, 1);

      assert.deepEqual(await api.trial(tomas!.id, { sessionId }), { booked: true });

      try {
        await api.trial(rita!.id, { sessionId });
        assert.fail('a second trial took the last place');
      } catch (error) {
        assert.equal((error as { status?: number }).status, 409);
        const body = (error as { getResponse(): Record<string, unknown> }).getResponse();
        assert.equal(body['code'], 'trial_full');
        assert.deepEqual(body['values'], { capacity: 1, taken: 1 });
      }

      const afterwards = await api.options(groupId);
      assert.equal(afterwards.options[0]!.freeSeats, 0);
    });
  });
});

test('QA 6: an instructor and a guardian cannot work the queue (403)', async () => {
  await withScratchTenant(async (tenant) => {
    const slug = await openClub(tenant);
    await publicApi.submit(slug, minor(slug), from());
    const leadId = await onlyLead(tenant);
    const instructor = await addMember(tenant, 'Joana', 'Pires', ['instructor']);
    const guardian = await addMember(tenant, 'Paulo', 'Sá', ['guardian']);

    for (const [membershipId, role] of [
      [instructor, 'instructor'],
      [guardian, 'guardian'],
    ] as const) {
      await actingAs(tenant, { membershipId, roles: [role] }, async () => {
        const api = new LeadsController();
        await expectStatus(() => api.list(), 403);
        await expectStatus(() => api.convert(leadId, { classGroupId: leadId }), 403);
        await expectStatus(() => api.dismiss(leadId, { reason: 'Não' }), 403);
      });
    }

    // An Admin reads the club's address but only the Owner changes it.
    const admin = await addMember(tenant, 'Rui', 'Lopes', ['admin']);
    await actingAs(tenant, { membershipId: admin, roles: ['admin'] }, async () => {
      const settings = new RegistrationSettingsController();
      assert.equal((await settings.read()).slug, slug);
      await expectStatus(() => settings.update({ slug: 'outro-nome', open: true }), 403);
    });
  });
});

test('QA 7: another club\'s lead is not found', async () => {
  await withScratchTenant(async (clubB) => {
    const slug = await openClub(clubB);
    await publicApi.submit(slug, minor(slug), from());
    const leadOfB = await onlyLead(clubB);

    await withScratchTenant(async (clubA) => {
      const { groupId } = await turma(clubA, 10);
      await actingAs(clubA, { roles: ['owner'] }, async () => {
        const api = new LeadsController();
        await expectStatus(() => api.one(leadOfB), 404);
        await expectStatus(() => api.convert(leadOfB, { classGroupId: groupId }), 404);
        await expectStatus(() => api.dismiss(leadOfB, { reason: 'Teste' }), 404);
      });
    });

    const [lead] = await clubB.sql<{ status: string }>('SELECT status::text AS status FROM lead');
    assert.equal(lead!.status, 'new');
  });
});

test('a dismissal needs a reason, and frees a booked trial\'s seat', async () => {
  await withScratchTenant(async (tenant) => {
    const slug = await openClub(tenant);
    const { groupId, sessionId } = await turma(tenant, 1);
    await publicApi.submit(slug, minor(slug), from());
    const leadId = await onlyLead(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const api = new LeadsController();
      await api.trial(leadId, { sessionId });
      await expectStatus(() => api.dismiss(leadId, { reason: '  ' }), 400);
      await api.dismiss(leadId, { reason: 'Não respondeu' });
      assert.equal((await api.options(groupId)).options[0]!.freeSeats, 1);
      assert.equal((await api.list()).leads.length, 0);
      assert.equal((await api.list('done')).leads[0]!.dismissedReason, 'Não respondeu');
    });
  });
});

test('the Owner sets the address; a taken one is refused by name', async () => {
  await withScratchTenant(async (clubB) => {
    const takenSlug = await openClub(clubB);
    await withScratchTenant(async (clubA) => {
      await actingAs(clubA, { roles: ['owner'] }, async () => {
        const settings = new RegistrationSettingsController();
        await expectStatus(() => settings.update({ slug: takenSlug, open: true }), 409);
        await expectStatus(() => settings.update({ slug: 'Com Espaços', open: true }), 400);
        const fresh = `clube-a-${Date.now()}`;
        assert.deepEqual(await settings.update({ slug: fresh, open: true }), { slug: fresh, open: true });
      });
    });
  });
});

test('QA 8: retention archives an old unconverted lead and deletes nothing', async () => {
  await withScratchTenant(async (tenant) => {
    const slug = await openClub(tenant);
    const { groupId } = await turma(tenant, 10);
    await publicApi.submit(slug, minor(slug), from());
    await publicApi.submit(slug, minor(slug, { swimmerFirstName: 'Rita' }), from());
    await publicApi.submit(slug, minor(slug, { swimmerFirstName: 'Zé' }), from());
    const [rita] = await tenant.sql<{ id: string }>(
      `SELECT id FROM lead WHERE swimmer_first_name = 'Rita'`,
    );
    await actingAs(tenant, { roles: ['owner'] }, () =>
      new LeadsController().convert(rita!.id, { classGroupId: groupId }),
    );
    // Rita (converted) and Tomás (new) are old; Zé is this week's.
    await tenant.sql(
      `UPDATE lead SET created_at = now() - interval '13 months'
        WHERE swimmer_first_name IN ('Rita', 'Tomás')`,
    );

    const run = await new LeadRetentionService().run(tenant.organizationId);
    assert.equal(run.archived, 1);

    const rows = await tenant.sql<{ name: string; archived: boolean }>(
      `SELECT swimmer_first_name AS name, archived_at IS NOT NULL AS archived
         FROM lead ORDER BY swimmer_first_name`,
    );
    assert.deepEqual(
      rows.map((r) => [r.name, r.archived]),
      [
        ['Rita', false],
        ['Tomás', true],
        ['Zé', false],
      ],
    );
  });
});

test('a booked trial is named on the register, and leaves it when dismissed', async () => {
  await withScratchTenant(async (tenant) => {
    const slug = await openClub(tenant);
    const { sessionId } = await turma(tenant, 5);
    await publicApi.submit(slug, minor(slug), from());
    const leadId = await onlyLead(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await new LeadsController().trial(leadId, { sessionId });
      const register = await findRegister(tenant.organizationId, sessionId);
      assert.equal(register!.entries.length, 0, 'a trial guest became a markable entry');
      assert.equal(register!.trialGuests.length, 1);
      assert.equal(register!.trialGuests[0]!.name, 'Tomás Reis');
      assert.ok((register!.trialGuests[0]!.ageYears ?? 0) >= 8);

      await new LeadsController().dismiss(leadId, { reason: 'Desistiu' });
      const after = await findRegister(tenant.organizationId, sessionId);
      assert.equal(after!.trialGuests.length, 0);
    });
  });
});

test('the dashboard card counts what is waiting, and lifts itself after three days', async () => {
  await withScratchTenant(async (tenant) => {
    const ctx = {
      organizationId: tenant.organizationId,
      membershipId: tenant.ownerMembershipId,
      roles: ['owner'],
      facilityIds: [],
      ownFacilityIds: [],
      scope: { mode: 'all' as const, facilityId: null },
      locale: 'pt-PT',
    };
    assert.equal(await leadsResolver(ctx), null, 'an empty queue is not a card with zeros');

    const slug = await openClub(tenant);
    await publicApi.submit(slug, minor(slug), from());
    const fresh = await leadsResolver(ctx);
    assert.deepEqual(fresh, { waiting: 1, trials: 0, oldestWaitingDays: 0 });
    assert.equal(leadHasWaited(fresh), false);

    await tenant.sql(`UPDATE lead SET created_at = now() - interval '4 days'`);
    const late = await leadsResolver(ctx);
    assert.equal(late!.oldestWaitingDays, 4);
    assert.equal(leadHasWaited(late), true);
  });
});

test('sweep: a day that does not exist is a 400, not a silent drop', async () => {
  const slug = 'nao-existe-de-todo';
  try {
    await publicApi.submit(slug, minor(slug, { swimmerBirthDate: '2018-02-31' }), from());
    assert.fail('31 February was accepted');
  } catch (error) {
    const body = (error as { getResponse(): { fields: Record<string, string> } }).getResponse();
    assert.deepEqual(Object.keys(body.fields), ['swimmerBirthDate']);
  }
});

test("sweep: the form asks for a guardian under the club's own age of majority", async () => {
  await withScratchTenant(async (tenant) => {
    const slug = await openClub(tenant);
    await tenant.sql('UPDATE organization SET age_of_majority = 21 WHERE id = $1', [tenant.organizationId]);
    const form = await publicApi.form(slug);
    assert.equal(form.form.ageOfMajority, 21);

    const nineteen = `${new Date().getUTCFullYear() - 19}-01-01`;
    const adult = minor(slug, {
      swimmerBirthDate: nineteen, guardianName: '', guardianRelationship: '', majority: 21,
    });
    await expectStatus(() => publicApi.submit(slug, adult, from()), 400);
    // At 18 the same nineteen-year-old needs nobody.
    assert.deepEqual(await publicApi.submit(slug, { ...adult, majority: 18 }, from()), RECEIVED);
  });
});

test('sweep: with WEB_PROXY_SECRET set, a forged visitor header buys nothing', async () => {
  await withScratchTenant(async (tenant) => {
    const slug = await openClub(tenant);
    const previous = process.env['WEB_PROXY_SECRET'];
    process.env['WEB_PROXY_SECRET'] = 'segredo-de-teste';
    try {
      for (let i = 0; i < 12; i += 1) {
        const forged = {
          ip: '198.51.100.99',
          headers: { 'x-poolse-client-ip': `203.0.113.${i}` },
        } as unknown as Request;
        assert.deepEqual(await publicApi.submit(slug, minor(slug), forged), RECEIVED);
      }
      assert.equal(await leadCount(tenant), 5, 'rotating the header escaped the per-visitor limit');

      // The web, which carries the secret, is believed.
      const viaWeb = {
        ip: '10.0.0.1',
        headers: { 'x-poolse-client-ip': '192.0.2.44', 'x-poolse-proxy-secret': 'segredo-de-teste' },
      } as unknown as Request;
      await publicApi.submit(slug, minor(slug), viaWeb);
      assert.equal(await leadCount(tenant), 6);
    } finally {
      if (previous === undefined) delete process.env['WEB_PROXY_SECRET'];
      else process.env['WEB_PROXY_SECRET'] = previous;
    }
  });
});

test('sweep: a slug a club gave up stays its own — another club cannot take it', async () => {
  await withScratchTenant(async (clubA) => {
    const oldSlug = await openClub(clubA);
    const newSlug = `${oldSlug}-novo`.slice(0, 60);
    await actingAs(clubA, { roles: ['owner'] }, () =>
      new RegistrationSettingsController().update({ slug: newSlug, open: true }),
    );
    await withScratchTenant(async (clubB) => {
      await actingAs(clubB, { roles: ['owner'] }, () =>
        expectStatus(() => new RegistrationSettingsController().update({ slug: oldSlug, open: true }), 409),
      );
    });
    // A may go back to its own old address.
    const back = await actingAs(clubA, { roles: ['owner'] }, () =>
      new RegistrationSettingsController().update({ slug: oldSlug, open: true }),
    );
    assert.equal(back.slug, oldSlug);
  });
});

test("sweep: a trial into another club's session is not found", async () => {
  await withScratchTenant(async (clubB) => {
    const { sessionId: sessionOfB } = await turma(clubB, 5);
    await withScratchTenant(async (clubA) => {
      const slug = await openClub(clubA);
      await publicApi.submit(slug, minor(slug), from());
      const leadId = await onlyLead(clubA);
      await actingAs(clubA, { roles: ['owner'] }, () =>
        expectStatus(() => new LeadsController().trial(leadId, { sessionId: sessionOfB }), 404),
      );
    });
  });
});
