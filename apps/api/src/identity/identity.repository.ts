import { withoutTenantScope } from '@poolse/db';

export interface AppUserSummary {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  locale: string;
  theme: string;
}

export interface MembershipSummary {
  appUserId: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  membershipId: string;
  roles: string[];
  /** trialing | active | past_due | canceled. Nothing enforces it until phase 2. */
  subscriptionStatus: string;
  trialEndsAt: string | null;
}

/**
 * Every function here calls a SECURITY DEFINER function rather than querying the
 * tables directly, and that is deliberate — see the header of the
 * `clerk-provisioning` migration. These questions are asked before a tenant is
 * known, so RLS would (correctly) answer "no rows" to a direct query. The set of
 * cross-tenant reads is exactly the set of functions listed below; if a new one
 * is needed, it gets a reviewed SQL function, not a raw query.
 */

export async function findAppUser(clerkUserId: string): Promise<AppUserSummary | null> {
  return withoutTenantScope(async (tx) => {
    const { rows } = await tx.query<{
      o_id: string;
      o_email: string | null;
      o_first_name: string | null;
      o_last_name: string | null;
      o_avatar_url: string | null;
      o_locale: string;
      o_theme: string;
    }>('SELECT * FROM find_app_user($1)', [clerkUserId]);

    const row = rows[0];
    if (!row) return null;

    return {
      id: row.o_id,
      email: row.o_email,
      firstName: row.o_first_name,
      lastName: row.o_last_name,
      avatarUrl: row.o_avatar_url,
      locale: row.o_locale,
      theme: row.o_theme,
    };
  });
}

export async function listMemberships(clerkUserId: string): Promise<MembershipSummary[]> {
  return withoutTenantScope(async (tx) => {
    const { rows } = await tx.query<{
      o_app_user_id: string;
      o_organization_id: string;
      o_organization_name: string;
      o_organization_slug: string;
      o_membership_id: string;
      o_roles: string[];
      o_subscription_status: string;
      o_trial_ends_at: Date | null;
    }>('SELECT * FROM resolve_memberships($1)', [clerkUserId]);

    return rows.map((row) => ({
      appUserId: row.o_app_user_id,
      organizationId: row.o_organization_id,
      organizationName: row.o_organization_name,
      organizationSlug: row.o_organization_slug,
      membershipId: row.o_membership_id,
      roles: row.o_roles,
      subscriptionStatus: row.o_subscription_status,
      trialEndsAt: row.o_trial_ends_at?.toISOString() ?? null,
    }));
  });
}

export interface ProvisionInput {
  clerkUserId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  eventAt: Date;
}

export async function provisionAppUser(input: ProvisionInput): Promise<string> {
  return withoutTenantScope(async (tx) => {
    const { rows } = await tx.query<{ provision_app_user: string }>(
      'SELECT provision_app_user($1, $2, $3, $4, $5, $6)',
      [
        input.clerkUserId,
        input.email,
        input.firstName,
        input.lastName,
        input.avatarUrl,
        input.eventAt,
      ],
    );

    const id = rows[0]?.provision_app_user;
    if (!id) throw new Error(`provision_app_user returned no id for ${input.clerkUserId}`);
    return id;
  });
}

/** Returns null when Clerk deletes a user we never saw — a no-op, not an error. */
export async function deactivateAppUser(
  clerkUserId: string,
  eventAt: Date,
): Promise<string | null> {
  return withoutTenantScope(async (tx) => {
    const { rows } = await tx.query<{ deactivate_app_user: string | null }>(
      'SELECT deactivate_app_user($1, $2)',
      [clerkUserId, eventAt],
    );
    return rows[0]?.deactivate_app_user ?? null;
  });
}

export interface Preferences {
  locale: string;
  theme: string;
}

/**
 * Change the caller's own language or theme.
 *
 * Cross-tenant, and the reason is worth reading twice: `app_user` carries no
 * organization_id, so its RLS policy scopes it *through membership* — you can see
 * a person only if they are a member of the organization you are scoped to. An
 * account that belongs to no organization therefore cannot see its own row. That
 * is the state every account starts in, so "change my language" has to go through
 * a reviewed function like everything else asked before a tenant exists.
 *
 * Null means "leave that one alone", so the two switchers share one call.
 */
export async function setPreferences(
  clerkUserId: string,
  locale: string | null,
  theme: string | null,
): Promise<Preferences> {
  return withoutTenantScope(async (tx) => {
    const { rows } = await tx.query<{ o_locale: string; o_theme: string }>(
      'SELECT * FROM set_app_user_preferences($1, $2, $3)',
      [clerkUserId, locale, theme],
    );

    const row = rows[0];
    if (!row) throw new Error(`set_app_user_preferences returned nothing for ${clerkUserId}`);
    return { locale: row.o_locale, theme: row.o_theme };
  });
}
