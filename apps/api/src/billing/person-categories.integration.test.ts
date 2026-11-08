import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { FeeCategoriesController } from './categories.controller.js';
import { PersonCategoriesController } from './person-categories.controller.js';
import { AppController } from '../app/app.controller.js';
import { attentionForReader } from '../attention/attention.controller.js';
import { clubToday } from '../common/club-day.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * POOLSE-202 — a category on the person, with proof seen and a valid-until date.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

function day(offset: number): string {
  const at = new Date(`${clubToday()}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + offset);
  return at.toISOString().slice(0, 10);
}

const office = <T>(tenant: ScratchTenant, fn: () => Promise<T>): Promise<T> =>
  actingAs(tenant, { roles: ['owner'] }, fn);

async function categories(tenant: ScratchTenant): Promise<{ socio: string; senior: string }> {
  return office(tenant, async () => {
    const fees = new FeeCategoriesController();
    // Created Sócio first, so by display order Sócio leads; rank puts Sénior first.
    const socio = (await fees.create({ name: 'Sócio' })).id;
    const senior = (await fees.create({ name: 'Sénior' })).id;
    await fees.rank({ ids: [senior, socio] });
    return { socio, senior };
  });
}

async function student(tenant: ScratchTenant, membershipId: string | null = null): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name, membership_id)
     VALUES ($1, 'Ana', 'Costa', $2) RETURNING id`,
    [tenant.organizationId, membershipId],
  );
  return row!.id;
}

test('the top-ranked category comes first, and rank is not the display order (QA 1)', async () => {
  await withScratchTenant(async (tenant) => {
    const { socio, senior } = await categories(tenant);
    const ana = await student(tenant);
    await office(tenant, async () => {
      const api = new PersonCategoriesController();
      await api.add({ studentId: ana, categoryId: socio, proofSeenOn: day(0) });
      await api.add({ studentId: ana, categoryId: senior, proofSeenOn: day(0), notes: 'Cartão de cidadão' });
      const { categories: held } = await api.list(ana);
      assert.deepEqual(held.map((one) => one.name), ['Sénior', 'Sócio']);

      const list = await new FeeCategoriesController().list();
      assert.deepEqual(list.categories.map((one) => one.name), ['Sócio', 'Sénior'], 'display order unchanged');

      const [row] = await tenant.sql<{ name: string }>(
        `SELECT name FROM person_categories($1, NULL, $2) LIMIT 1`,
        [tenant.organizationId, ana],
      );
      assert.equal(row!.name, 'Sénior');
    });
  });
});

test('expired yesterday is not live, and 20 days left is on the expiry list and the circle (QA 2, 3)', async () => {
  await withScratchTenant(async (tenant) => {
    const { socio, senior } = await categories(tenant);
    const walkIn = await addMember(tenant, 'Rui', 'Banhista', []);
    await office(tenant, async () => {
      const api = new PersonCategoriesController();
      await api.add({ membershipId: walkIn, categoryId: senior, proofSeenOn: day(-400), validUntil: day(-1) });
      await api.add({ membershipId: walkIn, categoryId: socio, proofSeenOn: day(-10), validUntil: day(20) });

      const { categories: held } = await api.list(undefined, walkIn);
      assert.deepEqual(
        held.map((one) => [one.name, one.status]),
        [['Sénior', 'expired'], ['Sócio', 'expiring']],
      );
      const [live] = await tenant.sql<{ n: number }>(
        `SELECT count(*)::int AS n FROM person_categories($1, $2, NULL)`,
        [tenant.organizationId, walkIn],
      );
      assert.equal(live!.n, 1, 'only Sócio is live');

      const { expiring } = await api.expiring();
      assert.deepEqual(expiring.map((one) => [one.name, one.personName]), [['Sócio', 'Rui Banhista']]);
      assert.equal((await attentionForReader()).menu['categories'], 1);
    });
  });
});

test('an instructor is refused, a person of another club is a 404, refusals name a field (QA 4)', async () => {
  await withScratchTenant(async (tenant) => {
    const { socio } = await categories(tenant);
    const ana = await student(tenant);
    const id = await office(tenant, () =>
      new PersonCategoriesController().add({ studentId: ana, categoryId: socio, proofSeenOn: day(0) }),
    );

    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      const api = new PersonCategoriesController();
      await expectStatus(() => api.add({ studentId: ana, categoryId: socio, proofSeenOn: day(0) }), 403);
      await expectStatus(() => api.remove(id.id), 403);
      await expectStatus(() => api.list(ana), 403);
    });

    await withScratchTenant(async (other) => {
      const { socio: theirs } = await categories(other);
      await office(other, async () => {
        const api = new PersonCategoriesController();
        await expectStatus(() => api.add({ studentId: ana, categoryId: theirs, proofSeenOn: day(0) }), 404);
        await expectStatus(() => api.list(ana), 404);
        await expectStatus(() => api.remove(id.id), 404);
        await expectStatus(() => api.renew(id.id, { proofSeenOn: day(0) }), 404);
      });
    });

    await office(tenant, async () => {
      const api = new PersonCategoriesController();
      await expectStatus(() => api.add({ studentId: ana, categoryId: socio, proofSeenOn: day(0) }), 409);
      await expectStatus(
        () => api.renew(id.id, { proofSeenOn: day(0), notes: 'Cartão nº 12345678' }),
        400,
      );
      await expectStatus(() => api.renew(id.id, { proofSeenOn: day(0), validUntil: day(-1) }), 400);
      await api.renew(id.id, { proofSeenOn: day(0), validUntil: day(365) });
      await api.remove(id.id);
      assert.deepEqual((await api.list(ana)).categories, []);
      // A removed category can be ticked again.
      await api.add({ studentId: ana, categoryId: socio, proofSeenOn: day(0) });
    });

    const [audit] = await tenant.sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_log
        WHERE organization_id = $1 AND action LIKE 'person_category.%'`,
      [tenant.organizationId],
    );
    assert.equal(audit!.n, 4, 'added, renewed, removed, added');
  });
});

test('a student\'s own login sees their categories without the proof, and anonymising clears it (rule 6, QA 5)', async () => {
  await withScratchTenant(async (tenant) => {
    const { senior } = await categories(tenant);
    const login = await addMember(tenant, 'Ana', 'Costa', ['student']);
    const ana = await student(tenant, login);
    await office(tenant, () =>
      new PersonCategoriesController().add({
        studentId: ana,
        categoryId: senior,
        proofSeenOn: day(0),
        validUntil: day(90),
        notes: 'Cartão de cidadão',
      }),
    );

    const mine = await actingAs(tenant, { membershipId: login, roles: ['student'] }, () =>
      new AppController().categories(),
    );
    assert.deepEqual(mine.categories, [{ name: 'Sénior', validUntil: day(90) }]);
    assert.doesNotMatch(JSON.stringify(mine), /Cartão|proof/);

    await tenant.sql(`UPDATE student SET anonymised_at = now() WHERE id = $1`, [ana]);
    const [row] = await tenant.sql<{ notes: string | null; proof_seen_by: string | null }>(
      `SELECT notes, proof_seen_by FROM person_category WHERE student_id = $1`,
      [ana],
    );
    assert.equal(row!.notes, null);
    assert.equal(row!.proof_seen_by, null);
  });
});
