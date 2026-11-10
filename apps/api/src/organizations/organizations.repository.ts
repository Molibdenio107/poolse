import { withOrg, withoutTenantScope } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import type { OrganizationKind } from '../identity/identity.repository.js';

export interface ProvisionedOrganization {
  organizationId: string;
  membershipId: string;
  facilityId: string;
  slug: string;
  /** The pool a personal tenant opens with — slice 4.5. Null for a club. */
  poolId: string | null;
}

/**
 * Raised when this address has already had its trial — POOLSE-62.
 *
 * The ledger's own refusal, turned into a type so the controller can answer with
 * a code rather than a 500. **It carries nothing about the first tenant**: not
 * its name, not when it signed up, not whether it still exists. The message that
 * reaches a person says the same thing whichever lever fired, because the person
 * reading it may be a real customer and because telling an abuser which signal
 * caught them is telling them what to change.
 */
export class TrialAlreadyClaimedError extends Error {
  constructor() {
    super('This address has already started a trial');
  }
}

/**
 * Stands up a whole tenant: organization on a 15-day trial, the caller as its
 * owner, and a first facility. A club also opens with a season; a personal
 * tenant opens with a pool instead — slice 4.5 — because readings hang off a
 * tank and a season is a turmas concept.
 *
 * **It also writes the trial claim**, in the same transaction — POOLSE-62. A
 * signup that fails leaves no claim and a claim that fails leaves no tenant,
 * which is one property rather than two, and the unique index on the normalised
 * address is what makes two simultaneous signups end with exactly one club.
 *
 * Cross-tenant by necessity — the caller belongs to nowhere yet, so there is no
 * GUC to satisfy the RLS policy on `organization` and an ordinary INSERT is
 * refused. That is the policy working, not a bug, and the answer is this one
 * reviewed function rather than a looser policy. See the header of the
 * `organization-signup` migration.
 *
 * All five inserts are one transaction inside the function, so a failure leaves
 * no half-made tenant behind.
 */
export async function provisionOrganization(
  clerkUserId: string,
  name: string,
  locale: string,
  facilityName: string | null,
  kind: OrganizationKind,
  signupIpHash: string | null = null,
): Promise<ProvisionedOrganization> {
  return withoutTenantScope(async (tx) => {
    let rows: {
      o_organization_id: string;
      o_membership_id: string;
      o_facility_id: string;
      o_slug: string;
      o_pool_id: string | null;
    }[];

    try {
      ({ rows } = await tx.query<{
        o_organization_id: string;
        o_membership_id: string;
        o_facility_id: string;
        o_slug: string;
        o_pool_id: string | null;
      }>(
        'SELECT * FROM provision_organization($1, $2, $3, $4, $5::organization_kind, $6)',
        [clerkUserId, name, locale, facilityName, kind, signupIpHash],
      ));
    } catch (error) {
      /*
       * The index is the check, and this is the only place it is read.
       *
       * No application query asks first — it could not: `trial_claim` is
       * platform-scoped and this runs on the tenant login. Letting the insert
       * happen and translating the refusal is also what makes a race come out
       * right: two signups on one address both reach the index, one wins, and
       * the loser's whole tenant rolls back with it.
       */
      const { code, constraint } = error as { code?: string; constraint?: string };
      if (code === '23505' && constraint === 'trial_claim_email_uq') {
        throw new TrialAlreadyClaimedError();
      }
      throw error;
    }

    const row = rows[0];
    if (!row) throw new Error(`provision_organization returned nothing for ${clerkUserId}`);

    return {
      organizationId: row.o_organization_id,
      membershipId: row.o_membership_id,
      facilityId: row.o_facility_id,
      slug: row.o_slug,
      poolId: row.o_pool_id,
    };
  });
}

// ---------------------------------------------------------------------------
// Reposição settings — POOLSE-21
// ---------------------------------------------------------------------------

/**
 * The club's rules for aulas de reposição.
 *
 * `enabled` is off by default and stays off until somebody decides: a club that
 * has not thought about reposições should not discover it has been issuing them
 * for a season.
 *
 * `backfillOnly` and `mode` are read by redemption, which is the next slice.
 * They are surfaced now because they are one settings screen rather than two,
 * and because a club turning the feature on wants to answer all of it at once.
 */
export interface ReposicaoSettings {
  enabled: boolean;
  /** Days from the absence. Capped at the end of the época when a credit is minted. */
  windowDays: number;
  /** Credits per student per época, or null for no cap. */
  capPerSeason: number | null;
  /** Redeemable only into a slot another student has vacated — criterion 4. */
  backfillOnly: boolean;
  /** Who confirms a booking: the family, or staff. */
  mode: 'self_service' | 'request';
}

export async function reposicaoSettings(organizationId: string): Promise<ReposicaoSettings> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      reposicao_enabled: boolean;
      reposicao_window_days: number;
      reposicao_cap_per_season: number | null;
      reposicao_backfill_only: boolean;
      reposicao_mode: 'self_service' | 'request';
    }>(
      `SELECT reposicao_enabled, reposicao_window_days, reposicao_cap_per_season,
              reposicao_backfill_only, reposicao_mode
         FROM organization WHERE id = $1`,
      [organizationId],
    );

    const row = rows[0];
    if (!row) throw new Error('No such organization');

    return {
      enabled: row.reposicao_enabled,
      windowDays: row.reposicao_window_days,
      capPerSeason: row.reposicao_cap_per_season,
      backfillOnly: row.reposicao_backfill_only,
      mode: row.reposicao_mode,
    };
  });
}

/**
 * Writes the club's reposição rules.
 *
 * **Nothing here touches a credit that already exists**, and that is the whole
 * point of snapshotting the rule onto the row at mint time: shortening the
 * window in March must not shorten a credit issued in February. A family told
 * "you have until 11 May" has been told something, and a settings change is not
 * permission to un-tell them.
 *
 * The sane ranges are constraints in the schema rather than checks here, so a
 * value typed straight into the database is refused the same way.
 */
export async function saveReposicaoSettings(
  organizationId: string,
  settings: ReposicaoSettings,
): Promise<ReposicaoSettings> {
  return withOrg(organizationId, async (tx) => {
    await tx.query(
      `UPDATE organization
          SET reposicao_enabled        = $2,
              reposicao_window_days    = $3,
              reposicao_cap_per_season = $4,
              reposicao_backfill_only  = $5,
              reposicao_mode           = $6::reposicao_mode
        WHERE id = $1`,
      [
        organizationId,
        settings.enabled,
        settings.windowDays,
        settings.capPerSeason,
        settings.backfillOnly,
        settings.mode,
      ],
    );

    await recordAudit(tx, {
      action: 'reposicao.settings_changed',
      entityType: 'organization',
      entityId: organizationId,
      data: { ...settings },
    });

    return settings;
  });
}

// ---------------------------------------------------------------------------
// The club's own tax number — POOLSE-62, second half
// ---------------------------------------------------------------------------

/**
 * Raised when another club already holds this NIPC.
 *
 * Like the signup refusal, it carries **nothing about the other club** — not its
 * name, not whether it is still running. The same entity signing up twice and a
 * typo that happens to be somebody else's number look identical from here, and
 * only a person can tell them apart.
 */
export class TaxNumberTakenError extends Error {
  constructor() {
    super('Another organization already holds this tax number');
  }
}

/** What the club has told us about itself for invoicing. */
export interface TaxSettings {
  /** Nine digits, normalised, or null where nobody has filled it in. */
  taxNumber: string | null;
  /** *Como pagar* — POOLSE-86: the club's own words, the third card since POOLSE-94. */
  paymentInstructions: string | null;
  /** POOLSE-94: where families pay. `PT50…` without spaces, `+3519…`. */
  paymentIban: string | null;
  paymentAccountHolder: string | null;
  paymentMbwayPhone: string | null;
  /** POOLSE-209: where families' replies go; null until set. */
  replyEmail: string | null;
  /** Where they go meanwhile: the owner's login email. */
  replyEmailFallback: string | null;
  /** POOLSE-210: the club's published phone, `+` and digits; null publishes none. */
  contactPhone: string | null;
  /** The club's own name, as every screen and email shows it (10-11-2026: the owner renames it). */
  clubName: string;
}

const TAX_COLUMNS = `vat_number, payment_instructions, payment_iban, payment_account_holder, payment_mbway_phone,
  reply_email::text AS reply_email, contact_phone, name AS club_name,
  (SELECT u.cached_email::text
     FROM membership_role r
     JOIN membership m ON m.id = r.membership_id AND m.organization_id = r.organization_id
     JOIN app_user u ON u.id = m.app_user_id
    WHERE r.organization_id = organization.id AND r.role = 'owner' AND r.archived_at IS NULL
    LIMIT 1) AS reply_email_fallback`;

function toTaxSettings(row: {
  vat_number: string | null;
  payment_instructions: string | null;
  payment_iban: string | null;
  payment_account_holder: string | null;
  payment_mbway_phone: string | null;
  reply_email: string | null;
  reply_email_fallback: string | null;
  contact_phone: string | null;
  club_name: string;
} | undefined): TaxSettings {
  return {
    taxNumber: row?.vat_number ?? null,
    paymentInstructions: row?.payment_instructions ?? null,
    paymentIban: row?.payment_iban ?? null,
    paymentAccountHolder: row?.payment_account_holder ?? null,
    paymentMbwayPhone: row?.payment_mbway_phone ?? null,
    replyEmail: row?.reply_email ?? null,
    replyEmailFallback: row?.reply_email_fallback ?? null,
    contactPhone: row?.contact_phone ?? null,
    clubName: row?.club_name ?? '',
  };
}

/**
 * The club's email for families' replies — POOLSE-209. Owner and admin, checked
 * by the controller; changed, never cleared. Audited with the address: it is
 * the club's own and "what did this change to" is the question.
 */
export async function saveReplyEmail(organizationId: string, replyEmail: string): Promise<TaxSettings> {
  return withOrg(organizationId, async (tx) => {
    await tx.query('UPDATE organization SET reply_email = $2 WHERE id = $1', [organizationId, replyEmail]);
    await recordAudit(tx, {
      action: 'organization.reply_email_changed',
      entityType: 'organization',
      entityId: organizationId,
      data: { replyEmail },
    });
    const { rows } = await tx.query(`SELECT ${TAX_COLUMNS} FROM organization WHERE id = $1`, [organizationId]);
    return toTaxSettings(rows[0]);
  });
}

/**
 * The first value, from the create form — POOLSE-209. No audit entry: creation
 * runs outside any tenant context (`recordAudit` needs one), and the club's
 * creation is itself the event.
 */
export async function setInitialReplyEmail(organizationId: string, replyEmail: string): Promise<void> {
  await withOrg(organizationId, (tx) =>
    tx.query('UPDATE organization SET reply_email = $2 WHERE id = $1', [organizationId, replyEmail]),
  );
}

/**
 * The club's published phone — POOLSE-210. Owner and admin, checked by the
 * controller, which also normalises it; null clears it (a club may publish none).
 * Audited with the number, as the reply email is.
 */
export async function saveContactPhone(organizationId: string, contactPhone: string | null): Promise<TaxSettings> {
  return withOrg(organizationId, async (tx) => {
    await tx.query('UPDATE organization SET contact_phone = $2 WHERE id = $1', [organizationId, contactPhone]);
    await recordAudit(tx, {
      action: 'organization.contact_phone_changed',
      entityType: 'organization',
      entityId: organizationId,
      data: { contactPhone },
    });
    const { rows } = await tx.query(`SELECT ${TAX_COLUMNS} FROM organization WHERE id = $1`, [organizationId]);
    return toTaxSettings(rows[0]);
  });
}

/**
 * *Contactos* on Dados do clube — 10-11-2026 (Rui): the reply email and the
 * phone are one card with one Guardar, so they are saved in one transaction,
 * both or neither. Each change is audited as its own route audits it.
 */
export async function saveClubContacts(
  organizationId: string,
  replyEmail: string,
  contactPhone: string | null,
): Promise<TaxSettings> {
  return withOrg(organizationId, async (tx) => {
    await tx.query('UPDATE organization SET reply_email = $2, contact_phone = $3 WHERE id = $1', [
      organizationId,
      replyEmail,
      contactPhone,
    ]);
    await recordAudit(tx, {
      action: 'organization.reply_email_changed',
      entityType: 'organization',
      entityId: organizationId,
      data: { replyEmail },
    });
    await recordAudit(tx, {
      action: 'organization.contact_phone_changed',
      entityType: 'organization',
      entityId: organizationId,
      data: { contactPhone },
    });
    const { rows } = await tx.query(`SELECT ${TAX_COLUMNS} FROM organization WHERE id = $1`, [organizationId]);
    return toTaxSettings(rows[0]);
  });
}

/** The first value, from the create form — POOLSE-210; no audit, as `setInitialReplyEmail`. */
export async function setInitialContactPhone(organizationId: string, contactPhone: string): Promise<void> {
  await withOrg(organizationId, (tx) =>
    tx.query('UPDATE organization SET contact_phone = $2 WHERE id = $1', [organizationId, contactPhone]),
  );
}

/**
 * The club's name — 10-11-2026 (Rui): the owner's alone, checked by the
 * controller. Audited with the old and new name: it is on every email, invoice
 * and screen, and "who renamed us" is a fair question.
 */
export async function saveClubName(organizationId: string, name: string): Promise<TaxSettings> {
  return withOrg(organizationId, async (tx) => {
    const before = await tx.query<{ name: string }>('SELECT name FROM organization WHERE id = $1', [organizationId]);
    await tx.query('UPDATE organization SET name = $2 WHERE id = $1', [organizationId, name]);
    await recordAudit(tx, {
      action: 'organization.renamed',
      entityType: 'organization',
      entityId: organizationId,
      data: { from: before.rows[0]?.name ?? null, to: name },
    });
    const { rows } = await tx.query(`SELECT ${TAX_COLUMNS} FROM organization WHERE id = $1`, [organizationId]);
    return toTaxSettings(rows[0]);
  });
}

/** How a family reaches the club — POOLSE-210. */
export interface ClubContact {
  name: string;
  /** Null when the club publishes no phone. */
  phone: string | null;
  /** Where a reply goes: the club's email, else the owner's (POOLSE-209). */
  email: string | null;
}

/** The club's name, phone and reply address — nothing else of `organization`. */
export async function readClubContact(organizationId: string): Promise<ClubContact> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ name: string; contact_phone: string | null; reply_email: string | null; reply_email_fallback: string | null }>(
      `SELECT name, ${TAX_COLUMNS} FROM organization WHERE id = $1`,
      [organizationId],
    );
    const row = rows[0];
    return {
      name: row?.name ?? '',
      phone: row?.contact_phone ?? null,
      email: row?.reply_email ?? row?.reply_email_fallback ?? null,
    };
  });
}

/** POOLSE-209: one shape for an address, the database's CHECK in words. */
export const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function readTaxSettings(organizationId: string): Promise<TaxSettings> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query(`SELECT ${TAX_COLUMNS} FROM organization WHERE id = $1`, [organizationId]);
    return toTaxSettings(rows[0]);
  });
}

/**
 * Save the club's NIPC, and claim it.
 *
 * **One write, and the claim rides on it.** A trigger keeps
 * `trial_claim.tax_number` in step, so the check is inside the club's own
 * transaction rather than spread across two connections — the argument is in the
 * migration header. What reaches here is either a saved number or a refusal;
 * there is no state where the number is claimed and not saved.
 *
 * **Null is a legitimate answer** and clears both. A club correcting a typo
 * should not have to write in, and letting go of a number is not letting go of
 * the trial claim — the address stays held either way.
 *
 * The checksum is `isValidNif`'s to judge and the controller's to ask; this
 * takes digits and trusts them, so there is one definition of a valid number
 * rather than one per layer.
 */
export async function saveTaxNumber(
  organizationId: string,
  taxNumber: string | null,
): Promise<TaxSettings> {
  try {
    return await withOrg(organizationId, async (tx) => {
      await tx.query('UPDATE organization SET vat_number = $2 WHERE id = $1', [
        organizationId,
        taxNumber,
      ]);

      await recordAudit(tx, {
        action: 'organization.tax_number_changed',
        entityType: 'organization',
        entityId: organizationId,
        // The number itself: it is the club's own, it is on every fatura it
        // issues, and "what did this change to" is the question an audit answers.
        data: { taxNumber },
      });

      const { rows } = await tx.query(`SELECT ${TAX_COLUMNS} FROM organization WHERE id = $1`, [organizationId]);
      return toTaxSettings(rows[0]);
    });
  } catch (error) {
    const { code, constraint } = error as { code?: string; constraint?: string };
    if (code === '23505' && constraint === 'trial_claim_tax_number_uq') {
      throw new TaxNumberTakenError();
    }
    throw error;
  }
}

/**
 * *Como pagar* — POOLSE-86, 3.0b. The club's own words under every invoice
 * reminder (IBAN, MB WAY, office hours); null makes the reminder say to contact
 * the club. Audited by who changed it, not by what it says.
 */
export async function savePaymentInstructions(
  organizationId: string,
  text: string | null,
): Promise<TaxSettings> {
  await withOrg(organizationId, async (tx) => {
    await tx.query('UPDATE organization SET payment_instructions = $2 WHERE id = $1', [organizationId, text]);
    await recordAudit(tx, {
      action: 'organization.payment_instructions_changed',
      entityType: 'organization',
      entityId: organizationId,
      data: { cleared: text === null },
    });
  });
  return readTaxSettings(organizationId);
}
