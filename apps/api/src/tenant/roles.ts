import { ForbiddenException } from '@nestjs/common';
import { currentTenant } from './tenant.context.js';

/**
 * The `member_role` enum, mirrored in TypeScript — **in seniority order**.
 *
 * Duplicating an enum across the schema/code boundary is a small cost paid
 * knowingly: the alternative is generating types from the database, which is a
 * toolchain to maintain for one list that changes about once a year. The SQL
 * side is the source of truth — an unknown role coming back from a query is a
 * signal this list is stale, not that the query is wrong.
 *
 * **The order is the seniority order and is load-bearing.** POOLSE-17 AC5 says
 * permissions resolve to the union of a person's roles while the invite matrix
 * uses "the strongest role held"; POOLSE-18 AC3 orders badges by seniority. The
 * ticket asks for those to be one written rule rather than two implementations,
 * so this array is it, and `strongestRole` reads it. `lib/roles.ts` in the web
 * app carries the same order for the badges.
 *
 * Encarregado de educação outranks Student: a parent acting for a child is
 * further from the pool than the child is.
 */
export const MEMBER_ROLES = [
  'owner',
  'admin',
  'instructor',
  'maintenance',
  'guardian',
  'student',
] as const;

export type MemberRole = (typeof MEMBER_ROLES)[number];

export function isMemberRole(value: string): value is MemberRole {
  return (MEMBER_ROLES as readonly string[]).includes(value);
}

/**
 * Roles are read from the membership resolved by TenantMiddleware, never from
 * the JWT. Clerk knows who someone is; it does not know what they are allowed to
 * do inside an organization, and a claim that says otherwise is a claim the
 * client could have asked for.
 *
 * This is authorization, not tenant isolation — the two are easy to conflate.
 * Isolation is structural and lives in the database; if this check is missing
 * from a route, the worst case is an instructor doing an admin action *inside
 * their own organization*, not seeing another tenant. Slice 1.12 covers the rest
 * of the surface; invitations get it now because an instructor who can invite can
 * mint themselves an owner.
 */
export function requireRole(...allowed: readonly MemberRole[]): void {
  const { roles } = currentTenant();
  if (!allowed.some((role) => roles.includes(role))) {
    // `forbidden_role` rather than the bare message: the caller is a member in
    // good standing who simply may not do this, which is a different thing from
    // TenantMiddleware's `no_organization` and deserves a different screen.
    throw new ForbiddenException({
      code: 'forbidden_role',
      message: `Requires one of: ${allowed.join(', ')}`,
      required: [...allowed],
    });
  }
}

export function hasRole(...allowed: readonly MemberRole[]): boolean {
  const { roles } = currentTenant();
  return allowed.some((role) => roles.includes(role));
}

/**
 * Who may hand out which roles — POOLSE-01.
 *
 * A table, not a scatter of `if` statements, because the ticket is explicit that
 * this will change: "maintenance cannot invite" is marked *for now*, and moving
 * it should be editing one line rather than hunting for every place the rule was
 * expressed.
 *
 * **`owner` appears in nobody's row, including the owner's.** The ticket's matrix
 * says an owner may invite an owner; the schema says otherwise, and the schema
 * wins. `membership_role_one_owner` is a unique index enforcing exactly one owner
 * per organization — backlog round 2, story B9 — and the way the club changes
 * hands is `transfer_ownership`, which exists precisely so the rule is not a trap
 * when that person leaves. Two owners at once would reopen the licence-sharing
 * hole B9 closed, and this list is what stops a request reaching a constraint
 * violation the operator would read as a crash.
 *
 * An instructor may invite the families they teach and nobody else. That is not
 * a courtesy: an instructor who can invite an admin can invite themselves one.
 */
const INVITATION_MATRIX: Record<MemberRole, readonly MemberRole[]> = {
  owner: ['admin', 'instructor', 'maintenance', 'student', 'guardian'],
  admin: ['admin', 'instructor', 'maintenance', 'student', 'guardian'],
  instructor: ['student', 'guardian'],
  maintenance: [],
  student: [],
  guardian: [],
};

/**
 * Every role this caller may grant, across all the roles they hold.
 *
 * The union, because somebody who is both an owner and an instructor should be
 * able to do everything either can — and because the alternative, picking a
 * "primary" role, is a concept this product does not have.
 */
export function grantableRoles(): MemberRole[] {
  const { roles } = currentTenant();

  const allowed = new Set<MemberRole>();
  for (const held of roles) {
    if (!isMemberRole(held)) continue;
    for (const grantable of INVITATION_MATRIX[held]) allowed.add(grantable);
  }

  // Ordered by the enum rather than by insertion, so the invite dialog lists
  // roles the same way every time regardless of who is looking.
  return MEMBER_ROLES.filter((role) => allowed.has(role));
}

/**
 * Whether this caller may archive anything — POOLSE-03.
 *
 * One function, used by every archive endpoint and echoed to the client so a
 * button is never offered that the API would refuse. The ticket asks for exactly
 * this: a single shared check rather than the same pair of role names repeated
 * down eight controllers, where the ninth is the one somebody forgets.
 *
 * Archiving is destructive-looking and hard to explain after the fact — a class
 * group vanishing from a timetable is a phone call — so it stays with the two
 * roles that answer that phone call.
 */
export function canArchive(): boolean {
  return hasRole('owner', 'admin');
}

export function requireCanArchive(): void {
  if (!canArchive()) {
    throw new ForbiddenException({
      code: 'cannot_archive',
      message: 'Only owners and administrators can archive',
    });
  }
}

/** Whether this caller may invite anybody at all — for hiding the entry point. */
export function canInvite(): boolean {
  return grantableRoles().length > 0;
}

/**
 * Refuses a role change the caller may not make — POOLSE-01, criterion 4.
 *
 * The same table governs changing somebody's roles as governs inviting them.
 * Without this an admin could invite an instructor and then promote them to
 * owner, which is the escalation the matrix exists to prevent, arrived at in two
 * steps instead of one.
 */
export function requireGrantable(roles: readonly string[]): void {
  const allowed = new Set(grantableRoles());
  const refused = roles.filter((role) => !allowed.has(role as MemberRole));

  if (refused.length > 0) {
    throw new ForbiddenException({
      code: 'role_not_grantable',
      message: `Not allowed to grant: ${refused.join(', ')}`,
      refused,
    });
  }
}

/**
 * The most senior role in a set — POOLSE-17 AC5.
 *
 * Read from `MEMBER_ROLES`, which is the seniority order, so this and the badge
 * ordering can never disagree. The ticket is explicit that the union rule and
 * the "strongest role" rule must be reconciled in one place rather than
 * implemented twice; that place is here and the array above.
 *
 * For invitations the two give the same answer today, because the matrix is a
 * strict hierarchy — an owner may grant everything an admin may, and so on. This
 * exists so that if the matrix ever stops being a hierarchy, the divergence is a
 * decision somebody makes rather than a bug that appears.
 *
 * Null for somebody holding no roles at all: an unaccepted invitation, which is
 * a person the club knows about and who may do nothing yet.
 */
export function strongestRole(roles: readonly string[]): MemberRole | null {
  for (const role of MEMBER_ROLES) {
    if (roles.includes(role)) return role;
  }
  return null;
}

/** The acting person's strongest role. */
export function strongestRoleOf(): MemberRole | null {
  return strongestRole(currentTenant().roles);
}

/**
 * Every role the acting person holds, in seniority order.
 *
 * The union, which is what authorisation resolves to. Exported so that no call
 * site has to reach into the tenant context and re-derive it — the ticket's
 * "most likely to get wrong" is a single-role assumption left somewhere, and the
 * way to stop that is to make the union the only thing on offer.
 */
export function rolesHeld(): MemberRole[] {
  const { roles } = currentTenant();
  return MEMBER_ROLES.filter((role) => roles.includes(role));
}
