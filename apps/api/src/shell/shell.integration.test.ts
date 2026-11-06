import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { ForbiddenException } from '@nestjs/common';
import { AttentionController } from '../attention/attention.controller.js';
import { SubscriptionController } from '../billing/subscription.controller.js';
import { MeetInboxController } from '../meets/meet-inbox.controller.js';
import { SupportGrantsController } from '../support/support.controller.js';
import { part, ShellController } from './shell.controller.js';
import { actingAs, closeHarness, withScratchTenant } from '../test/harness.js';
import type { ScratchTenant } from '../test/harness.js';

/**
 * The shell's one read — POOLSE-172. The layout's five calls became one, so
 * what this proves is that nobody got or lost anything by it: each part is what
 * its old route answers that reader, and a part the reader may not have is null.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

async function lead(tenant: ScratchTenant): Promise<void> {
  await tenant.sql(
    `INSERT INTO lead (organization_id, facility_id, swimmer_first_name, swimmer_last_name,
                       swimmer_birth_date, email, consent_text_version, consented_at)
     VALUES ($1, $2, 'Rita', 'Nova', '2017-03-01', 'familia@example.test', 'v1', now())`,
    [tenant.organizationId, tenant.facilityId],
  );
}

test('for the owner, every part is what its old route answers (QA 3)', async () => {
  await withScratchTenant(async (tenant) => {
    await lead(tenant);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const shell = await new ShellController().read();
      assert.deepEqual(shell.attention, await new AttentionController().read());
      assert.equal(shell.attention!.menu['leads'], 1);
      assert.equal(shell.meetInboxPending, (await new MeetInboxController().count()).pending);
      assert.deepEqual(shell.subscriptionAlert, await new SubscriptionController().alert());
      assert.deepEqual(shell.supportStatus, await new SupportGrantsController().status());
      assert.equal(shell.logoFileId, null);
    });
  });
});

test('an instructor gets the circles and the badge, and no subscription or support (QA 4)', async () => {
  await withScratchTenant(async (tenant) => {
    await lead(tenant);
    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      const shell = await new ShellController().read();
      assert.equal(shell.attention!.menu['leads'], undefined, 'pre-registrations are the office’s');
      assert.equal(shell.meetInboxPending, 0);
      assert.equal(shell.subscriptionAlert, null);
      assert.equal(shell.supportStatus, null);
    });
  });
});

test('a club with competition off has no inbox count (QA 7)', async () => {
  await withScratchTenant(async (tenant) => {
    // The switch is the platform's; the test throws it on the owner login.
    const owner = new pg.Client({ connectionString: process.env['DATABASE_URL'] });
    await owner.connect();
    await owner.query(`UPDATE organization SET disabled_modules = '{competition}' WHERE id = $1`, [
      tenant.organizationId,
    ]);
    await owner.end();
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      assert.equal((await new ShellController().read()).meetInboxPending, null);
    });
  });
});

test('another club’s pedido lends this club no circle (QA 5)', async () => {
  await withScratchTenant(async (mine) => {
    await withScratchTenant(async (theirs) => {
      await lead(theirs);
      await actingAs(mine, { roles: ['owner'] }, async () => {
        assert.equal((await new ShellController().read()).attention!.menu['leads'], undefined);
      });
    });
  });
});

test('a refused part and a failed part cost that part and nothing else (QA 9)', async () => {
  assert.equal(await part('refused', () => Promise.reject(new ForbiddenException())), null);
  assert.equal(await part('failed', () => Promise.reject(new Error('relation does not exist'))), null);
  assert.equal(await part('fine', () => Promise.resolve(3)), 3);
});
