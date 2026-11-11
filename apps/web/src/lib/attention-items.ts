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
 * homes on a phone); the backoffice's page otherwise. A kind with no `app` is
 * not listed in app mode at all (Rui, 10-11-2026): the phone's bell only leads
 * to phone screens, so meet results to import wait for the backoffice.
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
  // The inbox itself, not Provas' first section (Rui, 11-11-2026: every line opens its problem).
  meetInbox: { key: 'notifications.item.meetInbox', href: '/dashboard/students/provas/recebidos' },
  staff: { key: 'notifications.item.staff', href: '/dashboard/facilities/staff?section=invitations' },
  // Poolse support asked to come in (11-11-2026): the Owner answers on the profile's tab. No phone screen.
  support: { key: 'notifications.item.support', href: '/dashboard/profile?tab=support' },
};

/** The order lines are listed in: what blocks a lesson first, then the office's queues. */
const ORDER: BadgeKey[] = ['support', 'classes', 'calendar', 'facilities', 'leads', 'students', 'staff', 'categories', 'meetInbox'];

export interface AttentionLine {
  /** Unique within the list: the kind, or the kind and the place for a named line. */
  id: string;
  kind: BadgeKey;
  count: number;
  key: string;
  href: string;
  /** The pool, space, site or lesson a named line is about. */
  name?: string;
  /** A lesson's day (`YYYY-MM-DD`, for `formatDate`) and time on the site's clock. */
  date?: string;
  time?: string;
}

/** A lesson with answers or requests waiting — the API's `attention.lessons`. */
export interface AttentionLesson {
  sessionId: string;
  name: string;
  partner: boolean;
  localDate: string;
  localTime: string;
  weekStart: string;
  count: number;
}

/** At most this many lessons are named; the rest are one line to the calendar. */
export const LESSONS_NAMED = 5;

/**
 * Where a lesson's line opens: the lesson's own page. On the phone a turma's
 * lesson is the app's screen; a partnership's hour has none and keeps the
 * backoffice page, as `lessonHref` in the app does.
 */
export function lessonLineHref(lesson: AttentionLesson, place: 'backoffice' | 'app'): string {
  if (place === 'app' && !lesson.partner) return `/app/aulas/${lesson.sessionId}`;
  return `/dashboard/calendar/sessions/${lesson.sessionId}?week=${lesson.weekStart}`;
}

/** `water` an analysis out of its bands, `lab` a non-conforming lab report, `task` a recurring job due, `fault` an open serious fault. */
export type AttentionPlaceKind = 'water' | 'lab' | 'task' | 'fault';

/** One thing to see to at a site, named — the API's `attention.places`. */
export interface AttentionPlace {
  kind: AttentionPlaceKind;
  facilityId: string;
  poolId: string | null;
  spaceId: string | null;
  name: string;
  count: number;
}

/**
 * Where a named line opens: the tab that holds the problem, never the site's
 * settings (Rui, 11-11-2026 — "1 coisa por tratar nas instalações" sent people
 * to Configurar, where nothing was wrong). A fault goes where the dashboard's
 * faults widget sends it.
 */
export function placeHref(place: AttentionPlace): string {
  if (place.kind === 'water' || place.kind === 'lab') {
    return place.poolId === null ? `/dashboard/facilities/${place.facilityId}` : `/dashboard/facilities/pools/${place.poolId}?tab=water`;
  }
  if (place.kind === 'task') return `/dashboard/facilities/${place.facilityId}?tab=maintenance`;
  if (place.spaceId !== null) return `/dashboard/facilities/spaces/${place.spaceId}?tab=issues`;
  if (place.poolId !== null) return `/dashboard/facilities/pools/${place.poolId}`;
  return `/dashboard/facilities/${place.facilityId}?tab=spaces`;
}

/**
 * The bell's lines from the menu's counts. A sport's copy (`classes:pool`) is
 * the same things again, so it is not added — except Pedidos, where each sport's
 * count is its own and the shared one holds only the sportless (POOLSE-143).
 */
export function attentionLines(
  badges: Badges,
  place: 'backoffice' | 'app' = 'backoffice',
  places: readonly AttentionPlace[] = [],
  lessons: readonly AttentionLesson[] = [],
): AttentionLine[] {
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
    if (place === 'app' && item.app === undefined) continue;
    // The lessons behind the calendar's count, each named and opening itself.
    if (kind === 'calendar' && lessons.length > 0) {
      for (const lesson of lessons.slice(0, LESSONS_NAMED)) {
        lines.push({
          id: `lesson:${lesson.sessionId}`,
          kind,
          count: lesson.count,
          key: 'notifications.lesson',
          href: lessonLineHref(lesson, place),
          name: lesson.name,
          date: lesson.localDate,
          time: lesson.localTime,
        });
      }
      const rest = lessons.slice(LESSONS_NAMED).reduce((sum, lesson) => sum + lesson.count, 0);
      if (rest > 0) {
        lines.push({
          id: 'lesson:rest',
          kind,
          count: rest,
          key: 'notifications.lessonsMore',
          href: place === 'app' ? (item.app ?? item.href) : item.href,
        });
      }
      continue;
    }
    // The site circles, named one line per thing and place, when the API said what they are.
    if (kind === 'facilities' && places.length > 0) {
      for (const one of places) {
        lines.push({
          id: `${one.kind}:${one.poolId ?? one.spaceId ?? one.facilityId}`,
          kind,
          count: one.count,
          key: `notifications.place.${one.kind}`,
          href: place === 'app' ? (item.app ?? placeHref(one)) : placeHref(one),
          name: one.name,
        });
      }
      continue;
    }
    lines.push({ id: kind, kind, count, key: item.key, href: place === 'app' ? (item.app ?? item.href) : item.href });
  }
  return lines;
}
