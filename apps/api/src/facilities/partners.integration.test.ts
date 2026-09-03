import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { PartnersController } from './partners.controller.js';
import { actingAs, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';

/**
 * Parcerias, through their endpoints — POOLSE-47.
 *
 * `packages/db/test/parcerias.sql` proves what the schema guarantees: the
 * composite keys, the partial indexes, RLS, and that a unit price survives
 * multiplication. This proves the layer above it — that a name collision comes
 * back as something a form can say out loud rather than as a constraint name,
 * that the derived columns arrive computed, that a decimal price is never parsed
 * into a float on its way through, and that every write refuses an instructor.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

const DINIS = {
  name: 'ES D. Dinis',
  type: 'escola',
  nif: '501234567',
  color: '#67a6b6',
};

test('a partner is created and appears in its facility list', async () => {
  await withScratchTenant(async (tenant) => {
    const partners = new PartnersController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      // QA 47.1
      const { id } = await partners.create(tenant.facilityId, DINIS);

      const page = await partners.list(tenant.facilityId);
      assert.equal(page.total, 1);
      assert.equal(page.items[0]?.id, id);
      assert.equal(page.items[0]?.name, 'ES D. Dinis');
      assert.equal(page.items[0]?.type, 'escola');
      assert.equal(page.items[0]?.status, 'ativa');

      // QA 47.6 — zero is a number, not a blank. A partner with no bookings
      // must read 0, because "none yet" and "this failed to load" look identical
      // when the cell is empty.
      assert.equal(page.items[0]?.groupCount, 0);
      assert.equal(page.items[0]?.weeklyHours, 0);
      assert.equal(page.items[0]?.weeklyLaneHours, 0);
      assert.equal(page.items[0]?.contractedCents, null);
    });
  });
});

test('a partner name collides case- and accent-insensitively, and only at its own site', async () => {
  await withScratchTenant(async (tenant) => {
    const partners = new PartnersController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await partners.create(tenant.facilityId, {
        name: 'Misericórdia',
        type: 'ipss_misericordia',
      });

      // QA 47.2 — and it comes back as a message a form can render, not as
      // "duplicate key value violates unique constraint partner_name_uq".
      await assert.rejects(
        partners.create(tenant.facilityId, { name: 'misericordia', type: 'ipss_misericordia' }),
        (error: unknown) => {
          assert.ok(error instanceof ConflictException);
          const body = error.getResponse() as { message: string; name: string };
          assert.equal(body.message, 'partnerNameTaken');
          assert.equal(body.name, 'misericordia');
          return true;
        },
      );

      // QA 47.3 — the same school at another building is a separate partnership,
      // with its own agreement, price and contact.
      const [other] = await tenant.sql<{ id: string }>(
        `INSERT INTO facility (organization_id, name) VALUES ($1, 'Piscina Norte') RETURNING id`,
        [tenant.organizationId],
      );

      await partners.create(other!.id, { name: 'Misericórdia', type: 'ipss_misericordia' });

      // QA 47.4 — archiving frees the name again.
      const page = await partners.list(tenant.facilityId);
      await partners.remove(page.items[0]!.id);
      await partners.create(tenant.facilityId, {
        name: 'Misericórdia',
        type: 'ipss_misericordia',
      });
    });
  });
});

test('a unit price of 14.375 is stored and returned without being rounded', async () => {
  await withScratchTenant(async (tenant) => {
    const partners = new PartnersController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { id } = await partners.create(tenant.facilityId, DINIS);

      // QA 47.8. The wire carries the VAT as the percentage a contract states;
      // the column holds the fraction it is multiplied by.
      await partners.recordAgreement(id, {
        startDate: '2026-09-01',
        endDate: '2027-07-31',
        billingModel: 'por_hora_pista',
        unitPrice: '14.375',
        vatRate: '23',
        paymentPeriod: 'mensal',
      });

      const detail = await partners.detail(id);
      assert.equal(detail.agreement?.billingModel, 'por_hora_pista');

      // A string all the way through. Number() here would be the bug this
      // asserts against — 14.375 is exact in binary floating point, but the
      // habit is what rounds 0.1548 to 0.15 in the module next door.
      assert.equal(typeof detail.agreement?.unitPrice, 'string');
      assert.equal(Number(detail.agreement?.unitPrice), 14.375);
      assert.equal(Number(detail.agreement?.vatRate), 0.23);
    });
  });
});

test('an agreement with no VAT rate is isento, and keeps null rather than zero', async () => {
  await withScratchTenant(async (tenant) => {
    const partners = new PartnersController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { id } = await partners.create(tenant.facilityId, {
        name: 'Misericórdia',
        type: 'ipss_misericordia',
      });

      // QA 47.9. Null is isento, and a zero rate would be a different claim —
      // "0% VAT applies" rather than "this is outside VAT".
      await partners.recordAgreement(id, {
        startDate: '2026-09-01',
        billingModel: 'mensal_fixo',
        unitPrice: '320',
      });

      const detail = await partners.detail(id);
      assert.equal(detail.agreement?.vatRate, null);
    });

    // And a rate of 100 or more is refused before it reaches the column.
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { id } = await partners.create(tenant.facilityId, { name: 'EPA', type: 'escola' });

      await assert.rejects(
        partners.recordAgreement(id, {
          startDate: '2026-09-01',
          billingModel: 'mensal_fixo',
          unitPrice: '320',
          vatRate: '230',
        }),
        BadRequestException,
      );
    });
  });
});

test('a group carries its size, tag and own-instructor arrangement', async () => {
  await withScratchTenant(async (tenant) => {
    const partners = new PartnersController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { id } = await partners.create(tenant.facilityId, DINIS);

      await partners.createGroup(id, {
        name: '6A',
        participantCount: 24,
        tag: 'DE',
        bringsOwnInstructor: true,
        ownInstructorName: 'Prof. Silva',
      });

      // Zero is a real answer for a group nobody has sized yet.
      await partners.createGroup(id, { name: '6B' });

      const detail = await partners.detail(id);
      assert.equal(detail.groups.length, 2);

      const first = detail.groups.find((group) => group.name === '6A');
      assert.equal(first?.participantCount, 24);
      assert.equal(first?.tag, 'DE');
      // QA 47.7's half that lives here: the flag and the name are what make a
      // booking `external` and keep the group out of the sem-professor alert.
      assert.equal(first?.bringsOwnInstructor, true);
      assert.equal(first?.ownInstructorName, 'Prof. Silva');

      const second = detail.groups.find((group) => group.name === '6B');
      assert.equal(second?.participantCount, 0);
      assert.equal(second?.bringsOwnInstructor, false);

      // Unticking the flag takes the name with it rather than erroring — the
      // CHECK forbids the pair, and the operator has already said what they mean.
      await partners.editGroup(first!.id, {
        name: '6A',
        participantCount: 24,
        bringsOwnInstructor: false,
        ownInstructorName: 'Prof. Silva',
      });

      const after = await partners.detail(id);
      const edited = after.groups.find((group) => group.name === '6A');
      assert.equal(edited?.bringsOwnInstructor, false);
      assert.equal(edited?.ownInstructorName, null);
    });
  });
});

test('a group name collides within its partner and is free across partners', async () => {
  await withScratchTenant(async (tenant) => {
    const partners = new PartnersController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const dinis = await partners.create(tenant.facilityId, DINIS);
      const epa = await partners.create(tenant.facilityId, { name: 'EPA', type: 'escola' });

      await partners.createGroup(dinis.id, { name: '6A' });

      await assert.rejects(
        partners.createGroup(dinis.id, { name: '6a' }),
        (error: unknown) => {
          assert.ok(error instanceof ConflictException);
          return true;
        },
      );

      // Every school has a 6A, and they are different children.
      await partners.createGroup(epa.id, { name: '6A' });
    });
  });
});

test('a contact needs a way to be reached, and a phone number is enough', async () => {
  await withScratchTenant(async (tenant) => {
    const partners = new PartnersController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { id } = await partners.create(tenant.facilityId, DINIS);

      await assert.rejects(
        partners.addPartnerContact(id, { name: 'Conselho Executivo' }),
        (error: unknown) => {
          assert.ok(error instanceof BadRequestException);
          const body = error.getResponse() as { code: string };
          // Named, so the form can point at the field rather than showing a
          // constraint. This is the guardian-key trap's neighbour, and the rule
          // here is deliberately the looser one — a partner contact is never
          // deduplicated against the register.
          assert.equal(body.code, 'contact_unreachable');
          return true;
        },
      );

      await partners.addPartnerContact(id, { name: 'Secretaria', phone: '212345678' });

      const detail = await partners.detail(id);
      assert.equal(detail.contacts.length, 1);
      assert.equal(detail.contacts[0]?.phone, '212345678');
    });
  });
});

test('an inactive partner leaves the picker and keeps its place in the list', async () => {
  await withScratchTenant(async (tenant) => {
    const partners = new PartnersController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { id } = await partners.create(tenant.facilityId, DINIS);
      await partners.createGroup(id, { name: '6A' });
      await partners.create(tenant.facilityId, { name: 'EPA', type: 'escola' });

      let bookable = await partners.bookable(tenant.facilityId);
      assert.equal(bookable.partners.length, 2);
      assert.equal(bookable.partners.find((p) => p.name === 'ES D. Dinis')?.groups.length, 1);

      // QA 47.11 — inativa, not archived. It disappears from the picker and
      // stays in the list, because last season's grid still names it.
      await partners.edit(id, { ...DINIS, status: 'inativa' });

      bookable = await partners.bookable(tenant.facilityId);
      assert.equal(bookable.partners.length, 1);
      assert.equal(bookable.partners[0]?.name, 'EPA');

      const page = await partners.list(tenant.facilityId);
      assert.equal(page.total, 2);
      assert.equal(page.items.find((p) => p.name === 'ES D. Dinis')?.status, 'inativa');
    });
  });
});

test('the list paginates and the counts on page 2 agree with page 1', async () => {
  await withScratchTenant(async (tenant) => {
    const partners = new PartnersController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      // QA 47.12. Twenty partners, which is a real number for a municipal pool
      // selling water to every school in the county.
      for (let n = 1; n <= 20; n += 1) {
        await partners.create(tenant.facilityId, {
          name: `Escola ${String(n).padStart(2, '0')}`,
          type: 'escola',
        });
      }

      const first = await partners.list(tenant.facilityId);
      const second = await partners.list(tenant.facilityId, '2');

      assert.equal(first.total, 20);
      // The total is the same on both pages — the failure this guards against is
      // filtering after the window, which gives page 2 a different denominator.
      assert.equal(second.total, 20);
      assert.equal(second.page, 2);
      assert.equal(first.items.length, first.limit);

      // No row appears on both pages, and together they cover the window.
      const firstIds = new Set(first.items.map((row) => row.id));
      assert.ok(second.items.every((row) => !firstIds.has(row.id)));
    });
  });
});

test('horas/semana and pistas·hora are computed over the published season', async () => {
  await withScratchTenant(async (tenant) => {
    const partners = new PartnersController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { id } = await partners.create(tenant.facilityId, DINIS);
      const group = await partners.createGroup(id, { name: '6A', participantCount: 24 });

      // A booking on two lanes. Nothing in the product creates one yet —
      // POOLSE-50 does — so it is built here the way the grid will.
      const [pool] = await tenant.sql<{ id: string }>(
        `INSERT INTO pool (organization_id, facility_id, name, kind)
         VALUES ($1, $2, 'Tanque Grande', 'indoor') RETURNING id`,
        [tenant.organizationId, tenant.facilityId],
      );
      await tenant.sql(
        `INSERT INTO lane (organization_id, pool_id, name, position)
         VALUES ($1, $2, 'Pista 2', 2)`,
        [tenant.organizationId, pool!.id],
      );

      const [booking] = await tenant.sql<{ id: string }>(
        `INSERT INTO class_schedule
           (organization_id, facility_id, subject_type, partner_group_id, season_id,
            weekday, start_time, duration_minutes)
         VALUES ($1, $2, 'parceria', $3, $4, 2, '09:00', 45)
         RETURNING id`,
        [tenant.organizationId, tenant.facilityId, group.id, tenant.seasonId],
      );

      await tenant.sql(
        `INSERT INTO booking_lane (organization_id, schedule_id, lane_id)
         SELECT $1, $2, id FROM lane WHERE pool_id = $3`,
        [tenant.organizationId, booking!.id, pool!.id],
      );

      // QA 47.5 — 45 minutes on two lanes is 0.75 hours and 1.5 lane-hours.
      const page = await partners.list(tenant.facilityId);
      const row = page.items.find((entry) => entry.id === id);
      assert.equal(row?.groupCount, 1);
      assert.equal(row?.weeklyHours, 0.75);
      assert.equal(row?.weeklyLaneHours, 1.5);

      // Criterion 9 — the read-only Horário panel names the lanes it occupies.
      const detail = await partners.detail(id);
      assert.equal(detail.bookings.length, 1);
      assert.equal(detail.bookings[0]?.groupName, '6A');
      assert.equal(detail.bookings[0]?.startTime, '09:00');
      assert.deepEqual(detail.bookings[0]?.laneNames, ['Tanque Grande', 'Pista 2']);

      // And a booked partner cannot be quietly archived out from under the grid.
      await assert.rejects(partners.remove(id), (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        const body = error.getResponse() as { message: string; bookings: number };
        assert.equal(body.message, 'partnerInUse');
        assert.equal(body.bookings, 1);
        return true;
      });
    });
  });
});

/**
 * Criterion 12 — every write refuses an instructor, at the endpoint.
 *
 * One test per endpoint rather than one for the controller, because the failure
 * this catches is a single method that was written without the `requireRole`
 * line. A test that checked one endpoint would pass while eight others were open.
 */
test('an instructor may read partners and may write none of them', async () => {
  await withScratchTenant(async (tenant) => {
    const partners = new PartnersController();

    let partnerId = '';
    let groupId = '';
    let contactId = '';

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const created = await partners.create(tenant.facilityId, DINIS);
      partnerId = created.id;
      groupId = (await partners.createGroup(partnerId, { name: '6A' })).id;
      contactId = (
        await partners.addPartnerContact(partnerId, { name: 'Secretaria', phone: '212345678' })
      ).id;
    });

    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      // Reading is fine, and necessary: an instructor looking at Tuesday morning
      // needs to know lane 3 belongs to a school.
      const page = await partners.list(tenant.facilityId);
      assert.equal(page.total, 1);
      // And the read says they may not manage it, so the UI has something honest
      // to render — while the refusals below are what actually enforce it.
      assert.equal(page.canManage, false);

      const detail = await partners.detail(partnerId);
      assert.equal(detail.canManage, false);

      await expectStatus(() => partners.create(tenant.facilityId, { name: 'EPA', type: 'escola' }), 403);
      await expectStatus(() => partners.edit(partnerId, DINIS), 403);
      await expectStatus(() => partners.remove(partnerId), 403);
      await expectStatus(
        () => partners.addPartnerContact(partnerId, { name: 'X', phone: '212345678' }),
        403,
      );
      await expectStatus(() => partners.removePartnerContact(contactId), 403);
      await expectStatus(
        () =>
          partners.recordAgreement(partnerId, {
            startDate: '2026-09-01',
            billingModel: 'mensal_fixo',
            unitPrice: '320',
          }),
        403,
      );
      await expectStatus(() => partners.createGroup(partnerId, { name: '7A' }), 403);
      await expectStatus(() => partners.editGroup(groupId, { name: '7A' }), 403);
      await expectStatus(() => partners.removeGroup(groupId), 403);
    });
  });
});

test('a partner from another tenant is not readable and not writable', async () => {
  await withScratchTenant(async (outsider) => {
    await withScratchTenant(async (owner) => {
      const partners = new PartnersController();

      let partnerId = '';
      await actingAs(owner, { roles: ['owner'] }, async () => {
        partnerId = (await partners.create(owner.facilityId, DINIS)).id;
      });

      // QA 47.14. The neighbour is an owner in good standing in their own club,
      // which is the case that matters: this is isolation, not authorization.
      await actingAs(outsider, { roles: ['owner'] }, async () => {
        await expectStatus(() => partners.detail(partnerId), 404);
        await expectStatus(() => partners.edit(partnerId, DINIS), 404);
        await expectStatus(() => partners.remove(partnerId), 404);
        await expectStatus(() => partners.createGroup(partnerId, { name: '6A' }), 404);

        const page = await partners.list(owner.facilityId);
        assert.equal(page.total, 0);
      });
    });
  });
});
