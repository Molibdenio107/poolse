import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { MeetInboxController } from './meet-inbox.controller.js';
import { MeetsController } from './meets.controller.js';
import { receiveResults, tokensIn, type IncomingAttachment } from './meet-inbox.repository.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * Results by email — POOLSE-114.
 *
 * `receiveResults` is the path the Resend webhook and the dev endpoint both
 * call, so these drive it directly: which club, who sent it, what it carried,
 * once. Then the club's side — the list, *Importar* through the ordinary
 * import, *Rejeitar*, a new address.
 *
 * Run: pnpm api:test   (needs pnpm db:up, and the storage container)
 */

/** The owner login — only the platform writes `disabled_modules`, so a test sets it directly. */
const owner = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 1 });

const DOMAIN = 'inbound.poolse.test';
let savedDomain: string | undefined;
before(() => {
  savedDomain = process.env['INBOUND_DOMAIN'];
  process.env['INBOUND_DOMAIN'] = DOMAIN;
});
after(async () => {
  if (savedDomain === undefined) delete process.env['INBOUND_DOMAIN'];
  else process.env['INBOUND_DOMAIN'] = savedDomain;
  await closeHarness();
});

const lef = (name: string, date: string): Buffer =>
  Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>
<LENEX version="3.0">
  <MEETS>
    <MEET name="${name}" city="Braga" course="LCM" nation="POR">
      <SESSIONS>
        <SESSION number="1" date="${date}">
          <EVENTS>
            <EVENT eventid="10" number="3" round="TIM">
              <SWIMSTYLE distance="100" relaycount="1" stroke="FREE" />
            </EVENT>
          </EVENTS>
        </SESSION>
      </SESSIONS>
      <CLUBS>
        <CLUB name="Clube" code="CST" nation="POR">
          <ATHLETES>
            <ATHLETE athleteid="1" firstname="Inês" lastname="Sousa" birthdate="2012-04-03" gender="F" license="204117">
              <RESULTS>
                <RESULT resultid="1" eventid="10" swimtime="00:01:02.34" />
              </RESULTS>
            </ATHLETE>
          </ATHLETES>
        </CLUB>
      </CLUBS>
    </MEET>
  </MEETS>
</LENEX>`,
    'utf8',
  );

const attach = (filename: string, bytes: Buffer, size: number | null = bytes.length): IncomingAttachment => ({
  filename,
  size,
  load: () => Promise.resolve(bytes),
});

async function tokenOf(tenant: ScratchTenant): Promise<string> {
  const [row] = await tenant.sql<{ token: string }>(
    'SELECT meet_inbox_token AS token FROM organization WHERE id = $1',
    [tenant.organizationId],
  );
  return row!.token;
}

async function emailOf(tenant: ScratchTenant, membershipId: string): Promise<string> {
  const [row] = await tenant.sql<{ email: string }>('SELECT email::text AS email FROM membership WHERE id = $1', [
    membershipId,
  ]);
  return row!.email;
}

const address = (token: string): string => `resultados-${token}@${DOMAIN}`;
let messageCount = 0;
const messageId = (): string => `test-${Date.now()}-${(messageCount += 1)}`;

async function inboxRows(tenant: ScratchTenant): Promise<{ meet_name: string; status: string }[]> {
  return tenant.sql('SELECT meet_name, status::text AS status FROM meet_inbox ORDER BY meet_name');
}

test('the address: our domain and the shape, in any case and with a display name', () => {
  const token = 'abcdefghij0123456789';
  assert.deepEqual(tokensIn([`Resultados <RESULTADOS-${token.toUpperCase()}@${DOMAIN.toUpperCase()}>`]), [token]);
  assert.deepEqual(tokensIn([`resultados-${token}@elsewhere.test`]), []);
  assert.deepEqual(tokensIn([`resultados-short@${DOMAIN}`, 'someone@else.test']), []);
});

test('QA 1, 5 — an admin forwards one file: a row with the meet, once however often it is delivered', async () => {
  await withScratchTenant(async (tenant) => {
    const admin = await addMember(tenant, 'Ana', 'Sousa', ['admin']);
    const id = messageId();
    const message = {
      providerMessageId: id,
      from: `Ana Sousa <${(await emailOf(tenant, admin)).toUpperCase()}>`,
      to: [address(await tokenOf(tenant))],
      attachments: [attach('inverno.lef', lef('Torneio de Inverno', '2026-12-12'))],
    };

    const [first] = await receiveResults(message);
    assert.equal(first!.status, 'accepted');
    const [second] = await receiveResults(message);
    assert.equal(second!.status, 'duplicate');

    const rows = await inboxRows(tenant);
    assert.deepEqual(rows, [{ meet_name: 'Torneio de Inverno', status: 'pending' }]);

    await actingAs(tenant, { roles: ['instructor'], membershipId: await addMember(tenant, 'Rui', 'Lopes', ['instructor']) }, async () => {
      const inbox = new MeetInboxController();
      const list = await inbox.list();
      assert.equal(list.pendingCount, 1);
      assert.equal(list.items[0]!.meetStartsOn, '2026-12-12');
      assert.equal(list.items[0]!.senderName, 'Ana Sousa');
      assert.equal(list.items[0]!.stale, false);
      assert.equal(list.address, address(await tokenOf(tenant)));
      assert.equal(list.canManage, false);
      assert.equal(list.limit, 15);
      assert.deepEqual(await inbox.count(), { pending: 1 });
    });

    // The stored file names its sender as the uploader, as a page upload would.
    const [file] = await tenant.sql<{ uploaded_by: string; content_type: string }>(
      `SELECT uploaded_by, content_type FROM stored_file WHERE purpose = 'meet_results'`,
    );
    assert.equal(file!.uploaded_by, admin);
    assert.equal(file!.content_type, 'application/xml');
  });
});

test('QA 2 — a stranger, and a member with no import role, create nothing and get no reply', async () => {
  await withScratchTenant(async (tenant) => {
    const maintenance = await addMember(tenant, 'Tó', 'Faria', ['maintenance']);
    const to = [address(await tokenOf(tenant))];
    const attachments = [attach('inverno.lef', lef('Torneio', '2026-12-12'))];

    const [stranger] = await receiveResults({ providerMessageId: messageId(), from: 'x@nobody.test', to, attachments });
    assert.deepEqual(stranger, { status: 'dropped', reason: 'unknown_sender', organizationId: tenant.organizationId });

    const [notAllowed] = await receiveResults({
      providerMessageId: messageId(),
      from: await emailOf(tenant, maintenance),
      to,
      attachments,
    });
    assert.equal(notAllowed!.status, 'dropped');

    assert.equal((await tenant.sql('SELECT 1 FROM meet_inbox_message')).length, 0);
    assert.equal((await tenant.sql(`SELECT 1 FROM stored_file WHERE purpose = 'meet_results'`)).length, 0);
  });
});

test('QA 3 — an instructor sends only a PDF: no row, and the message is remembered so the reply goes once', async () => {
  await withScratchTenant(async (tenant) => {
    const instructor = await addMember(tenant, 'Rui', 'Lopes', ['instructor']);
    const message = {
      providerMessageId: messageId(),
      from: await emailOf(tenant, instructor),
      to: [address(await tokenOf(tenant))],
      attachments: [attach('resultados.pdf', Buffer.from('%PDF-1.4'))],
    };
    const [first] = await receiveResults(message);
    assert.equal(first!.status, 'no_lenex');
    const [again] = await receiveResults(message);
    assert.equal(again!.status, 'duplicate');
    assert.equal((await inboxRows(tenant)).length, 0);
    const [row] = await tenant.sql<{ file_count: number }>('SELECT file_count FROM meet_inbox_message');
    assert.equal(row!.file_count, 0);
  });
});

test('QA 4 — two LENEX files and an oversized one: two rows, and the big one refused', async () => {
  await withScratchTenant(async (tenant) => {
    const admin = await addMember(tenant, 'Ana', 'Sousa', ['admin']);
    const [received] = await receiveResults({
      providerMessageId: messageId(),
      from: await emailOf(tenant, admin),
      to: [address(await tokenOf(tenant))],
      attachments: [
        attach('a.lef', lef('Prova A', '2026-11-01')),
        attach('b.LEF', lef('Prova B', '2026-11-08')),
        attach('grande.lef', Buffer.alloc(16), 11 * 1024 * 1024),
        attach('lixo.lxf', Buffer.from('not a zip')),
      ],
    });
    const outcome = received!;
    assert.equal(outcome.status, 'accepted');
    if (outcome.status !== 'accepted') return;
    assert.equal(outcome.inboxIds.length, 2);
    assert.deepEqual(
      outcome.rejected.map((file) => [file.filename, file.reason]),
      [
        ['grande.lef', 'too_big'],
        ['lixo.lxf', 'not_lenex'],
      ],
    );
    assert.deepEqual(
      (await inboxRows(tenant)).map((row) => row.meet_name),
      ['Prova A', 'Prova B'],
    );
  });
});

test('QA 6 — Importar: the file comes back for the dialog, and the commit marks the row imported', async () => {
  await withScratchTenant(async (tenant) => {
    const admin = await addMember(tenant, 'Ana', 'Sousa', ['admin']);
    const bytes = lef('Torneio de Inverno', '2026-12-12');
    const [outcome] = await receiveResults({
      providerMessageId: messageId(),
      from: await emailOf(tenant, admin),
      to: [address(await tokenOf(tenant))],
      attachments: [attach('inverno.lef', bytes)],
    });
    assert.equal(outcome!.status, 'accepted');
    const inboxId = outcome!.status === 'accepted' ? outcome!.inboxIds[0]! : '';

    await actingAs(tenant, { roles: ['admin'], membershipId: admin }, async () => {
      const file = await new MeetInboxController().file(inboxId);
      const chunks: Buffer[] = [];
      for await (const chunk of file.getStream()) chunks.push(Buffer.from(chunk as Uint8Array));
      assert.ok(Buffer.concat(chunks).equals(bytes));

      const body = {
        fileName: 'inverno.lef',
        clubCode: 'CST',
        official: true,
        meet: { name: 'Torneio de Inverno', city: 'Braga', course: 'lcm', startsOn: '2026-12-12', endsOn: '2026-12-12' },
        athletes: [],
        confirmed: {},
        writeLicence: {},
        inboxId,
      };
      const meets = new MeetsController();
      await meets.import(body);
      assert.equal((await inboxRows(tenant))[0]!.status, 'pending', 'a preview changes nothing');
      const written = await meets.import({ ...body, commit: true });
      const [row] = await tenant.sql<{ status: string; meet_id: string }>(
        'SELECT status::text AS status, meet_id FROM meet_inbox WHERE id = $1',
        [inboxId],
      );
      assert.equal(row!.status, 'imported');
      assert.equal(row!.meet_id, written.meetId);

      // Imported is marked, not hidden.
      const list = await new MeetInboxController().list();
      assert.equal(list.items[0]!.status, 'imported');
      assert.equal(list.items[0]!.meetId, written.meetId);
      assert.equal(list.pendingCount, 0);
    });
  });
});

test('QA 7 — Rejeitar is the office’s; an instructor is refused and another club’s row is not there', async () => {
  await withScratchTenant(async (tenant) => {
    const admin = await addMember(tenant, 'Ana', 'Sousa', ['admin']);
    const instructor = await addMember(tenant, 'Rui', 'Lopes', ['instructor']);
    const [outcome] = await receiveResults({
      providerMessageId: messageId(),
      from: await emailOf(tenant, admin),
      to: [address(await tokenOf(tenant))],
      attachments: [attach('inverno.lef', lef('Torneio', '2026-12-12'))],
    });
    const inboxId = outcome!.status === 'accepted' ? outcome!.inboxIds[0]! : '';

    await actingAs(tenant, { roles: ['instructor'], membershipId: instructor }, async () => {
      await expectStatus(() => new MeetInboxController().discard(inboxId, {}), 403);
      await expectStatus(() => new MeetInboxController().regenerate(), 403);
    });

    await withScratchTenant(async (other) => {
      await actingAs(other, { roles: ['owner'] }, async () => {
        await expectStatus(() => new MeetInboxController().discard(inboxId, {}), 404);
        await expectStatus(() => new MeetInboxController().file(inboxId), 404);
      });
    });

    await actingAs(tenant, { roles: ['admin'], membershipId: admin }, async () => {
      assert.deepEqual(await new MeetInboxController().discard(inboxId, { reason: 'Duplicado' }), { discarded: true });
      const list = await new MeetInboxController().list();
      assert.equal(list.total, 0, 'a discarded file leaves the list');
      // And it can no longer be imported.
      await expectStatus(() => new MeetInboxController().file(inboxId), 404);
    });
    const [audit] = await tenant.sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_log WHERE action = 'meet_inbox.discarded' AND entity_id = $1`,
      [inboxId],
    );
    assert.equal(audit!.n, 1);
  });
});

test('QA 8, 9 — a new address stops the old one; a club with the module off has none', async () => {
  await withScratchTenant(async (tenant) => {
    const admin = await addMember(tenant, 'Ana', 'Sousa', ['admin']);
    const from = await emailOf(tenant, admin);
    const old = await tokenOf(tenant);
    const attachments = [attach('inverno.lef', lef('Torneio', '2026-12-12'))];

    const fresh = await actingAs(tenant, { roles: ['admin'], membershipId: admin }, () =>
      new MeetInboxController().regenerate(),
    );
    assert.notEqual(fresh.address, address(old));
    assert.equal(fresh.address, address(await tokenOf(tenant)));

    const [toOld] = await receiveResults({ providerMessageId: messageId(), from, to: [address(old)], attachments });
    assert.deepEqual(toOld, { status: 'dropped', reason: 'unknown_token', organizationId: null });
    const [audit] = await tenant.sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_log WHERE action = 'meet_inbox.address_regenerated'`,
    );
    assert.equal(audit!.n, 1);

    await owner.query(`UPDATE organization SET disabled_modules = '{competition}' WHERE id = $1`, [tenant.organizationId]);
    const [off] = await receiveResults({
      providerMessageId: messageId(),
      from,
      to: [address(await tokenOf(tenant))],
      attachments,
    });
    assert.deepEqual(off, { status: 'dropped', reason: 'unknown_token', organizationId: null });
    assert.equal((await tenant.sql('SELECT 1 FROM meet_inbox_message')).length, 0);
  });
});
