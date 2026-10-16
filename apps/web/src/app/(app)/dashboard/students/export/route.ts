import { getLocale, getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type Student } from '@/lib/api';
import { EXPORT_FIELDS, type ImportField } from '@/lib/sheet';
import { formatDate } from '@/lib/date-format';
import { printableResponse } from '@/lib/print-table';
import { rowFor, studentsCsv, studentsWorkbook } from './write-sheet';
import { today as clubToday } from '@/lib/dates';

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
 * Two files. `.xlsx` because that is what a club works in, and `.csv` because it
 * is the one format every other system on earth reads — a committee asking for
 * the list, an accountant's software, a mail-merge.
 *
 * And, since 12 October 2026, `format=pdf`: not a file at all but a page laid
 * out for A4 that opens the print dialog, built from the same header and the
 * same `rowFor` — `lib/print-table.ts`. It is not a `Format` because nothing
 * about it is a download.
 */
type Format = 'xlsx' | 'csv';

const CONTENT_TYPE: Record<Format, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
};

/** A filename a Windows, macOS and Linux machine will all accept unchanged. */
function fileNameFor(locale: string, filtered: boolean, format: Format): string {
  const base = locale === 'en' ? 'students' : 'alunos';
  const today = clubToday();
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

  if (url.searchParams.get('format') === 'pdf') {
    /*
     * What was filtered, said on the paper — there is no toolbar on a printout
     * to show it. The level's name is read off the rows, which all carry it
     * when the list was filtered by one.
     */
    const levelName = levelId === '' ? null : (data.students[0]?.levelName ?? null);
    const subtitle = [
      search === '' ? null : t('export.pdf.search', { term: search }),
      levelName === null ? null : t('export.pdf.level', { name: levelName }),
      data.capped
        ? t('export.pdf.capped', { shown: data.students.length, total: data.total })
        : t('export.pdf.count', { count: data.students.length }),
    ]
      .filter((part) => part !== null)
      .join(' · ');

    return printableResponse({
      locale,
      title: t('students.title'),
      subtitle,
      headers,
      // The file writes an ISO day and the club's own Portuguese words so it
      // re-imports in either language; paper is read by a person, so the date is
      // dd-MM-yyyy and the género and yes/no columns are said in their language.
      rows: data.students.map((student) => {
        const row = rowFor(student);
        const set = (field: ImportField, value: string): void => {
          const at = EXPORT_FIELDS.indexOf(field);
          if (at >= 0) row[at] = value;
        };
        set('birthDate', formatDate(student.birthDate));
        set(
          'gender',
          student.gender === null
            ? ''
            : t(student.gender === 'male' ? 'students.genderMale' : 'students.genderFemale'),
        );
        set('isSocio', student.isSocio ? t('export.pdf.yes') : '');
        set(
          'isPaid',
          student.paymentState === 'paid'
            ? t('export.pdf.yes')
            : student.paymentState === 'none'
              ? ''
              : t('export.pdf.no'),
        );
        return row;
      }),
      printedOn: t('export.pdf.printedOn', { date: formatDate(new Date()) }),
      printLabel: t('export.pdf.printLabel'),
      emptyLabel: t('export.pdf.empty'),
    });
  }

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
