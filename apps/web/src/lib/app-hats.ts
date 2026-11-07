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

/**
 * Remembers the way in on this device, for this person — POOLSE-188. Holds a
 * membership id, then the home when it is not the backoffice. It decides nothing
 * about access: the reader's roles still answer.
 */
export const HOME_CHOICE_COOKIE = 'poolse_app_home';

export function homeChoice(membershipId: string, hat: AppHat | null): string {
  return hat === null ? membershipId : `${membershipId}:${hat}`;
}

/**
 * What this device remembers for this person: the backoffice, one of their own
 * homes, or nothing yet. Somebody else's choice, or a home they no longer hold,
 * is nothing, so they are asked again.
 */
export function rememberedHome(
  choice: string | undefined,
  membershipId: string,
  homes: readonly AppHat[],
): AppHat | 'backoffice' | null {
  if (choice === undefined) return null;
  if (choice === membershipId) return 'backoffice';
  return homes.find((hat) => choice === homeChoice(membershipId, hat)) ?? null;
}

/** The roles the app draws for: the person viewed during a view (POOLSE-188). */
export function viewRoles(membership: {
  roles: readonly string[];
  view: { roles: readonly string[] } | null;
}): readonly string[] {
  return membership.view?.roles ?? membership.roles;
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
 * `hatsOf` already answers which bar a person gets. Maintenance has had its own
 * since POOLSE-181: *Hoje*, *Registar*, *Perfil*. *Perfil* (the diamond) opens *O meu
 * perfil*, which the photo in the header's corner opens too (Rui, 31-10-2026);
 * it names its home in `?home=`, so the right bar is drawn before hydration.
 */
export type TabGlyph = 'square' | 'circle' | 'triangle' | 'diamond' | 'hexagon';

export interface AppTab {
  href: string;
  labelKey: string;
  glyph: TabGlyph;
}

export type TabbedHat = AppHat;

export const TABS: Record<TabbedHat, AppTab[]> = {
  family: [
    { href: '/app/familia', labelKey: 'app.tabs.familia.inicio', glyph: 'square' },
    // The hexagon *Modalidades* replaces this one when a family has two sports (POOLSE-127).
    { href: '/app/familia/aulas', labelKey: 'app.tabs.familia.aulas', glyph: 'circle' },
    { href: '/app/familia/progressos', labelKey: 'app.tabs.familia.progressos', glyph: 'triangle' },
    { href: '/app/perfil?home=family', labelKey: 'app.tabs.perfil', glyph: 'diamond' },
  ],
  teaching: [
    { href: '/app/aulas', labelKey: 'app.tabs.aulas.hoje', glyph: 'square' },
    { href: '/app/aulas?semana', labelKey: 'app.tabs.aulas.semana', glyph: 'circle' },
    { href: '/app/perfil?home=teaching', labelKey: 'app.tabs.perfil', glyph: 'diamond' },
  ],
  // POOLSE-181: square, triangle, diamond — the circle and hexagon are the family's.
  maintenance: [
    { href: '/app/manutencao', labelKey: 'app.tabs.manutencao.hoje', glyph: 'square' },
    { href: '/app/manutencao/registar', labelKey: 'app.tabs.manutencao.registar', glyph: 'triangle' },
    { href: '/app/perfil?home=maintenance', labelKey: 'app.tabs.perfil', glyph: 'diamond' },
  ],
};

/** A home named in `?home=` — anything else is ignored. */
export function isHat(value: string | null | undefined): value is AppHat {
  return value === 'family' || value === 'teaching' || value === 'maintenance';
}

/**
 * Which bar a screen wears and which tab is current, or null for a screen that
 * has none. **The bar is on every screen** (Rui, 06-11-2026, reversing POOLSE-136's
 * tab screens only): a screen deeper in lights the tab it was reached from, and
 * keeps its own *Voltar*.
 */
export function tabFor(
  pathname: string,
  search: { has(name: string): boolean; get(name: string): string | null },
  homes: readonly AppHat[],
): { hat: TabbedHat; index: number } | null {
  const path = pathname.replace(/\/$/, '');
  if (path === '/app/familia') return { hat: 'family', index: 0 };
  if (path === '/app/familia/aulas') return { hat: 'family', index: 1 };
  if (path === '/app/familia/progressos') return { hat: 'family', index: 2 };
  if (path === '/app/aulas') return { hat: 'teaching', index: search.has('semana') ? 1 : 0 };
  if (path === '/app/manutencao') return { hat: 'maintenance', index: 0 };
  if (path === '/app/manutencao/registar') return { hat: 'maintenance', index: 1 };
  if (path === '/app/perfil') {
    const asked = search.get('home');
    const hat =
      // Only a home this person has: a teaching-only reader asking for the
      // family's bar would get tabs that lead to refusals.
      isHat(asked) && homes.includes(asked) ? asked : homes[0];
    if (hat === undefined) return null;
    return { hat, index: TABS[hat].length - 1 };
  }
  // A screen deeper in, under the tab that leads to it.
  if (path.startsWith('/app/perfil/')) return tabFor('/app/perfil', search, homes);
  if (path.startsWith('/app/familia/aulas/') || path === '/app/familia/inscrever') return { hat: 'family', index: 1 };
  if (path.startsWith('/app/familia/progressos/')) return { hat: 'family', index: 2 };
  if (path === '/app/familia/pagamentos' || path.startsWith('/app/familia/documentos')) {
    return { hat: 'family', index: TABS.family.length - 1 };
  }
  if (path.startsWith('/app/familia/')) return { hat: 'family', index: 0 };
  if (path === '/app/manutencao/reportar') return { hat: 'maintenance', index: 1 };
  if (path.startsWith('/app/manutencao/')) return { hat: 'maintenance', index: 0 };
  return null;
}
