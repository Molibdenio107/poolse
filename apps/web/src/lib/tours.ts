/**
 * The guided tour's steps, per shell — POOLSE-230 (Rui, 19-11-2026).
 *
 * Each step points at a real menu entry by selector, first match that is on
 * screen wins. **A step whose entry is not on screen is skipped, never pointed
 * at nothing**: that is how a club with Faturação off, a reader who may not see
 * Staff, or a family with *Modalidades* instead of *Aulas* get the right tour
 * without a second list of who sees what — the menu already decided.
 *
 * The names were checked against `nav-entries.ts` and `TABS` (19-11-2026): in
 * the backoffice, Turmas, Calendário and Piscinas live inside the sport's tab,
 * and the office's people are *Staff*; the teacher's tabs are Início, Aulas,
 * Alunos and Perfil; a family's Pagamentos is a card on Início, not a tab.
 */

export type TourShell = 'backoffice' | 'family' | 'teaching' | 'maintenance';

export interface TourStep {
  /** `tour.<shell>.<id>.title` / `.body`. */
  id: string;
  selectors: readonly string[];
  /** Behind the phone's menu even when nothing matches (a sport's tab is drawn only once it opens). */
  inMenu?: boolean;
}

/** Below `md` the backoffice's sidebar is behind this button: the step points at it and names the entry. */
export const MENU_BUTTON = '[data-tour="menu"]';

export const TOURS: Record<TourShell, readonly TourStep[]> = {
  backoffice: [
    { id: 'home', selectors: ['aside a[href="/dashboard/welcome"]'] },
    {
      id: 'sport',
      selectors: ['header [data-section="pool"]', 'header [data-section]:not([data-section="site"])'],
      inMenu: true,
    },
    { id: 'students', selectors: ['aside a[href="/dashboard/students"]', 'aside a[href^="/dashboard/students"]'] },
    { id: 'billing', selectors: ['aside a[href="/dashboard/faturacao"]'] },
    { id: 'staff', selectors: ['aside a[href="/dashboard/facilities/staff"]', 'aside a[href="/dashboard/facilities"]'] },
  ],
  family: [
    { id: 'home', selectors: ['[data-tour="tabs"] a[href="/app/familia"]'] },
    { id: 'lessons', selectors: ['[data-tour="tabs"] a[href="/app/familia/aulas"]', '[data-tour="tabs"] a[href^="/app/familia/modalidades"]'] },
    { id: 'progress', selectors: ['[data-tour="tabs"] a[href="/app/familia/progressos"]'] },
    { id: 'profile', selectors: ['[data-tour="tabs"] a[href^="/app/perfil"]'] },
  ],
  teaching: [
    { id: 'home', selectors: ['[data-tour="tabs"] a[href="/app/aulas"]'] },
    { id: 'lessons', selectors: ['[data-tour="tabs"] a[href="/app/aulas/calendario"]'] },
    { id: 'students', selectors: ['[data-tour="tabs"] a[href="/app/alunos"]'] },
    { id: 'profile', selectors: ['[data-tour="tabs"] a[href^="/app/perfil"]'] },
  ],
  maintenance: [
    { id: 'today', selectors: ['[data-tour="tabs"] a[href="/app/manutencao"]'] },
    { id: 'record', selectors: ['[data-tour="tabs"] a[href="/app/manutencao/registar"]'] },
    { id: 'profile', selectors: ['[data-tour="tabs"] a[href^="/app/perfil"]'] },
  ],
};

/** Which tour this address belongs to; `?home=` decides on the shared Perfil. */
export function tourShellFor(pathname: string, home: string | null): TourShell {
  if (!pathname.startsWith('/app')) return 'backoffice';
  if (home === 'teaching' || pathname.startsWith('/app/aulas') || pathname.startsWith('/app/alunos')) return 'teaching';
  if (home === 'maintenance' || pathname.startsWith('/app/manutencao')) return 'maintenance';
  return 'family';
}
