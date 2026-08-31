import { getLocale, getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type Student } from '@/lib/api';
import { EXPORT_FIELDS } from '@/lib/sheet';
import { studentsWorkbook } from './write-sheet';

/**
 * Slice 1.11 — the download itself.
 *
 * A route handler rather than a server action: the answer is a file, and a
 * server action returns a value to React. This way the button is an ordinary
 * link, the browser does what browsers do with an attachment, and it works with
 * no JavaScript at all.
 *
 * The Clerk token still never reaches the browser — `apiFetch` runs here, on the
 * server, exactly as it does on every page.
 *
 * A static segment beside `[id]`, the same as `new` and `import` already are;
 * Next resolves the literal first, so `/dashboard/students/export` is this and
 * not a student whose id is the word "export".
 */

interface ExportResponse {
  students: Student[];
  total: number;
  capped: boolean;
  max: number;
}

/** A filename a Windows, macOS and Linux machine will all accept unchanged. */
function fileNameFor(locale: string, filtered: boolean): string {
  const base = locale === 'en' ? 'students' : 'alunos';
  const today = new Date().toISOString().slice(0, 10);
  // ASCII only, deliberately. A `Content-Disposition` carrying accented
  // characters needs the RFC 5987 encoding and is mangled by something in the
  // chain often enough that it is not worth the accent.
  return `poolse-${base}${filtered ? '-filtrados' : ''}-${today}.xlsx`;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const search = (url.searchParams.get('search') ?? '').trim();
  const levelId = (url.searchParams.get('levelId') ?? '').trim();

  const query = new URLSearchParams();
  if (search !== '') query.set('search', search);
  if (levelId !== '') query.set('levelId', levelId);

  let data: ExportResponse;
  try {
    data = await apiFetch<ExportResponse>(`/exports/students${query.size > 0 ? `?${query}` : ''}`);
  } catch (error) {
    /*
     * Plain text, and the real status. Nothing renders this — it is what a
     * browser shows when a download fails — so a translated page would be
     * ceremony, but a 403 must stay a 403 rather than becoming a corrupt
     * spreadsheet the operator opens and puzzles over.
     */
    const status = error instanceof ApiError ? error.status : 500;
    const t = await getTranslations();
    return new Response(
      status === 403 ? t('students.export.forbidden') : t('students.export.failed'),
      { status, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    );
  }

  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);

  /*
   * The header row is the import's own field labels — the round trip in one
   * line. `students.import.field.*` is what the mapping step shows and what
   * `guessMapping` is written to recognise, so a file exported here maps itself
   * when it comes back. `sheet.test.ts` asserts exactly that, over the real
   * catalogue, in both locales.
   */
  const headers = EXPORT_FIELDS.map((field) => t(`students.import.field.${field}`));

  const workbook = await studentsWorkbook(headers, data.students, t('students.title'));
  const filtered = search !== '' || levelId !== '';

  return new Response(workbook, {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${fileNameFor(locale, filtered)}"`,
      // A register changes every day and this is a snapshot of it; a cached copy
      // handed back tomorrow would be wrong in a way nobody would think to check.
      'cache-control': 'no-store',
    },
  });
}
