/**
 * Which homes a person has in app mode — POOLSE-90.
 *
 * One definition, read by `/app`'s router, the switcher, and the dashboard's
 * redirect for a family, so the three cannot disagree about who lands where.
 * Roles are the active club's (`memberships[0]`), and the roles are a set: an
 * instructor who is also a parent wears two hats.
 *
 * `built` is which homes exist: the family's (slice 1), the instructor's
 * (`/app/aulas`, slice 2) and maintenance's (`/app/manutencao`, slice 3). A hat
 * whose home is not built is sent to the backoffice, where its work already is.
 */

export type AppHat = 'family' | 'teaching' | 'maintenance';

export const BUILT_HATS: readonly AppHat[] = ['family', 'teaching', 'maintenance'];

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


/**
 * The bottom tabs of each home — POOLSE-136. Static, beside `HOME_PATH`, so
 * `hatsOf` already answers which bar a person gets. Maintenance has none: its
 * home keeps the shell it had (rule 10). *Perfil* (the diamond) opens *O meu
 * perfil*, which the photo in the header's corner opens too (Rui, 31-10-2026);
 * it names its home in `?home=`, so the right bar is drawn before hydration.
 */
export type TabGlyph = 'square' | 'circle' | 'triangle' | 'diamond' | 'hexagon';

export interface AppTab {
  href: string;
  labelKey: string;
  glyph: TabGlyph;
}

export type TabbedHat = Exclude<AppHat, 'maintenance'>;

export const TABS: Record<TabbedHat, AppTab[]> = {
  family: [
    { href: '/app/familia', labelKey: 'app.tabs.familia.inicio', glyph: 'square' },
    // The hexagon *Modalidades* replaces this one when a family has two sports (POOLSE-127).
    { href: '/app/familia/aulas', labelKey: 'app.tabs.familia.aulas', glyph: 'circle' },
    { href: '/app/familia/pagamentos', labelKey: 'app.tabs.familia.pagamentos', glyph: 'triangle' },
    { href: '/app/perfil?home=family', labelKey: 'app.tabs.perfil', glyph: 'diamond' },
  ],
  teaching: [
    { href: '/app/aulas', labelKey: 'app.tabs.aulas.hoje', glyph: 'square' },
    { href: '/app/aulas?semana', labelKey: 'app.tabs.aulas.semana', glyph: 'circle' },
    { href: '/app/perfil?home=teaching', labelKey: 'app.tabs.perfil', glyph: 'diamond' },
  ],
};

/**
 * Which bar a screen wears and which tab is current, or null for a screen that
 * has none — a lesson's page, a form, the maintenance home. Only the tabs' own
 * addresses carry the bar: a screen deeper in has its own *Voltar*.
 */
export function tabFor(
  pathname: string,
  search: { has(name: string): boolean; get(name: string): string | null },
  homes: readonly AppHat[],
): { hat: TabbedHat; index: number } | null {
  const path = pathname.replace(/\/$/, '');
  if (path === '/app/familia') return { hat: 'family', index: 0 };
  if (path === '/app/familia/aulas') return { hat: 'family', index: 1 };
  if (path === '/app/familia/pagamentos') return { hat: 'family', index: 2 };
  if (path === '/app/aulas') return { hat: 'teaching', index: search.has('semana') ? 1 : 0 };
  if (path === '/app/perfil') {
    const asked = search.get('home');
    const hat =
      asked === 'family' || asked === 'teaching'
        ? asked
        : homes.find((one): one is TabbedHat => one !== 'maintenance');
    if (hat === undefined) return null;
    return { hat, index: TABS[hat].length - 1 };
  }
  return null;
}
