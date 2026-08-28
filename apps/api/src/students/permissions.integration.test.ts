import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { AdvancementController, RedemptionController } from './students.controller.js';
import { listMembers } from '../invitations/invitations.repository.js';
import { readPageQuery } from '../common/pagination.js';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  withScratchTenant,
} from '../test/harness.js';

/**
 * The permission denials the tickets specify — POOLSE-19 and POOLSE-21.
 *
 * Every ticket in this backlog carries the same standing rule: *permissions are
 * enforced server-side; hiding a control is never the control.* Until now that
 * was asserted by reading the code. These call the controllers the way a request
 * does — real role context, real repositories, real database — and check that a
 * caller who should be refused is.
 *
 * The scenarios are the ones the tickets name by number: 19.3, 19.4 and 21.8.
 *
 * Run: pnpm api:test
 */

after(closeHarness);

test('19.4 — a student or encarregado cannot confirm an advancement', async () => {
  await withScratchTenant(async (tenant) => {
    const controller = new AdvancementController();

    const student = await addMember(tenant, 'Ana', 'Costa', ['student']);
    const guardian = await addMember(tenant, 'Maria', 'Silva', ['guardian']);

    /*
     * The ticket is explicit: the proposal is *visible* to them in the mobile
     * app and confirming is still refused. So the id being nonsense is not what
     * makes this pass — the role check runs before anything looks the proposal
     * up, which is why a 403 rather than a 404 is the right assertion.
     */
    const nowhere = '00000000-0000-0000-0000-000000000000';

    await actingAs(tenant, { membershipId: student, roles: ['student'] }, async () => {
      await expectStatus(
        () => controller.confirm(nowhere, { classGroupId: nowhere, effectiveOn: '2027-01-05' }),
        403,
      );
    });

    await actingAs(tenant, { membershipId: guardian, roles: ['guardian'] }, async () => {
      await expectStatus(
        () => controller.confirm(nowhere, { classGroupId: nowhere, effectiveOn: '2027-01-05' }),
        403,
      );
      // Reading the queue is staff work too — it names every child ready to move.
      await expectStatus(() => controller.list(), 403);
    });
  });
});

test('19.3 — an instructor may confirm; the role check is what admits them', async () => {
  await withScratchTenant(async (tenant) => {
    const controller = new AdvancementController();
    const instructor = await addMember(tenant, 'Rita', 'Nunes', ['instructor']);

    await actingAs(tenant, { membershipId: instructor, roles: ['instructor'] }, async () => {
      // Past the role check, and stopped by the proposal not existing — which is
      // the 404 that proves the 403 above was about the role and nothing else.
      await expectStatus(
        () =>
          controller.confirm('00000000-0000-0000-0000-000000000000', {
            classGroupId: '00000000-0000-0000-0000-000000000000',
            effectiveOn: '2027-01-05',
          }),
        404,
      );

      const queue = await controller.list();
      assert.equal(queue.proposals.total, 0, 'a fresh club has nobody ready to advance');
    });
  });
});

test('the advancement date is validated before it reaches the database', async () => {
  await withScratchTenant(async (tenant) => {
    const controller = new AdvancementController();
    const nowhere = '00000000-0000-0000-0000-000000000000';

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      /*
       * `2027-02-30` matches the shape and is not a day. Before the review this
       * reached the `::date` cast and came back as a 500; a 400 is the answer to
       * a typo.
       */
      await expectStatus(
        () => controller.confirm(nowhere, { classGroupId: nowhere, effectiveOn: '2027-02-30' }),
        400,
      );

      await expectStatus(
        () => controller.confirm(nowhere, { classGroupId: nowhere, effectiveOn: 'tomorrow' }),
        400,
      );

      await expectStatus(
        () => controller.confirm(nowhere, { classGroupId: nowhere, effectiveOn: '2027-01-05' }),
        404,
      );
    });
  });
});

test('21.8 — an encarregado may act only for their own children', async () => {
  await withScratchTenant(async (tenant) => {
    const controller = new RedemptionController();

    const guardian = await addMember(tenant, 'Maria', 'Silva', ['guardian']);
    const stranger = await addMember(tenant, 'Jorge', 'Pinto', ['guardian']);

    // A student with a credit, minted the way every credit is minted.
    const [level] = await tenant.sql<{ id: string }>(
      `INSERT INTO student_level (organization_id, name, sort_order)
       VALUES ($1, 'Iniciação', 1) RETURNING id`,
      [tenant.organizationId],
    );
    const [group] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_group (organization_id, season_id, name, capacity, level_id)
       VALUES ($1, $2, 'Turma A', 8, $3) RETURNING id`,
      [tenant.organizationId, tenant.seasonId, level!.id],
    );
    const [pool] = await tenant.sql<{ id: string }>(
      `INSERT INTO pool (organization_id, facility_id, name)
       VALUES ($1, $2, 'Tanque') RETURNING id`,
      [tenant.organizationId, tenant.facilityId],
    );
    const [child] = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name, level_id)
       VALUES ($1, 'Rita', 'Silva', $2) RETURNING id`,
      [tenant.organizationId, level!.id],
    );
    const [session] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_session (organization_id, class_group_id, pool_id,
                                  starts_at, duration_minutes, ends_at)
       VALUES ($1, $2, $3, now() - interval '7 days', 45,
               now() - interval '7 days' + interval '45 minutes') RETURNING id`,
      [tenant.organizationId, group!.id, pool!.id],
    );

    await tenant.sql(`UPDATE organization SET reposicao_enabled = true WHERE id = $1`, [
      tenant.organizationId,
    ]);
    await tenant.sql(
      `INSERT INTO attendance (organization_id, class_session_id, student_id, status,
                               recorded_by_membership_id)
       VALUES ($1, $2, $3, 'excused', $4)`,
      [tenant.organizationId, session!.id, child!.id, tenant.ownerMembershipId],
    );

    const [credit] = await tenant.sql<{ id: string }>(
      `SELECT id FROM reposicao_credit WHERE student_id = $1 AND archived_at IS NULL`,
      [child!.id],
    );
    assert.ok(credit, 'the trigger should have minted a credit for the justified absence');

    // Maria is Rita's encarregada; Jorge is nobody's.
    await tenant.sql(
      `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, is_primary)
       VALUES ($1, $2, $3, true)`,
      [tenant.organizationId, child!.id, guardian],
    );

    // A stranger is refused, and refused as a permission rather than a 404 —
    // they must not learn whether the credit exists.
    await actingAs(tenant, { membershipId: stranger, roles: ['guardian'] }, async () => {
      await expectStatus(() => controller.options(credit!.id), 403);
      await expectStatus(() => controller.book(credit!.id, { sessionId: session!.id }), 403);
    });

    // Her own child's credit is hers to spend.
    await actingAs(tenant, { membershipId: guardian, roles: ['guardian'] }, async () => {
      const result = await controller.options(credit!.id);
      assert.ok(Array.isArray(result.options), 'the guardian can read the options');
    });

    // And staff act for anybody.
    await actingAs(tenant, { roles: ['admin'] }, async () => {
      const result = await controller.options(credit!.id);
      assert.ok(Array.isArray(result.options));
    });
  });
});

test('a credit is offered no class after it expires — 21.7, through the controller', async () => {
  await withScratchTenant(async (tenant) => {
    const controller = new RedemptionController();

    const [level] = await tenant.sql<{ id: string }>(
      `INSERT INTO student_level (organization_id, name, sort_order)
       VALUES ($1, 'Iniciação', 1) RETURNING id`,
      [tenant.organizationId],
    );
    const [group] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_group (organization_id, season_id, name, capacity, level_id)
       VALUES ($1, $2, 'Turma A', 8, $3) RETURNING id`,
      [tenant.organizationId, tenant.seasonId, level!.id],
    );
    const [pool] = await tenant.sql<{ id: string }>(
      `INSERT INTO pool (organization_id, facility_id, name)
       VALUES ($1, $2, 'Tanque') RETURNING id`,
      [tenant.organizationId, tenant.facilityId],
    );
    const [child] = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name, level_id)
       VALUES ($1, 'Rita', 'Silva', $2) RETURNING id`,
      [tenant.organizationId, level!.id],
    );

    const [past] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_session (organization_id, class_group_id, pool_id,
                                  starts_at, duration_minutes, ends_at)
       VALUES ($1, $2, $3, now() - interval '7 days', 45,
               now() - interval '7 days' + interval '45 minutes') RETURNING id`,
      [tenant.organizationId, group!.id, pool!.id],
    );
    const [future] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_session (organization_id, class_group_id, pool_id,
                                  starts_at, duration_minutes, ends_at)
       VALUES ($1, $2, $3, now() + interval '20 days', 45,
               now() + interval '20 days' + interval '45 minutes') RETURNING id`,
      [tenant.organizationId, group!.id, pool!.id],
    );

    await tenant.sql(`UPDATE organization SET reposicao_enabled = true WHERE id = $1`, [
      tenant.organizationId,
    ]);
    await tenant.sql(
      `INSERT INTO attendance (organization_id, class_session_id, student_id, status,
                               recorded_by_membership_id)
       VALUES ($1, $2, $3, 'excused', $4)`,
      [tenant.organizationId, past!.id, child!.id, tenant.ownerMembershipId],
    );

    const [credit] = await tenant.sql<{ id: string }>(
      `SELECT id FROM reposicao_credit WHERE student_id = $1`,
      [child!.id],
    );

    await actingAs(tenant, { roles: ['admin'] }, async () => {
      // While the credit is alive, the future class is on offer.
      const before = await controller.options(credit!.id);
      assert.ok(
        before.options.some((option) => option.sessionId === future!.id),
        'a class inside the window should be offered',
      );

      // Expire it the day before that class.
      await tenant.sql(
        `UPDATE reposicao_credit SET expires_on = (now() + interval '19 days')::date
          WHERE id = $1`,
        [credit!.id],
      );

      const after = await controller.options(credit!.id);
      assert.equal(after.options.length, 0, 'nothing is offered past the expiry');

      /*
       * And booking it directly is refused, not merely absent from a list — the
       * ticket asks for both halves, because a list is a courtesy and the
       * endpoint is the rule.
       */
      await expectStatus(() => controller.book(credit!.id, { sessionId: future!.id }), 409);
    });
  });
});

test('a re-invited colleague appears on the staff list once, not twice', async () => {
  await withScratchTenant(async (tenant) => {
    /*
     * Found in review. POOLSE-39's re-invite inserts a second invitation against
     * the *same* membership, and the members query joined invitations plainly —
     * so the person fanned out to one row per address. POOLSE-29 then counted the
     * duplicates, making the range label wrong and a page hold fourteen people.
     *
     * The precondition is the whole test: one membership, two invitations. My
     * first attempt at proving this created a *first* invitation and saw nothing,
     * which is worth remembering — the bug needs two.
     */
    const colleague = await addMember(tenant, 'Sofia', 'Antunes', ['instructor']);

    for (const email of ['sofia.old@example.test', 'sofia.new@example.test']) {
      await tenant.sql(
        `INSERT INTO invitation (organization_id, membership_id, email, token_hash,
                                 roles, expires_at, invited_by_membership_id)
         VALUES ($1, $2, $3::citext, $4, ARRAY['instructor']::member_role[],
                 now() + interval '7 days', $5)`,
        [tenant.organizationId, colleague, email, `${email}-hash`.padEnd(64, 'x'), tenant.ownerMembershipId],
      );
    }

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const page = await listMembers(
        tenant.organizationId,
        { scope: 'staff', role: null, search: null },
        readPageQuery('1'),
      );

      const appearances = page.items.filter((m) => m.membershipId === colleague);
      assert.equal(appearances.length, 1, 'a re-invited colleague is one person');

      // And the total agrees with the rows, which is what the range label reads.
      assert.equal(
        page.total,
        page.items.length,
        'the total must not count the duplicate the join used to create',
      );
    });
  });
});
