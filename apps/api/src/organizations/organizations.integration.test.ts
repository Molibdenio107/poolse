import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withPlatform } from '@poolse/db';
import { OrganizationsController } from './organizations.controller.js';
import { forgetDisposableDomains, hashSignupIp } from './signup-claim.js';
import { listMemberships } from '../identity/identity.repository.js';
import { authStorage } from '../auth/auth.context.js';
import { withOrg } from '@poolse/db';
import {
  closeHarness,
  expectStatus,
  removeAppUser,
  removeTenant,
  withoutTenantScope,
} from '../test/harness.js';

/**
 * Signing up for one's own pool — slice 4.5.
 *
 * Every other integration test provisions its tenant through the harness. This
 * one goes through the controller, because the controller is what is under
 * test: the kind it parses, the default it falls back to, and what the new
 * tenant opens with. `docs/data-model.md`, decision 1 — a personal user is their
 * own organization, and this is the proof that nothing about that is special.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

let count = 0;

/**
 * An app_user with no organization, as the dashboard's create form sees them.
 *
 * Provisioned directly rather than through the Clerk API, which `ensureAppUser`
 * would otherwise call for an id it does not know.
 */
async function signedUpUser(email?: string): Promise<string> {
  count += 1;
  const clerkUserId = `user_test_signup_${process.pid}_${count}_${Math.floor(performance.now())}`;
  await withoutTenantScope(async (tx) => {
    await tx.query(`SELECT provision_app_user($1, $2, 'Ana', 'Lopes', NULL, now())`, [
      clerkUserId,
      // The address matters since POOLSE-62: it is what the trial ledger is
      // keyed on. Unique per user unless a test is making a point of two people
      // sharing one mailbox.
      email ?? `${clerkUserId}@example.test`,
    ]);
  });
  return clerkUserId;
}

/** Runs `fn` as a signed-in person who belongs to no organization yet. */
/**
 * A signup request, as Express hands one over.
 *
 * Only the headers matter: the endpoint reads `x-poolse-client-ip` for the soft
 * flag and nothing else off the request — POOLSE-62.
 */
function signupRequest(clientIp?: string): never {
  const headers: Record<string, string> = {};
  if (clientIp !== undefined) headers['x-poolse-client-ip'] = clientIp;
  return { headers } as never;
}

function asSignedIn<T>(clerkUserId: string, fn: () => Promise<T>): Promise<T> {
  return authStorage.run({ clerkUserId, sessionId: `sess_${clerkUserId}` } as never, fn);
}

test('4.5 — a personal signup opens with a pool, and /me says which kind it is', async () => {
  const clerkUserId = await signedUpUser();
  let organizationId: string | null = null;

  try {
    const created = await asSignedIn(clerkUserId, () =>
      new OrganizationsController().create({ name: 'Piscina de casa', kind: 'personal' }, signupRequest()),
    );
    organizationId = created.organizationId;

    assert.ok(created.poolId, 'a personal tenant opens with its pool already there');

    const memberships = await listMemberships(clerkUserId);
    assert.equal(memberships.length, 1);
    assert.equal(memberships[0]?.organizationKind, 'personal');
    assert.deepEqual(memberships[0]?.roles, ['owner']);

    // Inside the tenant, because a read outside it returns nothing — which the
    // first run of this test proved, as the isolation suite promises.
    const [pool] = await withOrg(created.organizationId, async (tx) =>
      (
        await tx.query<{ name: string; facility_id: string; seasons: number }>(
          `SELECT p.name, p.facility_id,
                  (SELECT count(*)::int FROM season s WHERE s.organization_id = p.organization_id) AS seasons
             FROM pool p WHERE p.id = $1 AND p.organization_id = $2`,
          [created.poolId, created.organizationId],
        )
      ).rows,
    );
    assert.equal(pool?.name, 'Piscina de casa', 'named like the site, which is named like the tenant');
    assert.equal(pool?.facility_id, created.facilityId);
    assert.equal(pool?.seasons, 0, 'a season is a turmas concept and there are none');
  } finally {
    if (organizationId !== null) await removeTenant(organizationId, clerkUserId);
  }
});

test('4.5 — no kind means a club, exactly as every caller before this slice expects', async () => {
  const clerkUserId = await signedUpUser();
  let organizationId: string | null = null;

  try {
    const created = await asSignedIn(clerkUserId, () =>
      new OrganizationsController().create({ name: 'Clube de Bairro' }, signupRequest()),
    );
    organizationId = created.organizationId;

    assert.equal(created.poolId, null, 'a club describes its own tanks');
    const memberships = await listMemberships(clerkUserId);
    assert.equal(memberships[0]?.organizationKind, 'business');
  } finally {
    if (organizationId !== null) await removeTenant(organizationId, clerkUserId);
  }
});

test('4.5 — a kind that is neither is refused, not coerced', async () => {
  const clerkUserId = await signedUpUser();

  try {
    await expectStatus(
      () =>
        asSignedIn(clerkUserId, () =>
          new OrganizationsController().create({ name: 'Algo', kind: 'hotel' }, signupRequest()),
        ),
      400,
    );
  } finally {
    await removeAppUser(clerkUserId);
  }
});

// ---------------------------------------------------------------------------
// One person, one trial — POOLSE-62
// ---------------------------------------------------------------------------

/**
 * A mailbox nobody else in this database is using.
 *
 * The ledger is keyed on the address and a claim outlives its organization *by
 * design*, so a fixed address in a test is a test that passes once and then
 * refuses itself for ever. The same reason `stripe_event` ids carry a run id.
 * The local part varies; the *domain* is the part a test is usually making a
 * point about, so it stays exactly as given.
 */
const RUN = `${process.pid}${Math.floor(performance.now())}`;

function mailbox(local: string, domain = 'exemplo.pt'): string {
  return `${local}-${RUN}@${domain}`;
}

/**
 * The refusal itself, so a test can read the code and the sentence.
 *
 * `expectStatus` in the harness asserts the status and swallows the body, and
 * the whole point here is *what the body does not say*.
 */
async function refused(
  fn: () => Promise<unknown>,
): Promise<{ status?: number; response?: { code?: string; message?: string } }> {
  try {
    await fn();
  } catch (error) {
    return error as { status?: number; response?: { code?: string; message?: string } };
  }
  throw new Error('Expected the signup to be refused, and it was not');
}

/** Every live claim on this address, read as the role that owns the ledger. */
async function claims(normalizedEmail: string): Promise<
  { organization_id: string; email_domain: string; signup_ip_hash: string | null }[]
> {
  return withPlatform(async (tx) => {
    const { rows } = await tx.query<{
      organization_id: string;
      email_domain: string;
      signup_ip_hash: string | null;
    }>(
      `SELECT organization_id, email_domain, signup_ip_hash
         FROM trial_claim
        WHERE normalized_email = $1 AND released_at IS NULL`,
      [normalizedEmail],
    );
    return rows;
  });
}

/** How many organizations this person belongs to, however they got there. */
async function organizationsOf(clerkUserId: string): Promise<number> {
  return withoutTenantScope(async (tx) => {
    const { rows } = await tx.query<{ n: string }>(
      `SELECT count(*) AS n
         FROM membership m
         JOIN app_user u ON u.id = m.app_user_id
        WHERE u.clerk_user_id = $1`,
      [clerkUserId],
    );
    return Number(rows[0]?.n ?? 0);
  });
}

/**
 * The same address, spelled to look like another one.
 *
 * The realistic abuse is not a second account — it is the *same* account,
 * re-registered as `r.u.i+poolse@gmail.com`. Gmail ignores the dots and the tag,
 * so the club's post arrives in the same inbox and the ledger has to agree.
 */
test('62.1 — a second trial on the same address, spelled differently, is refused', async () => {
  /*
   * One mailbox, two spellings. Gmail ignores the dots and the +tag, so both of
   * these arrive in the same inbox — and `normalize_signup_email` has to agree,
   * or the ledger is a ledger of spellings rather than of people.
   */
  const local = `rui.fonseca-${RUN}`;
  const normalized = `${local.replace(/\./g, '')}@gmail.com`;

  const first = await signedUpUser(`${local}@gmail.com`);
  const second = await signedUpUser(`${local.split('').join('.')}+poolse@GMAIL.com`);
  let organizationId: string | null = null;

  try {
    const created = await asSignedIn(first, () =>
      new OrganizationsController().create({ name: 'Clube Primeiro' }, signupRequest()),
    );
    organizationId = created.organizationId;

    const refusal = await asSignedIn(second, () =>
      refused(() =>
        new OrganizationsController().create({ name: 'Clube Segundo' }, signupRequest()),
      ),
    );
    assert.equal(refusal.status, 403);

    /*
     * The code is the same one a disposable domain gets, and the message says
     * nothing about a previous trial, a tenant, or which signal fired. Telling
     * an abuser which lever caught them is telling them what to change — and the
     * person reading it may be a real customer coming back.
     */
    const body = refusal.response ?? {};
    assert.equal(body.code, 'trial_not_available');
    /*
     * It may say a trial is not available — that is the answer. What it must
     * never say is that there was a *previous* one, or whose.
     */
    assert.doesNotMatch(String(body.message), /already|previous|again|existing|outra|anterior|já/i);
    assert.doesNotMatch(String(body.message), /Clube Primeiro/);

    // And nothing was left behind by the refusal — no tenant, no second claim.
    assert.equal(await organizationsOf(second), 0);
    assert.equal((await claims(normalized)).length, 1);
  } finally {
    if (organizationId) await removeTenant(organizationId, first);
    await removeAppUser(first);
    await removeAppUser(second);
  }
});

/**
 * A different address is nobody's business but its own, and the claim carries
 * the domain whole for the soft flag that reads it.
 */
test('62.4 — an unrelated address signs up normally, and its claim is written', async () => {
  const clerkUserId = await signedUpUser(mailbox('tesouraria', 'clubenautico.pt'));
  let organizationId: string | null = null;

  try {
    const created = await asSignedIn(clerkUserId, () =>
      new OrganizationsController().create({ name: 'Clube Náutico' }, signupRequest()),
    );
    organizationId = created.organizationId;

    const [claim] = await claims(mailbox('tesouraria', 'clubenautico.pt').toLowerCase());
    assert.ok(claim, 'the signup wrote its claim');
    assert.equal(claim.organization_id, organizationId);
    assert.equal(claim.email_domain, 'clubenautico.pt');
  } finally {
    if (organizationId) await removeTenant(organizationId, clerkUserId);
    await removeAppUser(clerkUserId);
  }
});

/**
 * A personal tenant claims too — an individual tracking their own pool gets the
 * same fifteen days, so a carve-out would be a second signup path to abuse.
 */
test('62 — a personal signup claims its address like any other', async () => {
  const clerkUserId = await signedUpUser(mailbox('particular'));
  let organizationId: string | null = null;

  try {
    const created = await asSignedIn(clerkUserId, () =>
      new OrganizationsController().create(
        { name: 'Piscina de casa', kind: 'personal' },
        signupRequest(),
      ),
    );
    organizationId = created.organizationId;

    assert.equal((await claims(mailbox('particular'))).length, 1);
  } finally {
    if (organizationId) await removeTenant(organizationId, clerkUserId);
    await removeAppUser(clerkUserId);
  }
});

/**
 * The disposable list, and the fact that it is a file rather than code.
 *
 * Pointed at a temporary file so the assertion is about the *mechanism* — a
 * domain added or removed without a build — rather than about whichever domains
 * happen to be shipped today.
 */
test('62.6 — a disposable domain is refused, and the list is a file', async () => {
  const file = join(tmpdir(), `poolse-disposable-${process.pid}-${Date.now()}.txt`);
  writeFileSync(file, '# a comment, ignored\nninguem.example\n', 'utf8');

  const previous = process.env['SIGNUP_DISPOSABLE_DOMAINS_FILE'];
  process.env['SIGNUP_DISPOSABLE_DOMAINS_FILE'] = file;
  forgetDisposableDomains();

  const clerkUserId = await signedUpUser(mailbox('quinze-minutos', 'ninguem.example'));
  let organizationId: string | null = null;

  try {
    const refusal = await asSignedIn(clerkUserId, () =>
      refused(() => new OrganizationsController().create({ name: 'Efémero' }, signupRequest())),
    );
    assert.equal(refusal.status, 403);
    // The same refusal as a used address: this path says nothing about itself.
    assert.equal(refusal.response?.code, 'trial_not_available');
    assert.equal(await organizationsOf(clerkUserId), 0);

    // Taken off the list, the same address is ordinary — and no code changed.
    writeFileSync(file, '# nothing here any more\n', 'utf8');
    forgetDisposableDomains();

    const created = await asSignedIn(clerkUserId, () =>
      new OrganizationsController().create({ name: 'Efémero' }, signupRequest()),
    );
    organizationId = created.organizationId;
    assert.ok(organizationId);
  } finally {
    if (organizationId) await removeTenant(organizationId, clerkUserId);
    await removeAppUser(clerkUserId);
    rmSync(file, { force: true });

    if (previous === undefined) delete process.env['SIGNUP_DISPOSABLE_DOMAINS_FILE'];
    else process.env['SIGNUP_DISPOSABLE_DOMAINS_FILE'] = previous;
    forgetDisposableDomains();
  }
});

/**
 * The address is a flag and never a record — POOLSE-62 AC 7.
 *
 * What is stored is a salted digest. The assertion is deliberately the strong
 * one: the raw address appears nowhere in the row, and re-hashing the same
 * address reproduces the value, so the column really is derived from it rather
 * than from something else that happens to look random.
 */
test('62.9 — the signup address is hashed, and no raw IP is ever stored', async () => {
  const previous = process.env['SIGNUP_IP_SALT'];
  process.env['SIGNUP_IP_SALT'] = 'test-salt';

  const clerkUserId = await signedUpUser(mailbox('flag'));
  let organizationId: string | null = null;

  try {
    const created = await asSignedIn(clerkUserId, () =>
      new OrganizationsController().create(
        { name: 'Clube Bandeira' },
        // Two hops: the visitor first, the proxy after. The client is the head.
        signupRequest('203.0.113.7, 70.41.3.18'),
      ),
    );
    organizationId = created.organizationId;

    const [claim] = await claims(mailbox('flag'));
    assert.ok(claim?.signup_ip_hash, 'the flag was recorded');
    assert.notEqual(claim.signup_ip_hash, '203.0.113.7');
    assert.doesNotMatch(claim.signup_ip_hash ?? '', /203\.0\.113\.7/);
    assert.equal(claim.signup_ip_hash, hashSignupIp('203.0.113.7'));
  } finally {
    if (organizationId) await removeTenant(organizationId, clerkUserId);
    await removeAppUser(clerkUserId);

    if (previous === undefined) delete process.env['SIGNUP_IP_SALT'];
    else process.env['SIGNUP_IP_SALT'] = previous;
  }
});

/**
 * No salt, no hash, no flag.
 *
 * The honest failure rather than a silent downgrade: an unsalted digest of an
 * IPv4 address is the address with extra steps, so a deployment that has not
 * configured a salt records nothing at all.
 */
test('62.9 — with no salt configured, nothing about the address is stored', async () => {
  const previous = process.env['SIGNUP_IP_SALT'];
  delete process.env['SIGNUP_IP_SALT'];

  const clerkUserId = await signedUpUser(mailbox('sem-sal'));
  let organizationId: string | null = null;

  try {
    const created = await asSignedIn(clerkUserId, () =>
      new OrganizationsController().create(
        { name: 'Clube Sem Sal' },
        signupRequest('203.0.113.9'),
      ),
    );
    organizationId = created.organizationId;

    const [claim] = await claims(mailbox('sem-sal'));
    assert.equal(claim?.signup_ip_hash, null);
  } finally {
    if (organizationId) await removeTenant(organizationId, clerkUserId);
    await removeAppUser(clerkUserId);

    if (previous !== undefined) process.env['SIGNUP_IP_SALT'] = previous;
  }
});
