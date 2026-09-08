import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FeePeriodsController,
  FeePlansController,
  StudentFeesController,
  StudentSocioController,
} from './fees.controller.js';
import { InvoicesController } from './invoices.controller.js';
import {
  actingAs,
  closeHarness,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';

/**
 * The sócio toggle attaches a quota, and takes it away again — F-01.
 *
 * The bug: ticking added the line, unticking left it in place, and it survived
 * a reload and went on counting towards the period total. A family gave up a
 * membership and kept paying 4,00 € a month for it.
 *
 * The two that matter here are the round trip — tick, untick, tick, and the
 * record is back where it started — and the pair that must **not** be removed:
 * a quota somebody has marked paid, and a quota already sitting on an issued
 * document. Archiving either would take money out of a total that has already
 * been reported to a family, so those keep the line and say why.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

/** A club with a quota on its price list, and one student. */
async function club(tenant: ScratchTenant): Promise<{ student: string }> {
  const [student] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name, birth_date)
     VALUES ($1, 'Matilde', 'Sousa', DATE '2014-05-02') RETURNING id`,
    [tenant.organizationId],
  );

  await actingAs(tenant, { roles: ['owner'] }, async () => {
    await new FeePeriodsController().create(tenant.facilityId, {
      name: 'Mensal',
      months: 1,
      isDefault: true,
    });
    await new FeePlansController().create(tenant.facilityId, {
      kind: 'quota',
      amountCents: 400,
    });
  });

  return { student: student!.id };
}

/** The live quota lines on a student's record. */
async function quotaLines(student: string): Promise<{ id: string }[]> {
  const { lines } = await new StudentFeesController().list(student);
  return lines.filter((line) => line.kind === 'quota').map((line) => ({ id: line.id }));
}

test('F-01 — ticking sócio adds the quota, unticking takes it away, and ticking puts it back', async () => {
  await withScratchTenant(async (tenant) => {
    const { student } = await club(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const socio = new StudentSocioController();

      const on = await socio.update(student, { isSocio: true });
      assert.equal(on.quotaAdded, true);
      assert.equal((await quotaLines(student)).length, 1, 'the quota is attached');

      /*
       * The half that was missing. Unticking returned early and did nothing, so
       * the line survived a reload and stayed in the period total — which is
       * indistinguishable, on screen, from the toggle not having saved.
       */
      const off = await socio.update(student, { isSocio: false });
      assert.equal(off.quotaRemoved, true);
      assert.equal(off.quotaKept, false);
      assert.equal((await quotaLines(student)).length, 0, 'the quota is gone');

      // And back again, because the add and the removal are symmetric over the
      // same set — otherwise a second tick would attach a second line.
      const again = await socio.update(student, { isSocio: true });
      assert.equal(again.quotaAdded, true);
      assert.equal((await quotaLines(student)).length, 1, 'exactly one, not two');
    });
  });
});

test('F-01 — a quota that has been paid survives the untick, and says so', async () => {
  await withScratchTenant(async (tenant) => {
    const { student } = await club(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const socio = new StudentSocioController();
      const fees = new StudentFeesController();

      await socio.update(student, { isSocio: true });
      const [quota] = await quotaLines(student);

      const { lines } = await fees.list(student);
      const line = lines.find((entry) => entry.id === quota!.id);
      await fees.paid(student, quota!.id, {
        isPaid: true,
        periodStart: line!.currentPeriodStart,
      });

      const off = await socio.update(student, { isSocio: false });

      // Kept, because archiving it would take money out of a total somebody has
      // already reconciled.
      assert.equal(off.quotaRemoved, false);
      assert.equal(off.quotaKept, true, 'the screen is told why the line stayed');
      assert.equal((await quotaLines(student)).length, 1);

      // The membership itself is off all the same — the two are separate facts.
      const { socio: state } = await fees.list(student);
      assert.equal(state.isSocio, false);
    });
  });
});

test('F-01 — a quota already on an issued document survives the untick', async () => {
  await withScratchTenant(async (tenant) => {
    const { student } = await club(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const socio = new StudentSocioController();
      await socio.update(student, { isSocio: true });

      const [quota] = await quotaLines(student);
      const { lines } = await new StudentFeesController().list(student);
      const period = lines.find((entry) => entry.id === quota!.id)!.currentPeriodStart!;

      // Bill the month the quota's current occurrence falls in.
      const run = await new InvoicesController().issue(tenant.facilityId, {
        periodStart: period,
      });
      assert.equal(run.drafts.length, 1, 'the quota was billable');

      const off = await socio.update(student, { isSocio: false });
      assert.equal(off.quotaRemoved, false);
      assert.equal(off.quotaKept, true);
      assert.equal((await quotaLines(student)).length, 1, 'a billed line is not withdrawn');
    });
  });
});

test('F-01 — a quota removed by hand leaves the membership alone', async () => {
  await withScratchTenant(async (tenant) => {
    const { student } = await club(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const socio = new StudentSocioController();
      const fees = new StudentFeesController();

      await socio.update(student, { isSocio: true });
      const [quota] = await quotaLines(student);
      await fees.archive(student, quota!.id);

      /*
       * The documented case, still working: "sócio sim, quota dispensada". An
       * honorary member is a real thing, and removing the line must not quietly
       * revoke the membership that the club voted on.
       */
      const { socio: state, lines } = await fees.list(student);
      assert.equal(state.isSocio, true);
      assert.equal(lines.filter((line) => line.kind === 'quota').length, 0);

      // And unticking now reports nothing dramatic: there was nothing to take.
      const off = await socio.update(student, { isSocio: false });
      assert.equal(off.quotaRemoved, false);
      assert.equal(off.quotaKept, false);
    });
  });
});
