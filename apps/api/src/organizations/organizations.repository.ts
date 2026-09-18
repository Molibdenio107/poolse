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
}

export async function readTaxSettings(organizationId: string): Promise<TaxSettings> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ vat_number: string | null }>(
      'SELECT vat_number FROM organization WHERE id = $1',
      [organizationId],
    );
    return { taxNumber: rows[0]?.vat_number ?? null };
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

      return { taxNumber };
    });
  } catch (error) {
    const { code, constraint } = error as { code?: string; constraint?: string };
    if (code === '23505' && constraint === 'trial_claim_tax_number_uq') {
      throw new TaxNumberTakenError();
    }
    throw error;
  }
}
