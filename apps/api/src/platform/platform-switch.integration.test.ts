import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { authStorage } from '../auth/auth.context.js';
import { closeHarness } from '../test/harness.js';
import { PlatformController } from './platform.controller.js';
import { readSwitchesForClubs } from './platform-switch.js';

/**
 * Platform switches — Rui, 30-10-2026; one per AI reader since POOLSE-137. A reader is turned on from
 * /admin: the write lands, is audited with its before and after, raises an
 * alert, and every club reads the new answer through /me.
 *
 * Run: pnpm api:test   (needs pnpm db:up and DATABASE_PLATFORM_URL)
 */

const controller = new PlatformController();
const owner = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 2 });
const clerkUserId = `user_switch_${Date.now()}`;

/*
 * The switch is global and a developer may have turned it on in their own
 * database, so it is put back exactly as it was rather than to "off". The
 * column-match reader's, because no other test file flips that one.
 */
const SWITCH = 'column_match_ai' as const;
let saved: { enabled: boolean; changed_at: Date | null; changed_by: string | null } | undefined;

before(async () => {
  const { rows } = await owner.query<NonNullable<typeof saved>>(
    'SELECT enabled, changed_at, changed_by FROM platform_switch WHERE name = $1',
    [SWITCH],
  );
  saved = rows[0];
  await owner.query('UPDATE platform_switch SET enabled = false WHERE name = $1', [SWITCH]);
});

after(async () => {
  await owner.query('UPDATE platform_switch SET enabled = $2, changed_at = $3, changed_by = $4 WHERE name = $1', [
    SWITCH,
    saved?.enabled ?? false,
    saved?.changed_at ?? null,
    saved?.changed_by ?? null,
  ]);
  await owner.query('DELETE FROM platform_alert WHERE clerk_user_id = $1', [clerkUserId]);
  await owner.query('DELETE FROM platform_audit_log WHERE clerk_user_id = $1', [clerkUserId]);
  await owner.end();
  await closeHarness();
});

function asOperator<T>(fn: () => Promise<T>): Promise<T> {
  return authStorage.run({ clerkUserId, sessionId: `sess_${clerkUserId}` }, fn);
}

test('a reader switch is off, flips on, is audited and alerted, and clubs read it', async () => {
  assert.equal((await readSwitchesForClubs())[SWITCH], false);

  const flipped = await asOperator(() => controller.setSwitch(SWITCH, { enabled: true }));
  assert.equal(flipped.enabled, true);
  assert.equal((await readSwitchesForClubs())[SWITCH], true);

  // All five AI readers are listed (POOLSE-137), in name order.
  const listed = await asOperator(() => controller.switches());
  assert.deepEqual(listed.map((one) => one.name), [
    'column_match_ai',
    'energy_invoice_ai',
    'id_document_ai',
    'pdf_table_ai',
    'water_report_ai',
  ]);
  assert.equal(listed.find((one) => one.name === SWITCH)?.enabled, true);

  const { rows: audit } = await owner.query<{ action: string; detail: { changed: { enabled: { before: boolean; after: boolean } } } }>(
    'SELECT action, detail FROM platform_audit_log WHERE clerk_user_id = $1',
    [clerkUserId],
  );
  assert.equal(audit.length, 1);
  assert.equal(audit[0]!.action, 'platform.switch.set');
  assert.deepEqual(audit[0]!.detail.changed.enabled, { before: false, after: true });

  const { rows: alerts } = await owner.query('SELECT 1 FROM platform_alert WHERE clerk_user_id = $1', [clerkUserId]);
  assert.equal(alerts.length, 1);
});

test('an unknown switch is a 404 and a non-boolean is a 400', async () => {
  await assert.rejects(asOperator(() => controller.setSwitch('everything', { enabled: true })), { status: 404 });
  await assert.rejects(asOperator(() => controller.setSwitch(SWITCH, { enabled: 'yes' })), { status: 400 });
});
