import { withOrg } from '@poolse/db';
import { missingDetails, requiredDetails, type DetailField } from '@poolse/rules';
import type { AppUserSummary, MembershipSummary } from './identity.repository.js';

/**
 * What the active club still needs from this person — POOLSE-227.
 *
 * `GET /me` carries the answer, and the web app's `(app)` layouts draw the
 * *Confirmar os seus dados* gate in place of the page when it is not empty.
 * The rule (who needs what) is `requiredDetails` in `@poolse/rules`; this reads
 * the values it is judged against, where POOLSE-177 says each one lives: the
 * name from Clerk's cache, the mobile from `app_user`, the NIF and morada from
 * the person's own `membership` row in this club.
 *
 * Never under a borrowed identity: a view (POOLSE-188) or a Poolse support
 * membership (POOLSE-79) answers an empty list, so nobody is stopped on a form
 * that is not theirs.
 */
export async function detailsMissingFor(
  user: AppUserSummary,
  membership: MembershipSummary | undefined,
): Promise<DetailField[]> {
  if (membership === undefined) return [];
  if (membership.view !== null || membership.supportExpiresAt !== null) return [];

  const { organizationId, membershipId, roles } = membership;
  const asksStaff = roles.includes('instructor') || roles.includes('maintenance');
  const asksStudent = roles.includes('student');
  if (requiredDetails(roles, { adultPathStudent: true }).length === 0) return [];

  const row = await withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      tax_number: string | null;
      address: string | null;
      postal_code: string | null;
      locality: string | null;
      adult: boolean;
    }>(
      `SELECT m.tax_number, m.address, m.postal_code, m.locality,
              coalesce((SELECT bool_or(student_is_adult_path(s.organization_id, s.id))
                          FROM student s
                         WHERE s.organization_id = m.organization_id
                           AND s.membership_id = m.id
                           AND s.archived_at IS NULL
                           AND $2), false) AS adult
         FROM membership m
        WHERE m.id = $1 AND m.archived_at IS NULL`,
      [membershipId, asksStudent],
    );
    return rows[0] ?? null;
  });
  if (row === null) return [];

  const required = requiredDetails(roles, { adultPathStudent: row.adult });
  return missingDetails(required, {
    firstName: user.firstName,
    lastName: user.lastName,
    mobile: user.contactPhone,
    ...(asksStaff
      ? { taxNumber: row.tax_number, address: row.address, postalCode: row.postal_code, locality: row.locality }
      : {}),
  });
}
