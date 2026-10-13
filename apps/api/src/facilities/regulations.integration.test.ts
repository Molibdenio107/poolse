import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { ComplaintsSettingsController, RegulationsController } from './regulations.controller.js';
import { readPublicWaterPage } from './public-link.repository.js';
import { LIVRO_RECLAMACOES_URL } from './public-notices.js';
import { readLeadForm } from '../leads/leads.repository.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';

/**
 * The complaints book and the operating regulation — POOLSE-73.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

const day = (offset: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

test('a version takes effect on its day; the latest one whose day has come is in force', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const api = new RegulationsController();
      await api.publish(tenant.facilityId, { effectiveFrom: day(-30), body: 'Versão de setembro.' });
      await api.publish(tenant.facilityId, { effectiveFrom: day(-1), body: 'Versão corrigida.' });
      await api.publish(tenant.facilityId, { effectiveFrom: day(10), body: 'Versão da próxima época.' });

      const { versions } = await api.list(tenant.facilityId);
      assert.deepEqual(
        versions.map((v) => [v.body, v.current]),
        [
          ['Versão da próxima época.', false],
          ['Versão corrigida.', true],
          ['Versão de setembro.', false],
        ],
      );

      // Two versions taking effect on one day leave "which is in force" with no answer.
      await expectStatus(() => api.publish(tenant.facilityId, { effectiveFrom: day(-1), body: 'Outra.' }), 409);
      await expectStatus(() => api.publish(tenant.facilityId, { effectiveFrom: '2026-02-31', body: 'X' }), 400);
      await expectStatus(() => api.publish(tenant.facilityId, { effectiveFrom: day(0), body: '   ' }), 400);

      // Withdrawing the one in force puts the previous one back.
      const corrected = versions.find((v) => v.current)!;
      await api.archive(tenant.facilityId, corrected.id);
      const after = await api.list(tenant.facilityId);
      assert.equal(after.versions.find((v) => v.current)?.body, 'Versão de setembro.');
    });

    const [kept] = await tenant.sql<{ n: number }>(
      'SELECT count(*)::int AS n FROM facility_regulation WHERE facility_id = $1',
      [tenant.facilityId],
    );
    assert.equal(kept!.n, 3, 'a withdrawn version is archived, never deleted');
  });
});

test('the public pages carry the regulation in force and where a complaint goes', async () => {
  await withScratchTenant(async (tenant) => {
    const [pool] = await tenant.sql<{ id: string }>(
      `INSERT INTO pool (organization_id, facility_id, name) VALUES ($1, $2, 'Tanque') RETURNING id`,
      [tenant.organizationId, tenant.facilityId],
    );
    const token = 'reg_' + 'y'.repeat(40);
    await tenant.sql(
      `INSERT INTO pool_public_link (organization_id, pool_id, token) VALUES ($1, $2, $3)`,
      [tenant.organizationId, pool!.id, token],
    );
    const [org] = await tenant.sql<{ slug: string }>(
      `UPDATE organization SET public_registration_open = true WHERE id = $1 RETURNING slug`,
      [tenant.organizationId],
    );

    let page = await readPublicWaterPage(token);
    assert.equal(page!.regulation, null, 'no regulation published is said, not invented');
    assert.deepEqual(page!.complaints, { regime: 'private', url: LIVRO_RECLAMACOES_URL });

    await actingAs(tenant, { roles: ['admin'] }, () =>
      new RegulationsController().publish(tenant.facilityId, { effectiveFrom: day(-2), body: 'Touca obrigatória.' }),
    );
    page = await readPublicWaterPage(token);
    assert.deepEqual(page!.regulation, { effectiveFrom: day(-2), body: 'Touca obrigatória.' });

    const form = await readLeadForm(org!.slug);
    assert.equal(form!.regulations.length, 1);
    assert.equal(form!.regulations[0]!.body, 'Touca obrigatória.');
    assert.equal(form!.complaints.url, LIVRO_RECLAMACOES_URL);

    // A public service names its own platform, and every public page follows.
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const settings = new ComplaintsSettingsController();
      await expectStatus(() => settings.update({ regime: 'public_service', url: '' }), 400);
      await expectStatus(() => settings.update({ regime: 'public_service', url: 'http://inseguro.pt' }), 400);
      await settings.update({ regime: 'public_service', url: 'https://reclamacoes.camara.example.pt' });
    });
    page = await readPublicWaterPage(token);
    assert.deepEqual(page!.complaints, {
      regime: 'public_service',
      url: 'https://reclamacoes.camara.example.pt',
    });
  });
});

test('reading is staff; publishing and the complaints setting are Owner and Admin', async () => {
  await withScratchTenant(async (clubB) => {
    await withScratchTenant(async (tenant) => {
      const instructor = await addMember(tenant, 'Rui', 'Instrutor', ['instructor']);
      const guardian = await addMember(tenant, 'Ana', 'Mãe', ['guardian']);

      await actingAs(tenant, { membershipId: instructor, roles: ['instructor'] }, async () => {
        const api = new RegulationsController();
        assert.deepEqual((await api.list(tenant.facilityId)).versions, []);
        await expectStatus(() => api.publish(tenant.facilityId, { effectiveFrom: day(0), body: 'X' }), 403);
        await expectStatus(() => new ComplaintsSettingsController().read(), 403);
      });
      await actingAs(tenant, { membershipId: guardian, roles: ['guardian'] }, async () => {
        await expectStatus(() => new RegulationsController().list(tenant.facilityId), 403);
      });
      // Another club's facility is not found.
      await actingAs(tenant, { roles: ['owner'] }, async () => {
        const api = new RegulationsController();
        await expectStatus(() => api.list(clubB.facilityId), 404);
        await expectStatus(() => api.publish(clubB.facilityId, { effectiveFrom: day(0), body: 'X' }), 404);
      });
    });
  });
});
