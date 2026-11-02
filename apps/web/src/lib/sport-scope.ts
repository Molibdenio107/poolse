import type { PoolseSport } from '@poolse/rules';
import type { Me } from './api';

type Membership = Pick<Me['memberships'][number], 'roles' | 'sports' | 'mySports'>;

/**
 * The sports a reader may read students of — POOLSE-145, the API's
 * `sportScope()` as the menu needs it. Owner and admin, anybody who is not an
 * instructor, and an instructor who belongs to every sport the club has on read
 * every sport (a pool-only club is unchanged); any other instructor reads their
 * own. Navigation only: the API refuses another sport whatever this says.
 */
export function readableSports(membership: Membership): PoolseSport[] {
  const club = membership.sports ?? ['pool'];
  const roles = membership.roles;
  if (roles.includes('owner') || roles.includes('admin') || !roles.includes('instructor')) return [...club];
  const mine = membership.mySports;
  if (mine === undefined || club.every((sport) => mine.includes(sport))) return [...club];
  return club.filter((sport) => mine.includes(sport));
}
