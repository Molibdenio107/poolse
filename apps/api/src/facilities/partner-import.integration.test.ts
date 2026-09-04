import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { PartnersController } from './partners.controller.js';
import { actingAs, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';
import type { ScratchTenant } from '../test/harness.js';

/**
 * Importing partnerships, against a real database — POOLSE-48.
 *
 * `partner-import.test.ts` proves what a row *means*, with no database in sight.
 * This proves the half that can only be wrong against real tables: that a
 * partner repeated down twelve rows becomes **one** partner row, that a commit
 * writes exactly what the preview promised, that a row the preview refuses
 * costs its own class and not the other eleven, and that neither a role nor a
 * tenant boundary can be walked through.
 *
 * The commit is one transaction and criterion 8 asks for it, but a partial write
 * turns out not to be reachable through the endpoint: `previewPartners` is at
 * least as strict as every constraint on the tables it writes, so a file the
 * preview approves is a file the commit can write. Writing the rollback test is
 * what surfaced that — and one place where it was *not* true, the contact with
 * no way of being reached, is the test below.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

/** The shape a school's sheet actually arrives in: a row per class. */
function schoolSheet(): Record<string, string>[] {
  return [
    { partnerName: 'ES D. Dinis', partnerType: 'Escola', groupName: '6A', participantCount: '24' },
    { partnerName: 'ES D. Dinis', partnerType: 'Escola', groupName: '6B', participantCount: '22' },
    {
      partnerName: 'ES D. Dinis',
      partnerType: 'Escola',
      groupName: '10G 11B',
      participantCount: '27',
    },
    {
      partnerName: 'Misericórdia de Santo Tirso',
      partnerType: 'IPSS',
      groupName: 'Hidroterapia',
      participantCount: '8',
    },
  ];
}

async function countRows(tenant: ScratchTenant): Promise<{ partners: number; groups: number }> {
  const [partners] = await tenant.sql<{ n: string }>(
    'SELECT count(*) AS n FROM partner WHERE archived_at IS NULL',
  );
  const [groups] = await tenant.sql<{ n: string }>(
    'SELECT count(*) AS n FROM partner_group WHERE archived_at IS NULL',
  );
  return { partners: Number(partners!.n), groups: Number(groups!.n) };
}

test('a preview writes nothing and promises what a commit will do', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const partners = new PartnersController();

      const preview = await partners.import(tenant.facilityId, { rows: schoolSheet() });

      assert.equal(preview.summary.partnersToCreate, 2);
      assert.equal(preview.summary.groupsToCreate, 4);
      assert.equal(preview.partners.length, 2);

      // Nothing at all has been written — the whole point of a preview.
      assert.deepEqual(await countRows(tenant), { partners: 0, groups: 0 });
    });
  });
});

test('twelve rows of one school become one partner with its classes', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const partners = new PartnersController();
      const result = await partners.import(tenant.facilityId, {
        rows: schoolSheet(),
        commit: true,
      });

      assert.equal(result.createdPartners, 2);
      assert.equal(result.createdGroups, 4);
      assert.deepEqual(await countRows(tenant), { partners: 2, groups: 4 });

      // The one that would go wrong if a repeated name were read the register's
      // way: three rows of ES D. Dinis are one school, not three.
      const [dinis] = await tenant.sql<{ id: string; type: string }>(
        `SELECT id, type::text AS type FROM partner WHERE name = 'ES D. Dinis'`,
      );
      assert.ok(dinis);
      assert.equal(dinis.type, 'escola');

      const groups = await tenant.sql<{ name: string; participant_count: number }>(
        `SELECT name, participant_count FROM partner_group
          WHERE partner_id = $1 ORDER BY name`,
        [dinis.id],
      );
      assert.deepEqual(groups.map((g) => g.name), ['10G 11B', '6A', '6B']);
      assert.deepEqual(groups.map((g) => g.participant_count), [27, 24, 22]);

      // And the type read the way a person writes it — "IPSS", not the enum.
      const [mis] = await tenant.sql<{ type: string }>(
        `SELECT type::text AS type FROM partner WHERE name LIKE 'Miseric%'`,
      );
      assert.equal(mis!.type, 'ipss_misericordia');
    });
  });
});

test('importing the same file twice creates nothing the second time', async () => {
  // 48.2. The commonest thing a club will really do with this is re-import last
  // year's list, and it has to be harmless.
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const partners = new PartnersController();
      await partners.import(tenant.facilityId, { rows: schoolSheet(), commit: true });

      const second = await partners.import(tenant.facilityId, {
        rows: schoolSheet(),
        commit: true,
      });

      assert.equal(second.createdPartners, 0);
      assert.equal(second.createdGroups, 0);
      // Every row is a stocktake, and unticked by default means untouched.
      assert.equal(second.summary.groupsExisting, 4);
      assert.equal(second.updatedGroups, 0);
      assert.deepEqual(await countRows(tenant), { partners: 2, groups: 4 });
    });
  });
});

test('a headcount that changed is a stocktake, and only when ticked', async () => {
  // 48.3 and 48.11 together: the count follows the ticks, not the file.
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const partners = new PartnersController();
      await partners.import(tenant.facilityId, { rows: schoolSheet(), commit: true });

      const changed = schoolSheet();
      changed[0]!.participantCount = '31';

      const preview = await partners.import(tenant.facilityId, { rows: changed });
      const row = preview.rows.find((r) => r.groupName === '6A');
      assert.deepEqual(row?.updates, [
        { field: 'participantCount', before: '24', after: '31' },
      ]);

      // Committing with nothing ticked leaves it at 24 — the operator has not
      // agreed to the overwrite yet.
      await partners.import(tenant.facilityId, { rows: changed, commit: true, include: [] });
      const [before] = await tenant.sql<{ participant_count: number }>(
        `SELECT participant_count FROM partner_group WHERE name = '6A'`,
      );
      assert.equal(before!.participant_count, 24);

      // Ticking that one row, and only that row, applies it.
      await partners.import(tenant.facilityId, {
        rows: changed,
        commit: true,
        include: [row!.index],
      });
      const [after] = await tenant.sql<{ participant_count: number }>(
        `SELECT participant_count FROM partner_group WHERE name = '6A'`,
      );
      assert.equal(after!.participant_count, 31);
    });
  });
});

test('a partner already at the site gains groups rather than being duplicated', async () => {
  // Criterion 4, against the real unique index rather than against a fixture.
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const partners = new PartnersController();
      const made = await partners.create(tenant.facilityId, {
        name: 'ES D. Dinis',
        type: 'escola',
      });

      await partners.import(tenant.facilityId, {
        // Typed differently by a different person, which is exactly what the
        // accent- and case-insensitive index exists for.
        rows: [{ partnerName: 'es d. dinis', groupName: '6A', participantCount: '24' }],
        commit: true,
      });

      assert.deepEqual(await countRows(tenant), { partners: 1, groups: 1 });
      const [group] = await tenant.sql<{ partner_id: string }>(
        `SELECT partner_id FROM partner_group WHERE name = '6A'`,
      );
      assert.equal(group!.partner_id, made.id);
    });
  });
});

test('a partnership whose every row is unticked is never created', async () => {
  /*
   * The lazy-creation rule. A school in the partner list with no classes under
   * it is a row nobody asked for, and it would then have to be archived by hand.
   */
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const partners = new PartnersController();
      const preview = await partners.import(tenant.facilityId, { rows: schoolSheet() });

      const dinisRows = preview.rows
        .filter((row) => row.partnerName === 'ES D. Dinis')
        .map((row) => row.index);
      const others = preview.rows
        .filter((row) => row.partnerName !== 'ES D. Dinis')
        .map((row) => row.index);
      assert.equal(dinisRows.length, 3);

      await partners.import(tenant.facilityId, {
        rows: schoolSheet(),
        commit: true,
        include: others,
      });

      const names = await tenant.sql<{ name: string }>(
        'SELECT name FROM partner WHERE archived_at IS NULL',
      );
      assert.deepEqual(names.map((n) => n.name), ['Misericórdia de Santo Tirso']);
    });
  });
});

test('a name-only contact is skipped rather than blowing up the commit', async () => {
  /*
   * `partner_contact_reachable` refuses a contact carrying neither an email nor
   * a telephone. A sheet with a `Contacto` column and no address is entirely
   * ordinary, so the row imports, the contact is not created, and the preview
   * says why.
   *
   * This is the register's `guardian_needs_a_key` bug in a new place — that one
   * reached production as a 500 that rolled back a whole file. Found here before
   * the commit could find it.
   */
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const partners = new PartnersController();
      const rows = [
        { partnerName: 'ES D. Dinis', groupName: '6A', contactName: 'Ana Marques' },
      ];

      const preview = await partners.import(tenant.facilityId, { rows });
      assert.ok(preview.rows[0]!.warnings.some((w) => w.code === 'contactNotReachable'));
      assert.equal(preview.rows[0]!.importable, true);

      const result = await partners.import(tenant.facilityId, { rows, commit: true });
      assert.equal(result.createdGroups, 1);

      const contacts = await tenant.sql('SELECT 1 FROM partner_contact');
      assert.equal(contacts.length, 0);

      // A telephone alone is enough — the constraint asks for either.
      await partners.import(tenant.facilityId, {
        rows: [
          {
            partnerName: 'Andebol Clube',
            groupName: 'Sub-16',
            contactName: 'Pedro Sousa',
            contactPhone: '912345678',
          },
        ],
        commit: true,
      });
      const reachable = await tenant.sql<{ name: string }>('SELECT name FROM partner_contact');
      assert.deepEqual(reachable.map((c) => c.name), ['Pedro Sousa']);
    });
  });
});

test('a refused row does not stop the rest of the file', async () => {
  /*
   * The commit is one transaction — `withOrg` gives it one, and criterion 8 asks
   * for it — but a *refused* row is not a failure: it never reaches the database
   * at all. `previewPartners` is deliberately at least as strict as every
   * constraint on the tables it writes, so a file the preview approves is a file
   * the commit can write, and a bad line costs its own class rather than the
   * other eleven.
   */
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const result = await new PartnersController().import(tenant.facilityId, {
        rows: [
          { partnerName: 'ES D. Dinis', groupName: '6A' },
          { partnerName: 'x'.repeat(300), groupName: '6B' },
          { partnerName: 'ES D. Dinis', groupName: '6C', participantCount: 'muitos' },
          { partnerName: 'ES D. Dinis', groupName: '6D' },
        ],
        commit: true,
      });

      assert.equal(result.summary.refused, 2);
      assert.equal(result.createdPartners, 1);
      assert.equal(result.createdGroups, 2);
      assert.deepEqual(await countRows(tenant), { partners: 1, groups: 2 });
    });
  });
});

test('an instructor may not import, however the request is made', async () => {
  // 48.14 and criterion 11. Bulk creation takes the role single creation takes.
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      await expectStatus(
        () => new PartnersController().import(tenant.facilityId, { rows: schoolSheet() }),
        403,
      );
      await expectStatus(
        () =>
          new PartnersController().import(tenant.facilityId, {
            rows: schoolSheet(),
            commit: true,
          }),
        403,
      );
    });
  });
});

test('a file committed under one tenant never reaches another', async () => {
  // 48.15.
  await withScratchTenant(async (mine) => {
    await withScratchTenant(async (theirs) => {
      await actingAs(mine, { roles: ['owner'] }, async () => {
        await new PartnersController().import(mine.facilityId, {
          rows: schoolSheet(),
          commit: true,
        });
      });

      await actingAs(theirs, { roles: ['owner'] }, async () => {
        // Their own site is empty, and ours is not theirs to import into.
        assert.deepEqual(await countRows(theirs), { partners: 0, groups: 0 });
        await expectStatus(
          () => new PartnersController().import(mine.facilityId, { rows: schoolSheet() }),
          404,
        );
      });
    });
  });
});

test('a sheet with no headcount column is still worth importing', async () => {
  // 48.7 and criterion 7 — only the two names are required.
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const result = await new PartnersController().import(tenant.facilityId, {
        rows: [
          { partnerName: 'ES D. Dinis', groupName: '6A' },
          { partnerName: 'ES D. Dinis', groupName: '6B' },
        ],
        commit: true,
      });

      assert.equal(result.createdGroups, 2);
      const counts = await tenant.sql<{ participant_count: number }>(
        'SELECT participant_count FROM partner_group ORDER BY name',
      );
      assert.deepEqual(counts.map((c) => c.participant_count), [0, 0]);
    });
  });
});

test('a coordinator repeated on every row becomes one contact', async () => {
  /*
   * A partnerships file repeats the contact down the column exactly as it
   * repeats the school. Inserting per row would give one school four identical
   * coordinators, which is the same bug as four schools, one level down.
   */
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await new PartnersController().import(tenant.facilityId, {
        rows: schoolSheet().map((row) => ({
          ...row,
          contactName: 'Ana Marques',
          contactEmail: 'ana@esdinis.pt',
        })),
        commit: true,
      });

      const contacts = await tenant.sql<{ name: string; partner_id: string }>(
        'SELECT name, partner_id FROM partner_contact WHERE archived_at IS NULL',
      );
      // One per partner, not one per row.
      assert.equal(contacts.length, 2);
      assert.equal(new Set(contacts.map((c) => c.partner_id)).size, 2);
    });
  });
});

test('an empty file and an oversized one are refused before anything is read', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const partners = new PartnersController();

      await expectStatus(() => partners.import(tenant.facilityId, { rows: [] }), 400);
      await expectStatus(
        () =>
          partners.import(tenant.facilityId, {
            rows: Array.from({ length: 2_001 }, (_, n) => ({
              partnerName: 'A',
              groupName: String(n),
            })),
          }),
        400,
      );
    });
  });
});
