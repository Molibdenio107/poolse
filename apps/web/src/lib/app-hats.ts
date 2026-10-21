/**
 * Which homes a person has in app mode — POOLSE-90.
 *
 * One definition, read by `/app`'s router, the switcher, and the dashboard's
 * redirect for a family, so the three cannot disagree about who lands where.
 * Roles are the active club's (`memberships[0]`), and the roles are a set: an
 * instructor who is also a parent wears two hats.
 *
 * `built` is which homes exist yet. Slice 1 builds the family's; the teaching
 * and maintenance homes arrive in slices 2 and 3, and until then those hats are
 * sent to the backoffice, where their work already is.
 */

export type AppHat = 'family' | 'teaching' | 'maintenance';

export const BUILT_HATS: readonly AppHat[] = ['family'];

export interface Hats {
  /** The homes this person may switch between, in switcher order, built only. */
  homes: AppHat[];
  /** Owner or admin: the backoffice is their home, and `/app` sends them there. */
  manages: boolean;
  /** Holds any staff role — the backoffice has something for them. */
  staff: boolean;
}

export function hatsOf(roles: readonly string[]): Hats {
  const has = (...wanted: string[]): boolean => wanted.some((role) => roles.includes(role));
  const all: [AppHat, boolean][] = [
    ['teaching', has('instructor')],
    ['family', has('guardian', 'student')],
    ['maintenance', has('maintenance')],
  ];
  return {
    homes: all.filter(([hat, held]) => held && BUILT_HATS.includes(hat)).map(([hat]) => hat),
    manages: has('owner', 'admin'),
    staff: has('owner', 'admin', 'instructor', 'maintenance'),
  };
}

/** Where `/app` sends this person. */
export function appHome(roles: readonly string[]): string {
  const hats = hatsOf(roles);
  if (hats.manages) return '/dashboard';
  const first = hats.homes[0];
  return first === undefined ? '/dashboard' : HOME_PATH[first];
}

export const HOME_PATH: Record<AppHat, string> = {
  family: '/app/familia',
  teaching: '/app/aulas',
  maintenance: '/app/manutencao',
};

/**
 * A family and nothing else — never shown the backoffice shell (POOLSE-90
 * AC 1). Staff who are also parents keep the backoffice as well.
 */
export function familyOnly(roles: readonly string[]): boolean {
  const hats = hatsOf(roles);
  return !hats.staff && hats.homes.includes('family');
}
