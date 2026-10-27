/**
 * Where "Voltar" goes when you did not arrive from the obvious place.
 *
 * **The bug.** `BackLink` takes a fixed `href`, chosen once per page — Staff
 * always goes back to the dashboard, the register always goes back to
 * `/dashboard/students`. That is right most of the time and wrong exactly where
 * one screen links into another: a facility's people counts link to Staff and to
 * the register, so somebody who clicks "6 Instrutores" on Piscina Municipal and
 * then clicks Voltar lands on the dashboard, several screens from where they
 * were, with no way back but the browser.
 *
 * **Why not `history.back()`.** It is the obvious fix and `back-link.tsx`
 * already explains why it was rejected: after a redirect it returns to the form
 * that was just submitted, and on a link opened from an email it leaves the app.
 * That reasoning has not changed. What was missing is not history — it is the
 * origin, and the origin is knowable at the moment the link is written.
 *
 * **So the linking page says where it is.** A link that crosses into another
 * section carries `?from=<path>`, and the destination prefers it over its own
 * default. Three properties come out of that, and they are the whole reason for
 * this shape rather than a client-side one:
 *
 * - the back target is in the URL, so it survives a refresh and a shared link;
 * - a page reached the ordinary way has no `from` and behaves exactly as before,
 *   so nothing regresses on the twenty pages that are already correct;
 * - the destination is validated here, in one place, against one rule.
 *
 * **`from` is untrusted input.** It arrives in a query string, so anybody can
 * write anything in it, and a back button is a redirect wearing a coat: an
 * unchecked value turns every page in the app into an open redirect onto
 * somebody else's site. `readFrom` therefore accepts only a path inside
 * `/dashboard`, and rejects everything else silently rather than trying to
 * repair it — a back link that quietly falls back to the section's own parent is
 * a small disappointment, and one that leaves the app is a phishing hop.
 */

const APP_ROOT = '/dashboard';
/** App mode's own front door (POOLSE-90): a lesson opened from the instructor's home goes back there. */
const APP_MODE_ROOT = '/app';

/**
 * The accessible name for a destination, by the path it points at.
 *
 * `back-link.tsx` shows "Voltar" to everybody and names the destination to
 * screen readers, so a returned target needs a label as well as an href — and
 * "Voltar" repeated with no other cue is the thing that file was written to
 * avoid. Longest prefix wins, so `/dashboard/facilities/staff` is Staff and
 * `/dashboard/facilities/<id>` is the site it belongs to.
 *
 * A table rather than a lookup on the page, because the alternative is each
 * linking page passing a label through the query string — which is a translated
 * string in a URL, and wrong the moment somebody changes locale mid-journey.
 */
const LABELS: readonly (readonly [string, string])[] = [
  ['/app/aulas', 'app.teaching.backTo'],
  ['/app/manutencao', 'app.maintenance.backTo'],
  ['/dashboard/facilities/staff/vacations', 'vacations.backToVacations'],
  ['/dashboard/facilities/staff/qualifications', 'back.toQualifications'],
  ['/dashboard/facilities/staff/salaries', 'back.toSalaries'],
  ['/dashboard/facilities/staff', 'staff.backToStaff'],
  ['/dashboard/facilities/inventory', 'inventory.backToInventory'],
  ['/dashboard/facilities/incidents', 'incidents.backToList'],
  ['/dashboard/facilities/lifeguards', 'back.toLifeguards'],
  ['/dashboard/facilities/tasks', 'back.toTask'],
  ['/dashboard/facilities/spaces', 'back.toSpace'],
  ['/dashboard/facilities/partners', 'back.toPartner'],
  ['/dashboard/facilities/energy', 'energy.backToMeter'],
  ['/dashboard/facilities/pools', 'facilities.backToFacilities'],
  ['/dashboard/facilities', 'facilities.backToSites'],
  ['/dashboard/energy', 'energy.backToEnergy'],
  ['/dashboard/students/guardians', 'students.backToGuardians'],
  ['/dashboard/students/pedidos', 'back.toRequests'],
  ['/dashboard/students/messages', 'back.toMessages'],
  ['/dashboard/students/provas/minimos', 'back.toStandards'],
  ['/dashboard/students/provas', 'back.toMeets'],
  ['/dashboard/students/levels', 'back.toLevels'],
  ['/dashboard/students/advancement', 'back.toAdvancement'],
  ['/dashboard/students', 'students.backToRegister'],
  ['/dashboard/classes/reposicoes', 'back.toMakeups'],
  ['/dashboard/classes/seasons', 'back.toSeasons'],
  ['/dashboard/classes', 'classes.backToClasses'],
  ['/dashboard/calendar/closures', 'back.toClosures'],
  ['/dashboard/calendar/sessions', 'back.toLesson'],
  ['/dashboard/calendar', 'calendar.backToCalendar'],
  ['/dashboard/faturacao', 'invoices.backToList'],
  ['/dashboard/rececao', 'back.toReception'],
  ['/dashboard/arquivados', 'back.toArchive'],
  ['/dashboard/family', 'family.back'],
  ['/dashboard/profile/subscription', 'back.toSubscription'],
  ['/dashboard/profile', 'back.toProfile'],
  ['/dashboard', 'common.backToDashboard'],
];

/**
 * One record, as opposed to the list it sits in.
 *
 * `/dashboard/facilities/<id>` and `/dashboard/facilities` share a prefix and
 * mean different things, and the prefix table cannot tell them apart on length
 * alone. Anything with one more segment that is not a known sub-section is a
 * record — so a sub-section missing from its set is announced as a record,
 * which is how a task once read "Voltar à instalação" (POOLSE-91).
 */
const RECORDS: readonly (readonly [string, ReadonlySet<string>, string])[] = [
  [
    '/dashboard/facilities',
    new Set([
      'staff', 'pools', 'inventory', 'energy', 'new', 'tasks', 'spaces',
      'incidents', 'lifeguards', 'partners',
    ]),
    'facilities.backToSite',
  ],
  [
    '/dashboard/students',
    new Set([
      'guardians', 'pedidos', 'messages', 'provas', 'levels', 'advancement',
      'import', 'export', 'new',
    ]),
    'back.toStudent',
  ],
  ['/dashboard/classes', new Set(['reposicoes', 'seasons', 'new']), 'back.toClass'],
  ['/dashboard/faturacao', new Set<string>(), 'back.toInvoice'],
];

function recordKey(path: string): string | null {
  for (const [section, subsections, key] of RECORDS) {
    if (!path.startsWith(`${section}/`)) continue;
    const rest = path.slice(section.length + 1).split(/[/?]/)[0] ?? '';
    if (rest !== '' && !subsections.has(rest)) return key;
  }
  return null;
}

/** The i18n key naming this destination. Never throws; falls back to "Voltar". */
export function backLabelKey(href: string): string {
  const record = recordKey(href);
  if (record !== null) return record;

  for (const [prefix, key] of LABELS) {
    if (href === prefix || href.startsWith(`${prefix}/`) || href.startsWith(`${prefix}?`)) {
      return key;
    }
  }

  return 'common.back';
}

/**
 * The `from` parameter, if it is one this app is willing to send somebody to.
 *
 * Deliberately strict. A path, inside `/dashboard`, and nothing that could be
 * read as an authority: no scheme, no `//` (which a browser resolves as
 * protocol-relative and is the classic open-redirect payload), no backslash
 * (which some browsers normalise to `/`), no control characters.
 */
export function readFrom(from: string | undefined): string | null {
  if (from === undefined || from === '') return null;
  const root = [APP_ROOT, APP_MODE_ROOT].find((one) => from.startsWith(one));
  if (root === undefined) return null;
  if (from.startsWith('//') || from.includes('\\')) return null;
  // Whitespace and control characters: a newline in a redirect target is how
  // a header-splitting payload starts, and a space is never in a path we wrote.
  if (/[\s\u0000-\u001f\u007f]/.test(from)) return null;
  // `/dashboardish` is not inside `/dashboard`, nor `/appendix` inside `/app`.
  if (from !== root && !from.startsWith(`${root}/`) && !from.startsWith(`${root}?`)) {
    return null;
  }
  return from;
}

export interface BackTarget {
  href: string;
  /** i18n key, resolved by the page — this module never sees a translator. */
  labelKey: string;
}

/**
 * Where Voltar should point: the origin if there is a usable one, else the
 * page's own parent.
 *
 * The fallback is required rather than optional. A page that has no sensible
 * parent has no business showing a back control, and defaulting to the dashboard
 * here would hide that from whoever writes the next page.
 */
export function backTarget(from: string | undefined, fallback: string): BackTarget {
  const origin = readFrom(from);
  const href = origin ?? fallback;
  return { href, labelKey: backLabelKey(href) };
}

/**
 * Voltar for a page the main menu opens (POOLSE-91, Rui 22-10-2026): shown only
 * when the page was linked into with a usable origin, and absent otherwise —
 * a menu destination reached from the menu has nowhere to go back to.
 */
export function originBack(from: string | undefined): BackTarget | undefined {
  const origin = readFrom(from);
  return origin === null ? undefined : { href: origin, labelKey: backLabelKey(origin) };
}

/**
 * `back` as `PageShell` and `DetailPage` take it: the label translated by the
 * page's own `t`, since this module never sees a translator. Undefined stays
 * undefined, which is a menu page reached from the menu.
 */
export function backProp(target: BackTarget, t: (key: string) => string): { href: string; label: string };
export function backProp(
  target: BackTarget | undefined,
  t: (key: string) => string,
): { href: string; label: string } | undefined;
export function backProp(
  target: BackTarget | undefined,
  t: (key: string) => string,
): { href: string; label: string } | undefined {
  return target === undefined ? undefined : { href: target.href, label: t(target.labelKey) };
}

/**
 * The page somebody is on, path and query, as a `from` value.
 *
 * The query is the point: the tab, the section, the page and the filters are
 * the context Voltar has to bring back. It keeps the page's own `from`, which
 * is what makes a chain walk back one hop at a time.
 */
export function currentHref(
  path: string,
  params: Record<string, string | string[] | undefined> | URLSearchParams,
): string {
  const query =
    params instanceof URLSearchParams ? new URLSearchParams(params) : new URLSearchParams();
  if (!(params instanceof URLSearchParams)) {
    for (const [name, value] of Object.entries(params)) {
      if (value === undefined) continue;
      for (const one of Array.isArray(value) ? value : [value]) query.append(name, one);
    }
  }
  const search = query.toString();
  return search === '' ? path : `${path}?${search}`;
}

/**
 * Past this length a chain forgets its oldest hops. Each hop nests the last
 * one's `from`, encoded again, so A → B → A → B… would grow a URL without
 * bound; dropping the origin's own `from` keeps the hop that matters — the
 * page somebody just left — and loses only the way back from there.
 */
const MAX_FROM = 1500;

function trimmed(from: string): string {
  if (from.length <= MAX_FROM) return from;
  const at = from.indexOf('?');
  if (at < 0) return from;
  const query = new URLSearchParams(from.slice(at + 1));
  query.delete('from');
  const search = query.toString();
  return search === '' ? from.slice(0, at) : `${from.slice(0, at)}?${search}`;
}

/**
 * Stamps a link with where it is being followed from.
 *
 * Every link that opens a record or another section carries it (POOLSE-91);
 * a link that only changes the page's own query — a tab, a page, a filter —
 * does not, and keeps the `from` the page already has instead.
 */
export function withFrom(href: string, from: string): string {
  return `${href}${href.includes('?') ? '&' : '?'}from=${encodeURIComponent(trimmed(from))}`;
}

/** The href a link should really point at, given the page it sits on. */
export function stampFrom(href: string, pathname: string, search: URLSearchParams): string {
  if (!href.startsWith('/dashboard') || /[?&]from=/.test(href)) return href;

  // The same page with another query — a tab, a page of results, a filter.
  // This page is not its own origin; it hands on the origin it was given, so
  // paging through a list reached from a site keeps its way back to the site.
  const path = href.split(/[?#]/)[0];
  if (path === pathname) {
    const from = search.get('from');
    return from === null ? href : withFrom(href, from);
  }

  return withFrom(href, currentHref(pathname, search));
}
