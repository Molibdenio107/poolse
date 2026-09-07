import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { PartnersController } from './partners.controller.js';
import { actingAs, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';
import type { PartnerExportRow } from './partners.repository.js';

/**
 * The partner list, leaving and coming back — POOLSE-48, criterion 10.
 *
 * `partner-sheet.test.ts` on the web side proves the *headings* survive: what
 * the export writes as a header row, `matchPartnerColumns` reads back, in both
 * locales. This proves the other half, which only a real database can answer —
 * that the **rows** survive: a list exported and imported again is a list where
 * nothing has changed.
 *
 * That is a stronger assertion than it looks. It fails if the export drops a
 * field, if it writes a value in a shape the importer reads differently, or if
 * the two disagree about what "one row" is. It caught one of each while being
 * written: the type was written as `jardim_infancia` and read back as `outro`.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

function schoolSheet(): Record<string, string>[] {
  return [
    {
      partnerName: 'ES D. Dinis',
      partnerType: 'Escola',
      groupName: '6A',
      participantCount: '24',
      tag: 'Desporto escolar',
      contactName: 'Ana Matos',
      contactEmail: 'ana@esdinis.pt',
      notes: 'Entra pela rampa',
    },
    { partnerName: 'ES D. Dinis', partnerType: 'Escola', groupName: '6B', participantCount: '22' },
    {
      partnerName: 'O Barquinho',
      partnerType: 'jardim de infância',
      groupName: 'Sala Azul',
      participantCount: '18',
      ownInstructorName: 'Educadora Rita',
    },
  ];
}

/** The export's rows as the spreadsheet writer turns them into cells. */
function asSheetRows(rows: PartnerExportRow[]): Record<string, string>[] {
  return rows.map((row) => ({
    partnerName: row.partnerName,
    partnerType: row.partnerType,
    groupName: row.groupName,
    participantCount: row.groupName === '' ? '' : String(row.participantCount),
    levelName: row.levelName ?? '',
    tag: row.tag ?? '',
    ownInstructorName: row.ownInstructorName ?? '',
    contactName: row.contactName ?? '',
    contactEmail: row.contactEmail ?? '',
    contactPhone: row.contactPhone ?? '',
    notes: row.notes ?? '',
  }));
}

test('the export is one line per group, with the partner repeated', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const partners = new PartnersController();
      await partners.import(tenant.facilityId, { rows: schoolSheet(), commit: true });

      const { rows } = await partners.exportAll(tenant.facilityId);

      assert.equal(rows.length, 3);
      // Ordered by partner then group, so the file reads the way a person would
      // write it — and so two exports of an unchanged list are byte-identical.
      assert.deepEqual(
        rows.map((row) => `${row.partnerName}/${row.groupName}`),
        ['ES D. Dinis/6A', 'ES D. Dinis/6B', 'O Barquinho/Sala Azul'],
      );

      const [first] = rows;
      assert.ok(first);
      assert.equal(first.participantCount, 24);
      assert.equal(first.tag, 'Desporto escolar');
      assert.equal(first.notes, 'Entra pela rampa');
      // The contact is the partner's, so it repeats on every one of its groups.
      assert.equal(first.contactName, 'Ana Matos');
      assert.equal(rows[1]?.contactName, 'Ana Matos');
    });
  });
});

test('a partnership with no groups still has a line of its own', async () => {
  /*
   * The LEFT JOIN, tested. Skipping such a partner would drop a real
   * partnership out of its own export, and an operator who exported, edited and
   * re-imported would silently lose it. As a blank group it comes back as one
   * refused row with a named cause, which is a question rather than a
   * disappearance.
   */
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const partners = new PartnersController();
      const made = await partners.create(tenant.facilityId, {
        name: 'Câmara Municipal',
        type: 'camara',
      });
      assert.ok(made.id);

      const { rows } = await partners.exportAll(tenant.facilityId);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.partnerName, 'Câmara Municipal');
      assert.equal(rows[0]?.groupName, '');

      // And the round trip names it rather than losing it.
      const back = await partners.import(tenant.facilityId, { rows: asSheetRows(rows) });
      assert.equal(back.summary.refused, 1);
      assert.equal(back.rows[0]?.problems[0]?.code, 'groupRequired');
    });
  });
});

test('a list exported and imported again changes nothing at all', async () => {
  // Criterion 10, and criterion 5's "unticked by default" seen from the other
  // end: every row of a round trip is a stocktake with nothing to change, so a
  // club that exports, opens the file and imports it back writes no rows.
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const partners = new PartnersController();
      await partners.import(tenant.facilityId, { rows: schoolSheet(), commit: true });

      const exported = await partners.exportAll(tenant.facilityId);
      const back = await partners.import(tenant.facilityId, { rows: asSheetRows(exported.rows) });

      assert.equal(back.summary.refused, 0);
      assert.equal(back.summary.groupsToCreate, 0);
      assert.equal(back.summary.partnersToCreate, 0);
      assert.equal(back.summary.groupsExisting, 3);
      // The one that matters: not merely "recognised", but *unchanged*. A field
      // written in a shape the importer reads differently would show up here as
      // an update nobody asked for.
      assert.equal(back.summary.groupsToUpdate, 0);

      // The type included — `jardim_infancia` is two words joined by an
      // underscore and matched nothing in the human vocabulary until POOLSE-48.
      const barquinho = back.rows.find((row) => row.partnerName === 'O Barquinho');
      assert.equal(barquinho?.partnerType, 'jardim_infancia');
      assert.equal(barquinho?.warnings.length, 0);

      // And committing it writes nothing, because nothing is ticked by default.
      const committed = await partners.import(tenant.facilityId, {
        rows: asSheetRows(exported.rows),
        commit: true,
      });
      assert.equal(committed.createdPartners, 0);
      assert.equal(committed.createdGroups, 0);
      assert.equal(committed.updatedGroups, 0);
    });
  });
});

test('an instructor may not export the partner list', async () => {
  // Criterion 11. A partner sheet carries every school the club works with and
  // its coordinators' telephone numbers; that is not a list an instructor needs
  // in order to teach, and the import already takes the same role.
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      await expectStatus(() => new PartnersController().exportAll(tenant.facilityId), 403);
    });
  });
});

test('one tenant cannot export another tenant’s partners', async () => {
  await withScratchTenant(async (mine) => {
    await withScratchTenant(async (theirs) => {
      await actingAs(mine, { roles: ['owner'] }, async () => {
        await new PartnersController().import(mine.facilityId, {
          rows: schoolSheet(),
          commit: true,
        });
      });

      await actingAs(theirs, { roles: ['owner'] }, async () => {
        // Row-level security makes our site invisible, so the site lookup finds
        // nothing and the answer is a 404 rather than an empty list — the same
        // answer the import gives, and for the same reason.
        await expectStatus(() => new PartnersController().exportAll(mine.facilityId), 404);
        assert.deepEqual(await new PartnersController().exportAll(theirs.facilityId), { rows: [] });
      });
    });
  });
});
