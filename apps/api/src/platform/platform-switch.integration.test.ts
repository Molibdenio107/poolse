import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { authStorage } from '../auth/auth.context.js';
import { closeHarness } from '../test/harness.js';
import { PlatformController } from './platform.controller.js';
import { readSwitchesForClubs } from './platform-switch.js';

/**
 * Platform switches — Rui, 30-10-2026. The ID photo reader is turned on from
 * /admin: the write lands, is audited with its before and after, raises an
 * alert, and every club reads the new answer through /me.
 *
 * Run: pnpm api:test   (needs pnpm db:up and DATABASE_PLATFORM_URL)
 */

const controller = new PlatformController();
const owner = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 2 });
const clerkUserId = `user_switch_${Date.now()}`;

after(async () => {
  await owner.query(`UPDATE platform_switch SET enabled = false, changed_at = NULL, changed_by = NULL WHERE name = 'id_document_ai'`);
  await owner.query('DELETE FROM platform_alert WHERE clerk_user_id = $1', [clerkUserId]);
  await owner.query('DELETE FROM platform_audit_log WHERE clerk_user_id = $1', [clerkUserId]);
  await owner.end();
  await closeHarness();
});

function asOperator<T>(fn: () => Promise<T>): Promise<T> {
  return authStorage.run({ clerkUserId, sessionId: `sess_${clerkUserId}` }, fn);
}

test('the ID reader switch is off, flips on, is audited and alerted, and clubs read it', async () => {
  assert.equal((await readSwitchesForClubs()).id_document_ai, false);

  const saved = await asOperator(() => controller.setSwitch('id_document_ai', { enabled: true }));
  assert.equal(saved.enabled, true);
  assert.equal((await readSwitchesForClubs()).id_document_ai, true);

  const listed = await asOperator(() => controller.switches());
  assert.deepEqual(listed.map((one) => [one.name, one.enabled]), [['id_document_ai', true]]);

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
  await assert.rejects(asOperator(() => controller.setSwitch('id_document_ai', { enabled: 'yes' })), { status: 400 });
});
