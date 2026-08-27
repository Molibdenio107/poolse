import { ForbiddenException } from '@nestjs/common';
import { currentTenant } from './tenant.context.js';

/**
 * The `member_role` enum, mirrored in TypeScript.
 *
 * Duplicating an enum across the schema/code boundary is a small cost paid
 * knowingly: the alternative is generating types from the database, which is a
 * toolchain to maintain for one list that changes about once a year. The SQL
 * side is the source of truth — an unknown role coming back from a query is a
 * signal this list is stale, not that the query is wrong.
 */
export const MEMBER_ROLES = [
  'owner',
  'admin',
  'instructor',
  'maintenance',
  'student',
  'guardian',
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
 * Which roles may be handed out in an invitation — and `owner` is not one of
 * them, for anybody, ever.
 *
 * There is exactly one owner per organization and the only way it moves is
 * `transfer_ownership`. That is enforced by a unique index in the database, so
 * this list is not the guarantee; it is the interface agreeing with the
 * guarantee, which is what stops a request getting as far as a constraint
 * violation the operator would read as a crash.
 *
 * No longer takes a parameter. It used to return `owner` for owners, and the
 * absence of that argument is the point: there is no caller and no role for whom
 * the answer differs.
 */
export function grantableRoles(): MemberRole[] {
  return ['admin', 'instructor', 'maintenance', 'student', 'guardian'];
}
