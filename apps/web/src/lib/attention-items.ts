import type { BadgeKey, Badges } from './nav-entries';

/**
 * What the bell lists — POOLSE-212 (Rui, 10-11-2026). One line per kind of thing
 * that lights a menu dot, read from the same map (`/shell`'s attention, plus the
 * meet inbox the layout adds): never a second definition of "needs doing".
 *
 * Typed against `BadgeKey`, so a new kind of dot that is not given a line here
 * fails the typecheck rather than going silently missing from the bell.
 *
 * `app` is where the line goes in app mode (the teacher's and maintenance's
 * homes on a phone); the backoffice's page otherwise.
 */
export interface AttentionItem {
  /** The line, a plural ICU message taking `{count}`. */
  key: string;
  href: string;
  app?: string;
}

export const ATTENTION_ITEMS: Record<BadgeKey, AttentionItem> = {
  leads: { key: 'notifications.item.leads', href: '/dashboard/students/pedidos' },
  students: { key: 'notifications.item.students', href: '/dashboard/students?review=1' },
  classes: { key: 'notifications.item.classes', href: '/dashboard/classes?instructor=none' },
  facilities: { key: 'notifications.item.facilities', href: '/dashboard/facilities', app: '/app/manutencao' },
  calendar: { key: 'notifications.item.calendar', href: '/dashboard/calendar', app: '/app/aulas' },
  categories: { key: 'notifications.item.categories', href: '/dashboard/rececao' },
  meetInbox: { key: 'notifications.item.meetInbox', href: '/dashboard/students/provas' },
  staff: { key: 'notifications.item.staff', href: '/dashboard/facilities/staff?section=invitations' },
};

/** The order lines are listed in: what blocks a lesson first, then the office's queues. */
const ORDER: BadgeKey[] = ['classes', 'calendar', 'facilities', 'leads', 'students', 'staff', 'categories', 'meetInbox'];

export interface AttentionLine {
  kind: BadgeKey;
  count: number;
  key: string;
  href: string;
}

/**
 * The bell's lines from the menu's counts. A sport's copy (`classes:pool`) is
 * the same things again, so it is not added — except Pedidos, where each sport's
 * count is its own and the shared one holds only the sportless (POOLSE-143).
 */
export function attentionLines(badges: Badges, place: 'backoffice' | 'app' = 'backoffice'): AttentionLine[] {
  const lines: AttentionLine[] = [];
  for (const kind of ORDER) {
    let count = badges[kind] ?? 0;
    if (kind === 'leads') {
      for (const [key, value] of Object.entries(badges)) {
        if (key.startsWith('leads:')) count += value ?? 0;
      }
    }
    if (count <= 0) continue;
    const item = ATTENTION_ITEMS[kind];
    lines.push({ kind, count, key: item.key, href: place === 'app' ? (item.app ?? item.href) : item.href });
  }
  return lines;
}
