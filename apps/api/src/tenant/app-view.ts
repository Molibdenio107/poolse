import type { FilePurpose } from '../files/files.repository.js';
import { currentTenant, tenantStorage } from './tenant.context.js';

/**
 * What a view opens — POOLSE-188, rule 10.
 *
 * **A list, and everything else is refused**, in `TenantMiddleware`, so a new
 * route is closed until somebody adds it here. `READS` is deliberately the whole
 * of it: exact paths, GET only, with no prefix match. `/app/documents` must not
 * open `/app/documents/fpn`, which carries the full ID number.
 *
 * Left off on purpose: `/app/medical-leave` (health, rule 8), `/app/documents/fpn`
 * and `/students/:id/documents/fpn` (the ID number), `/students/:id/boletim` (a
 * filled form). `/files/:id` is on the list because the logo and faces are, and
 * `fileOpensInView` then decides by the file's purpose.
 *
 * Each entry names the route pattern the audit row records: a pattern, never the
 * URL, so an identifier cannot reach the log that way.
 */
const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

const READS: readonly { route: string; pattern: RegExp }[] = [
  { route: '/shell', pattern: /^\/shell$/ },
  { route: '/family', pattern: /^\/family$/ },
  { route: '/app/agenda', pattern: /^\/app\/agenda$/ },
  { route: '/app/lessons/:id', pattern: new RegExp(`^/app/lessons/${UUID}$`) },
  { route: '/app/lessons/:id/classmates', pattern: new RegExp(`^/app/lessons/${UUID}/classmates$`) },
  { route: '/app/avisos', pattern: /^\/app\/avisos$/ },
  { route: '/app/fees', pattern: /^\/app\/fees$/ },
  { route: '/app/documents', pattern: /^\/app\/documents$/ },
  { route: '/app/progress/:id', pattern: new RegExp(`^/app/progress/${UUID}$`) },
  { route: '/app/progress/:id/times', pattern: new RegExp(`^/app/progress/${UUID}/times$`) },
  { route: '/app/enrolment-requests', pattern: /^\/app\/enrolment-requests$/ },
  { route: '/app/teaching', pattern: /^\/app\/teaching$/ },
  { route: '/app/maintenance', pattern: /^\/app\/maintenance$/ },
  { route: '/sessions/:id/plan', pattern: new RegExp(`^/sessions/${UUID}/plan$`) },
  { route: '/files/:id', pattern: new RegExp(`^/files/${UUID}$`) },
];

/** The one write a view allows. */
const LEAVE = '/app-view/leave';

/** The route pattern this request reads, or null when a view does not open it. */
export function viewReadRoute(method: string, path: string): string | null {
  const verb = method.toUpperCase();
  if (verb !== 'GET' && verb !== 'HEAD') return null;
  return READS.find((one) => one.pattern.test(path))?.route ?? null;
}

export function isViewLeave(method: string, path: string): boolean {
  return method.toUpperCase() === 'POST' && path === LEAVE;
}

/** The path a request names, without its query string. */
export function requestPath(originalUrl: string): string {
  const end = originalUrl.indexOf('?');
  return end === -1 ? originalUrl : originalUrl.slice(0, end);
}

/** A support session looking through somebody's eyes. */
export function isSupportView(): boolean {
  const tenant = tenantStorage.getStore();
  return tenant?.viewing != null && tenant.support === true;
}

/**
 * Which stored files a view opens — rule 10a. The club's logo for everybody; a
 * person's photograph for an owner or an admin, so that the screen is the
 * person's own; nothing else. Support gets the logo and initials, so no child's
 * face reaches Poolse staff. The ordinary reader rules still apply after this.
 */
export function fileOpensInView(purpose: FilePurpose): boolean {
  if (currentTenant().viewing == null) return true;
  if (purpose === 'logo') return true;
  if (isSupportView()) return false;
  return purpose === 'student_photo' || purpose === 'staff_photo';
}

/**
 * The instructor's picture on a lesson, as a SQL expression. It may be a Clerk
 * address rather than a stored file, so `fileOpensInView` would never see it.
 * Both branches are code constants; nothing here comes from a request.
 */
export function instructorPhotoSql(user: string, member: string): string {
  return isSupportView()
    ? 'NULL::text'
    : `coalesce(${user}.cached_avatar_url, '/files/' || ${member}.photo_file_id::text)`;
}
