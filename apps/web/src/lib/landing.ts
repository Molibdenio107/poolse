// The explicit extension is what lets `node --test` type-strip this file: it
// resolves ESM specifiers literally, unlike the bundler. `allowImportingTsExtensions`
// is on for exactly this.
import { MEMBER_ROLES } from './roles.ts';

/**
 * Where somebody lands after signing in — POOLSE-37.
 *
 * One helper, consulted by the post-sign-in redirect and by the authenticated
 * root. The ticket asks for exactly that and names why: scattered across
 * middleware and page components, the rule ends up meaning two different things
 * and the difference only shows for somebody holding two roles.
 *
 * **Strongest role wins**, using the same seniority order as the invite matrix
 * and the badges — Owner → Admin → Instructor → Maintenance → EE → Student. An
 * instructor who is also an admin lands where an admin lands.
 *
 * **A destination that is not built yet is skipped, not offered.** Maintenance
 * tasks and the student area are later modules, and AC5 is explicit that no role
 * may ever land on a page it cannot open. So the chain walks down until it finds
 * something this person can actually use, and ends at a page every member can
 * open.
 */

/** Where each role would go, if its destination exists. */
const DESTINATIONS: Partial<Record<(typeof MEMBER_ROLES)[number], string>> = {
  owner: '/dashboard/facilities',
  admin: '/dashboard/facilities',
  // An instructor starts at the timetable — the turmas they teach.
  instructor: '/dashboard/classes',
  // Maintenance tasks are module 2; a student and guardian area is the mobile
  // app. Both deliberately absent rather than pointed somewhere plausible.
};

/**
 * Every member can open the calendar, so it is where the chain ends.
 *
 * Not the dashboard: that is the authenticated root, and sending somebody there
 * is how the redirect loop in 37.8 gets written.
 */
const LAST_RESORT = '/dashboard/calendar';

export function resolveLandingRoute(roles: readonly string[]): string {
  for (const role of MEMBER_ROLES) {
    if (!roles.includes(role)) continue;

    const destination = DESTINATIONS[role];
    // A role with no destination yet falls through to the next one they hold,
    // rather than stopping the search at the strongest role.
    if (destination !== undefined) return destination;
  }

  return LAST_RESORT;
}
