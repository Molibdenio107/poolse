import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException } from '@nestjs/common';
import pg from 'pg';
import { AI_READERS } from '@poolse/rules';
import { authStorage } from '../auth/auth.context.js';
import { PlatformController } from '../platform/platform.controller.js';
import { readBillingOverview } from '../platform/platform.repository.js';
import { actingAs, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';
import { AiReadsController } from './ai-reads.controller.js';
import { effectiveReadersFor } from './ai-reads.repository.js';

/**
 * The AI readers per club — POOLSE-137, against the real database.
 *
 * The grants are `packages/db/test/ai-read.sql`; this is the API: a claim only
 * for a reader ticked and switched on, the cap checked before a call and held
 * under two tabs, a failed call still counted, the /admin card and its audit,
 * and Faturação's totals now read from `ai_read`.
 *
 * `platform_switch` is global and every test file shares it, so the two
 * switches this file needs are put back as they were in `after`.
 *
 * Run: pnpm api:test   (needs pnpm db:up and DATABASE_PLATFORM_URL)
 */

const owner = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 2 });
const platform = new PlatformController();
const meter = new AiReadsController();

let switchesBefore: { name: string; enabled: boolean }[] = [];

before(async () => {
  const { rows } = await owner.query<{ name: string; enabled: boolean }>(
    `SELECT name, enabled FROM platform_switch WHERE name IN ('energy_invoice_ai', 'pdf_table_ai')`,
  );
  switchesBefore = rows;
  await owner.query(`UPDATE platform_switch SET enabled = true WHERE name = 'energy_invoice_ai'`);
  await owner.query(`UPDATE platform_switch SET enabled = false WHERE name = 'pdf_table_ai'`);
});

after(async () => {
  for (const row of switchesBefore) {
    await owner.query('UPDATE platform_switch SET enabled = $2 WHERE name = $1', [row.name, row.enabled]);
  }
  await owner.end();
  await closeHarness();
});

async function tick(tenant: ScratchTenant, readers: string[], cap: number | null = null): Promise<void> {
  await owner.query('UPDATE organization SET ai_readers = $2::ai_reader[], ai_monthly_cap = $3 WHERE id = $1', [
    tenant.organizationId,
    readers,
    cap,
  ]);
}

async function asOperator<T>(fn: (clerkUserId: string) => Promise<T>): Promise<T> {
  const clerkUserId = `user_ai_op_${Math.floor(performance.now())}`;
  await owner.query(
    `INSERT INTO platform_admin (clerk_user_id, note) VALUES ($1, 'ai readers test')
     ON CONFLICT (clerk_user_id) DO UPDATE SET archived_at = NULL`,
    [clerkUserId],
  );
  try {
    return await authStorage.run({ clerkUserId, sessionId: `sess_${clerkUserId}` }, () => fn(clerkUserId));
  } finally {
    await owner.query('DELETE FROM platform_alert WHERE clerk_user_id = $1', [clerkUserId]);
    await owner.query('DELETE FROM platform_audit_log WHERE clerk_user_id = $1', [clerkUserId]);
    await owner.query('DELETE FROM platform_admin WHERE clerk_user_id = $1', [clerkUserId]);
  }
}

function refusedWith(code: string) {
  return (error: unknown) =>
    error instanceof ConflictException && (error.getResponse() as { code: string }).code === code;
}

test('the ai_reader enum spells exactly AI_READERS, in order', async () => {
  const { rows } = await owner.query<{ value: string }>(
    `SELECT unnest(enum_range(NULL::ai_reader))::text AS value`,
  );
  assert.deepEqual(rows.map((row) => row.value), [...AI_READERS]);
});

test('QA 1: ticked and switched on, a claim is made and finished once with its tokens', async () => {
  await withScratchTenant(async (tenant) => {
    await tick(tenant, ['energy_invoice']);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { id } = await meter.claim({ reader: 'energy_invoice' });
      await meter.finish(id, { succeeded: true, model: 'claude-haiku-5-5', inputTokens: 1200, outputTokens: 300 });
      // Once: a second finish finds no open read.
      await expectStatus(() => meter.finish(id, { succeeded: false }), 404);
    });
    const { rows } = await owner.query(
      'SELECT reader::text, succeeded, model, input_tokens, output_tokens FROM ai_read WHERE organization_id = $1',
      [tenant.organizationId],
    );
    assert.deepEqual(rows, [
      { reader: 'energy_invoice', succeeded: true, model: 'claude-haiku-5-5', input_tokens: 1200, output_tokens: 300 },
    ]);
  });
});

test('QA 2–3: club tick off, or platform switch off, refuses before any call; /me agrees', async () => {
  await withScratchTenant(async (tenant) => {
    await tick(tenant, ['pdf_table']); // ticked, but pdf_table_ai is off
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await assert.rejects(() => meter.claim({ reader: 'energy_invoice' }), refusedWith('ai_reader_off'));
      await assert.rejects(() => meter.claim({ reader: 'pdf_table' }), refusedWith('ai_reader_off'));
    });
    assert.deepEqual(await effectiveReadersFor(tenant.organizationId), []);
    const { rows } = await owner.query('SELECT 1 FROM ai_read WHERE organization_id = $1', [tenant.organizationId]);
    assert.equal(rows.length, 0, 'a refused claim writes nothing');

    await asOperator(async () => {
      const card = await platform.tenantAi(tenant.organizationId);
      const pdf = card.readers.find((row) => row.reader === 'pdf_table')!;
      assert.equal(pdf.ticked, true);
      assert.equal(pdf.platformOn, false, 'the card can say desligada na plataforma');
    });

    await tick(tenant, ['energy_invoice']);
    assert.deepEqual(await effectiveReadersFor(tenant.organizationId), ['energy_invoice']);
  });
});

test('QA 4 + 6: a cap of 2 refuses the third; a failed call still counts', async () => {
  await withScratchTenant(async (tenant) => {
    await tick(tenant, ['energy_invoice'], 2);
    await actingAs(tenant, { roles: ['maintenance'] }, async () => {
      const first = await meter.claim({ reader: 'energy_invoice' });
      await meter.finish(first.id, { succeeded: false, model: 'claude-opus-5-5', inputTokens: 10, outputTokens: 0 });
      await meter.claim({ reader: 'energy_invoice' }); // never finished: still counts
      await assert.rejects(() => meter.claim({ reader: 'energy_invoice' }), refusedWith('ai_cap_reached'));
    });
    await asOperator(async () => {
      const card = await platform.tenantAi(tenant.organizationId);
      assert.equal(card.usedThisMonth, 2);
      assert.equal(card.monthlyCap, 2);
      const row = card.readers.find((r) => r.reader === 'energy_invoice')!;
      assert.equal(row.thisMonth.reads, 2);
      assert.equal(row.thisMonth.failed, 1, 'the unfinished claim is under an hour old, so not yet failed');
    });
  });
});

test('QA 5: a cap of 2 with one read, two claims at once — exactly one succeeds', async () => {
  await withScratchTenant(async (tenant) => {
    await tick(tenant, ['energy_invoice'], 2);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await meter.claim({ reader: 'energy_invoice' });
      const results = await Promise.allSettled([
        meter.claim({ reader: 'energy_invoice' }),
        meter.claim({ reader: 'energy_invoice' }),
      ]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
      assert.ok(refusedWith('ai_cap_reached')(rejected.reason));
    });
  });
});

test('QA 8: an instructor may not claim a bill read, and may claim a PDF table', async () => {
  await withScratchTenant(async (tenant) => {
    await tick(tenant, ['energy_invoice']);
    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      await expectStatus(() => meter.claim({ reader: 'energy_invoice' }), 403);
      // Allowed past the role check; refused only because the reader is off.
      await assert.rejects(() => meter.claim({ reader: 'pdf_table' }), refusedWith('ai_reader_off'));
      await expectStatus(() => meter.claim({ reader: 'curling' }), 400);
    });
  });
});

test('a reader whose module the club switched off is refused before any call', async () => {
  await withScratchTenant(async (tenant) => {
    await tick(tenant, ['energy_invoice']);
    await owner.query(`UPDATE organization SET disabled_modules = '{energy}' WHERE id = $1`, [tenant.organizationId]);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await expectStatus(() => meter.claim({ reader: 'energy_invoice' }), 403);
    });
    const { rows } = await owner.query('SELECT 1 FROM ai_read WHERE organization_id = $1', [tenant.organizationId]);
    assert.equal(rows.length, 0, 'a refused claim writes nothing');
  });
});

test('QA 9 + 11: an operator sets the ticks and cap, audited and alerted; an unpriced model costs —', async () => {
  await withScratchTenant(async (tenant) => {
    await asOperator(async (clerkUserId) => {
      const result = await platform.setAi(tenant.organizationId, {
        readers: ['pdf_table', 'energy_invoice'],
        monthlyCap: '40',
      });
      assert.deepEqual(result.changed['ai_readers'], { before: [], after: ['energy_invoice', 'pdf_table'] });
      assert.deepEqual(result.changed['ai_monthly_cap'], { before: null, after: 40 });

      const { rows: audit } = await owner.query<{ action: string }>(
        'SELECT action FROM platform_audit_log WHERE clerk_user_id = $1 AND organization_id = $2',
        [clerkUserId, tenant.organizationId],
      );
      assert.ok(audit.some((row) => row.action === 'tenant.ai.set'));
      const { rows: alerts } = await owner.query('SELECT 1 FROM platform_alert WHERE clerk_user_id = $1', [clerkUserId]);
      assert.ok(alerts.length > 0, 'the change raised an alert');

      await expectStatus(() => platform.setAi(tenant.organizationId, { readers: [], monthlyCap: 0 }), 400);
      await expectStatus(() => platform.setAi(tenant.organizationId, { readers: ['curling'] }), 400);
    });

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const priced = await meter.claim({ reader: 'energy_invoice' });
      await meter.finish(priced.id, { succeeded: true, model: 'claude-haiku-5-5', inputTokens: 1_000_000, outputTokens: 0 });
    });
    await asOperator(async () => {
      const row = (await platform.tenantAi(tenant.organizationId)).readers.find((r) => r.reader === 'energy_invoice')!;
      // $0.10 per million in → about 9 cents at 0.86.
      assert.equal(row.thisMonth.estimatedCents, 9);
      assert.equal(row.thisMonth.measured, 1);
    });

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const unpriced = await meter.claim({ reader: 'energy_invoice' });
      await meter.finish(unpriced.id, { succeeded: true, model: 'claude-future-9', inputTokens: 10, outputTokens: 10 });
    });
    await asOperator(async () => {
      const row = (await platform.tenantAi(tenant.organizationId)).readers.find((r) => r.reader === 'energy_invoice')!;
      assert.equal(row.thisMonth.estimatedCents, null);
    });
  });
});

test('QA 10: Faturação counts bill reads from ai_read, and all readers beside them', async () => {
  await withScratchTenant(async (tenant) => {
    await tick(tenant, ['energy_invoice']);
    const before = await readBillingOverview();
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const read = await meter.claim({ reader: 'energy_invoice' });
      await meter.finish(read.id, { succeeded: false });
    });
    const after = await readBillingOverview();
    assert.equal(after.energyReads.length, 6, 'six months, every one present');
    assert.equal(after.energyReads.at(-1)!.reads - before.energyReads.at(-1)!.reads, 1);
    assert.equal(after.energyReads.at(-1)!.unread - before.energyReads.at(-1)!.unread, 1);
    assert.equal(after.aiReads.at(-1)!.reads - before.aiReads.at(-1)!.reads, 1);
  });
});
