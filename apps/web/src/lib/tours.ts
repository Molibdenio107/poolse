/**
 * The guided tour's steps, per shell — POOLSE-230 (Rui, 19-11-2026; made
 * deeper the same day: "it needs more details tips").
 *
 * One step per real area, sub-areas included, each with a purpose and two or
 * three practical tips. Each step points at a real menu entry or on-page
 * control by selector, the first match on screen winning. **A step whose
 * target is not on screen is skipped, never pointed at nothing**: a club with
 * Energia off, a reader who may not see Faturação, a family with one child (no
 * filter) or *Modalidades* instead of *Aulas* get the right tour without a
 * second list of who sees what, because the screen already decided.
 *
 * The names were checked against `nav-entries.ts` and `TABS`: in the backoffice
 * Calendário, Turmas and Piscinas live inside the sport's tab, so those steps
 * carry `via` (the tab to open first) and the tour moves there; the office's
 * people are *Staff*, under Instalações; the teacher's tabs are Início, Aulas,
 * Alunos and Perfil; a family's Pagamentos is a card on Início, not a tab.
 */

export type TourShell = 'backoffice' | 'family' | 'teaching' | 'maintenance';

export interface TourStep {
  /** `tour.<shell>.<id>.title`, `.body` and `.tip1`…`tipN`. */
  id: string;
  selectors: readonly string[];
  /** How many `tipN` keys the step has. */
  tips: number;
  /** Behind the phone's menu even when nothing matches (a sport's entries are drawn only once it opens). */
  inMenu?: boolean;
  /** A link to follow first when the target is not on this page: the sport's own section. */
  via?: string;
}

/** Below `md` the backoffice's sidebar is behind this button: the step points at it and names the entry. */
export const MENU_BUTTON = '[data-tour="menu"]';

const SPORT_TAB = 'header [data-section="pool"]';
const TAB = (href: string): string => `[data-tour="tabs"] a[href="${href}"]`;

export const TOURS: Record<TourShell, readonly TourStep[]> = {
  backoffice: [
    { id: 'home', selectors: ['aside a[href="/dashboard/welcome"]'], tips: 2 },
    { id: 'dashboard', selectors: ['aside a[href="/dashboard"]'], tips: 2 },
    { id: 'search', selectors: ['[data-tour="search"]'], tips: 2 },
    { id: 'bell', selectors: ['[data-tour="bell"]'], tips: 2 },
    { id: 'facilities', selectors: ['aside a[href="/dashboard/facilities"]'], tips: 3 },
    { id: 'energy', selectors: ['aside a[href="/dashboard/energy"]'], tips: 2 },
    { id: 'reception', selectors: ['aside a[href="/dashboard/rececao"]'], tips: 3 },
    { id: 'billing', selectors: ['aside a[href="/dashboard/faturacao"]'], tips: 3 },
    { id: 'students', selectors: ['aside a[href="/dashboard/students"]', 'aside a[href^="/dashboard/students"]'], tips: 3 },
    {
      id: 'sport',
      selectors: [SPORT_TAB, 'header [data-section]:not([data-section="site"])'],
      tips: 2,
      inMenu: true,
    },
    { id: 'calendar', selectors: ['aside a[href^="/dashboard/calendar"]'], tips: 3, inMenu: true, via: SPORT_TAB },
    { id: 'classes', selectors: ['aside a[href^="/dashboard/classes"]'], tips: 3, inMenu: true, via: SPORT_TAB },
    { id: 'pools', selectors: ['aside a[href^="/dashboard/recintos"]'], tips: 2, inMenu: true, via: SPORT_TAB },
  ],
  family: [
    { id: 'home', selectors: [TAB('/app/familia')], tips: 2 },
    { id: 'children', selectors: ['[data-tour="children"]'], tips: 2 },
    { id: 'payments', selectors: ['main a[href^="/app/familia/pagamentos"]'], tips: 2 },
    { id: 'enrol', selectors: ['a[href^="/app/familia/inscrever"]'], tips: 2 },
    { id: 'lessons', selectors: [TAB('/app/familia/aulas'), '[data-tour="tabs"] a[href^="/app/familia/modalidades"]'], tips: 3 },
    { id: 'progress', selectors: [TAB('/app/familia/progressos')], tips: 2 },
    { id: 'profile', selectors: ['[data-tour="tabs"] a[href^="/app/perfil"]'], tips: 3 },
  ],
  teaching: [
    { id: 'home', selectors: [TAB('/app/aulas')], tips: 2 },
    { id: 'nextLesson', selectors: ['[data-tour="next-lesson"]'], tips: 3 },
    { id: 'bell', selectors: ['[data-tour="bell"]'], tips: 2 },
    { id: 'lessons', selectors: [TAB('/app/aulas/calendario')], tips: 2 },
    { id: 'students', selectors: [TAB('/app/alunos')], tips: 2 },
    { id: 'profile', selectors: ['[data-tour="tabs"] a[href^="/app/perfil"]'], tips: 2 },
  ],
  maintenance: [
    { id: 'today', selectors: [TAB('/app/manutencao')], tips: 3 },
    { id: 'bell', selectors: ['[data-tour="bell"]'], tips: 2 },
    { id: 'record', selectors: [TAB('/app/manutencao/registar')], tips: 3 },
    { id: 'profile', selectors: ['[data-tour="tabs"] a[href^="/app/perfil"]'], tips: 2 },
  ],
};

/** Which tour this address belongs to; `?home=` decides on the shared Perfil. */
export function tourShellFor(pathname: string, home: string | null): TourShell {
  if (!pathname.startsWith('/app')) return 'backoffice';
  if (home === 'teaching' || pathname.startsWith('/app/aulas') || pathname.startsWith('/app/alunos')) return 'teaching';
  if (home === 'maintenance' || pathname.startsWith('/app/manutencao')) return 'maintenance';
  return 'family';
}
