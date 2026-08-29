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
  ['/dashboard/facilities/staff/vacations', 'vacations.backToVacations'],
  ['/dashboard/facilities/staff', 'staff.backToStaff'],
  ['/dashboard/facilities/pools', 'facilities.backToFacilities'],
  ['/dashboard/facilities', 'facilities.backToSites'],
  ['/dashboard/students/guardians', 'students.backToGuardians'],
  ['/dashboard/students', 'students.backToRegister'],
  ['/dashboard/classes', 'classes.backToClasses'],
  ['/dashboard/calendar', 'calendar.backToCalendar'],
  ['/dashboard', 'common.backToDashboard'],
];

/**
 * A specific site, as opposed to the list of them.
 *
 * `/dashboard/facilities/<id>` and `/dashboard/facilities` share a prefix and
 * mean different things, and the prefix table cannot tell them apart on length
 * alone. Anything with one more segment that is not a known sub-section is a
 * site.
 */
const SUBSECTIONS = new Set(['staff', 'pools', 'new']);

function isFacilityDetail(path: string): boolean {
  const rest = path.slice('/dashboard/facilities/'.length).split(/[/?]/)[0] ?? '';
  return path.startsWith('/dashboard/facilities/') && rest !== '' && !SUBSECTIONS.has(rest);
}

/** The i18n key naming this destination. Never throws; falls back to "Voltar". */
export function backLabelKey(href: string): string {
  if (isFacilityDetail(href)) return 'facilities.backToSite';

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
  if (!from.startsWith(APP_ROOT)) return null;
  if (from.startsWith('//') || from.includes('\\')) return null;
  // Whitespace and control characters: a newline in a redirect target is how
  // a header-splitting payload starts, and a space is never in a path we wrote.
  if (/[\s\u0000-\u001f\u007f]/.test(from)) return null;
  // `/dashboardish` is not inside `/dashboard`.
  if (from !== APP_ROOT && !from.startsWith(`${APP_ROOT}/`) && !from.startsWith(`${APP_ROOT}?`)) {
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
 * Stamps a link with where it is being followed from.
 *
 * Only for links that cross into another section — a link within a section
 * already lands somewhere whose default parent is right, and a `from` on every
 * link in the app would put a query string on screens that never needed one.
 */
export function withFrom(href: string, from: string): string {
  return `${href}${href.includes('?') ? '&' : '?'}from=${encodeURIComponent(from)}`;
}
