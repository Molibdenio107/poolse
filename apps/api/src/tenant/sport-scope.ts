import { ForbiddenException } from '@nestjs/common';
import { currentTenant } from './tenant.context.js';
import { hasRole } from './roles.js';

/**
 * Which sports a reader may read students of — POOLSE-145 (Rui, 01-11-2026:
 * "only admin and owner sees everything, the rest is filtered by sport").
 *
 * **The decision is made here, once**, and every sport-scoped handler filters
 * by the list it returns: a 403 on `?sport=` and a filter inside the SQL are two
 * implementations of one rule only if they read the same answer.
 *
 * - `null` is every sport: owner and admin always; anybody who is not an
 *   instructor (a family's access is `requireActsForStudent`'s, maintenance
 *   reads no students); a background job (no `mySports` in its context); and
 *   **an instructor who belongs to every sport the club has on** — which is
 *   every instructor of a pool-only club, so nobody there reads less than the
 *   day before (rule 7).
 * - Otherwise the instructor's own sports, among those the club has on.
 */
export function sportScope(): readonly string[] | null {
  if (hasRole('owner', 'admin') || !hasRole('instructor')) return null;
  const { mySports, clubSports } = currentTenant();
  if (mySports === undefined || clubSports === undefined) return null;
  if (clubSports.every((sport) => mySports.includes(sport))) return null;
  return mySports;
}

/**
 * Refuses a sport the reader does not belong to — `?sport=` naming another
 * sport is a 403 `sport_not_yours`, never an empty list (rule 3). `none` (the
 * students in no sport) is refused to a scoped reader too: nobody's sport is not
 * theirs. `null` (no sport asked for) passes; the caller filters by
 * `sportScope()`.
 */
export function requireSport(sport: string | null): void {
  if (sport === null) return;
  const scope = sportScope();
  if (scope === null || (sport !== 'none' && scope.includes(sport))) return;
  throw new ForbiddenException({
    code: 'sport_not_yours',
    message: sport === 'none' ? 'Students in no sport are read by the office' : `You do not teach ${sport}`,
  });
}

/**
 * Competition is swimming's (`COMPETITION_SPORTS` on the web): the FPN's
 * meets, entry times and a swimmer's times. Its routes ask for it by name, so
 * an instructor who does not teach swimming is refused them (POOLSE-145).
 */
export function requireCompetition(): void {
  requireSport('pool');
}
