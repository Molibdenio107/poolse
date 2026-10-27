import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { StaffController } from './staff.controller.js';
import { RetentionService } from '../retention/retention.service.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';

/**
 * A staff member's date of birth and ID document — POOLSE-100, QA 1–6, against
 * the database: who reads and edits, the CC check digit, ciphertext at rest,
 * the audited read, the login's own birth date, and the erasure after leaving.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

const owner = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 1 });

after(async () => {
  await owner.end();
  await closeHarness();
});

const VALID_CC = '00000000 0 ZZ4';

test('POOLSE-100 — owner, admin and the person read and edit; a colleague cannot; the number is ciphertext and its reads are audited', async () => {
  await withScratchTenant(async (tenant) => {
    const coach = await addMember(tenant, 'Ana', 'Ribeiro', ['instructor']);
    const colleague = await addMember(tenant, 'Bruno', 'Lima', ['instructor']);
    const staff = new StaffController();

    // QA 1: the owner sets both on a coach with no login.
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const saved = await staff.editIdentity(coach, {
        birthDate: '1990-05-17',
        idDocumentType: 'cc',
        idDocumentNumber: VALID_CC,
      });
      assert.deepEqual(saved.idDocument, { type: 'cc', number: '000000000ZZ4' });
      assert.equal(saved.birthDate, '1990-05-17');
      assert.equal(saved.birthDateSource, 'record');
      assert.equal(saved.retentionMonths, 12);

      // QA 4: a wrong check digit is a field error, nothing saved.
      await expectStatus(
        () => staff.editIdentity(coach, { idDocumentType: 'cc', idDocumentNumber: '00000000 0 ZZ5' }),
        400,
      );
      // A passport is not held to the CC rule.
      const passport = await staff.editIdentity(coach, { idDocumentType: 'passport', idDocumentNumber: 'cb123456' });
      assert.deepEqual(passport.idDocument, { type: 'passport', number: 'CB123456' });
      await staff.editIdentity(coach, { idDocumentType: 'cc', idDocumentNumber: VALID_CC });

      // The record itself never carries the number (QA 5's promise: not in the list, the export or the import).
      const record = await staff.one(coach);
      assert.ok(!JSON.stringify(record).includes('000000000ZZ4'));
    });

    // At rest it is ciphertext, never the number.
    const [stored] = await tenant.sql<{ enc: string }>(
      `SELECT id_document_number_encrypted AS enc FROM membership WHERE id = $1`,
      [coach],
    );
    assert.match(stored!.enc, /^v1\./);
    assert.ok(!stored!.enc.includes('000000000'));

    // QA 6: the owner's read is in the audit log; the person's own read is not.
    const [reads] = await tenant.sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_log WHERE action = 'membership.id_document_read' AND entity_id = $1`,
      [coach],
    );
    assert.ok(reads!.n >= 1, 'the owner read it, and that is recorded');
    await actingAs(tenant, { membershipId: coach, roles: ['instructor'] }, async () => {
      // QA 3: the person sees and edits their own.
      const own = await staff.identity(coach);
      assert.equal(own.idDocument?.number, '000000000ZZ4');
      await staff.editIdentity(coach, { idDocumentType: 'cc', idDocumentNumber: VALID_CC });
    });
    const [after] = await tenant.sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_log WHERE action = 'membership.id_document_read' AND entity_id = $1`,
      [coach],
    );
    assert.equal(after!.n, reads!.n, "the person's own reads are not audited as somebody else's");

    // QA 2: a colleague sees neither, and the API refuses.
    await actingAs(tenant, { membershipId: colleague, roles: ['instructor'] }, async () => {
      await expectStatus(() => staff.identity(coach), 403);
      await expectStatus(() => staff.editIdentity(coach, { birthDate: '1980-01-01' }), 403);
    });

    // A login's birth date is theirs: read here, never overwritten by the office.
    await owner.query(
      `UPDATE app_user SET birth_date = '1985-03-03'
        WHERE id = (SELECT app_user_id FROM membership WHERE id = $1)`,
      [tenant.ownerMembershipId],
    );
    await actingAs(tenant, { roles: ['admin'] }, async () => {
      const login = await staff.identity(tenant.ownerMembershipId);
      assert.deepEqual([login.birthDate, login.birthDateSource], ['1985-03-03', 'login']);
      await expectStatus(() => staff.editIdentity(tenant.ownerMembershipId, { birthDate: '1999-09-09' }), 409);
    });

    // Retention: archived thirteen months ago, the document goes; the birth date stays.
    await owner.query(`UPDATE membership SET archived_at = now() - interval '13 months' WHERE id = $1`, [coach]);
    await new RetentionService().run(tenant.organizationId);
    const [gone] = await tenant.sql<{ type: string | null; enc: string | null; birth: string | null }>(
      `SELECT id_document_type AS type, id_document_number_encrypted AS enc, birth_date::text AS birth
         FROM membership WHERE id = $1`,
      [coach],
    );
    assert.deepEqual(gone, { type: null, enc: null, birth: '1990-05-17' });
  });
});
