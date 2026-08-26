import { withoutTenantScope } from '@poolse/db';

export interface ProvisionedOrganization {
  organizationId: string;
  membershipId: string;
  facilityId: string;
  slug: string;
}

/**
 * Stands up a whole tenant: organization on a 14-day trial, the caller as its
 * owner, and a first facility.
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
): Promise<ProvisionedOrganization> {
  return withoutTenantScope(async (tx) => {
    const { rows } = await tx.query<{
      o_organization_id: string;
      o_membership_id: string;
      o_facility_id: string;
      o_slug: string;
    }>('SELECT * FROM provision_organization($1, $2, $3, $4)', [
      clerkUserId,
      name,
      locale,
      facilityName,
    ]);

    const row = rows[0];
    if (!row) throw new Error(`provision_organization returned nothing for ${clerkUserId}`);

    return {
      organizationId: row.o_organization_id,
      membershipId: row.o_membership_id,
      facilityId: row.o_facility_id,
      slug: row.o_slug,
    };
  });
}
