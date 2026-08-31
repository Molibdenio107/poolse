import { getLocale, getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type Student } from '@/lib/api';
import { EXPORT_FIELDS } from '@/lib/sheet';
import { studentsCsv, studentsWorkbook } from './write-sheet';

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

/**
 * The formats the register can leave in.
 *
 * Two, and only two. `.xlsx` because that is what a club works in, and `.csv`
 * because it is the one format every other system on earth reads — a committee
 * asking for the list, an accountant's software, a mail-merge. A PDF roster
 * would be a *document* rather than data, which is a different feature with a
 * different page; `docs/product.md` is where that belongs if it is ever wanted.
 */
type Format = 'xlsx' | 'csv';

const CONTENT_TYPE: Record<Format, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
};

/** A filename a Windows, macOS and Linux machine will all accept unchanged. */
function fileNameFor(locale: string, filtered: boolean, format: Format): string {
  const base = locale === 'en' ? 'students' : 'alunos';
  const today = new Date().toISOString().slice(0, 10);
  // ASCII only, deliberately. A `Content-Disposition` carrying accented
  // characters needs the RFC 5987 encoding and is mangled by something in the
  // chain often enough that it is not worth the accent.
  return `poolse-${base}${filtered ? '-filtrados' : ''}-${today}.${format}`;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const search = (url.searchParams.get('search') ?? '').trim();
  const levelId = (url.searchParams.get('levelId') ?? '').trim();
  // Anything unrecognised falls back to the workbook rather than erroring: a
  // mistyped query parameter should still hand somebody their register.
  const format: Format = url.searchParams.get('format') === 'csv' ? 'csv' : 'xlsx';

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

  const body =
    format === 'csv'
      ? studentsCsv(headers, data.students)
      : await studentsWorkbook(headers, data.students, t('students.title'));
  const filtered = search !== '' || levelId !== '';

  return new Response(body, {
    headers: {
      'content-type': CONTENT_TYPE[format],
      'content-disposition': `attachment; filename="${fileNameFor(locale, filtered, format)}"`,
      // A register changes every day and this is a snapshot of it; a cached copy
      // handed back tomorrow would be wrong in a way nobody would think to check.
      'cache-control': 'no-store',
    },
  });
}
