import { getLocale, getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type SalaryExportRow } from '@/lib/api';
import { SALARY_EXPORT_FIELDS } from '@/lib/salary-sheet';
import { salaryCsv, salaryWorkbook } from './write-sheet';

/**
 * The pay list, downloaded — POOLSE-59.
 *
 * A route handler rather than a server action: the answer is a file, and a
 * server action returns a value to React. This way the button is an ordinary
 * link, the browser does what browsers do with an attachment, and it works with
 * no JavaScript at all.
 *
 * **The API decides who may have it, and which rows.** `apiFetch` runs here, on
 * the server, so the Clerk token never reaches the browser; the endpoint refuses
 * anybody but an Owner or an Admin, and an Admin's file omits the Owner by the
 * same predicate the screen uses. Hiding the link is a courtesy, never the
 * control.
 *
 * **No amount in the URL.** The query string carries a format and nothing else —
 * the same rule the rest of this feature keeps, and the reason a download is a
 * GET with no parameters worth logging.
 */

/**
 * The formats the list can leave in.
 *
 * Two, and only two. `.xlsx` because that is what a club works in, and `.csv`
 * because it is what an accountant's software reads.
 */
type Format = 'xlsx' | 'csv';

const CONTENT_TYPE: Record<Format, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
};

/** A filename a Windows, macOS and Linux machine will all accept unchanged. */
function fileNameFor(locale: string, format: Format): string {
  const base = locale === 'en' ? 'salaries' : 'salarios';
  const today = new Date().toISOString().slice(0, 10);
  // ASCII only, deliberately: a `Content-Disposition` carrying accented
  // characters needs the RFC 5987 encoding and is mangled by something in the
  // chain often enough that it is not worth the accent.
  return `poolse-${base}-${today}.${format}`;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  // Anything unrecognised falls back to the workbook rather than erroring: a
  // mistyped query parameter should still hand somebody their list.
  const format: Format = url.searchParams.get('format') === 'csv' ? 'csv' : 'xlsx';

  let data: { rows: SalaryExportRow[] };
  try {
    data = await apiFetch<{ rows: SalaryExportRow[] }>('/staff/salaries/export');
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
      status === 403 ? t('salaries.notPermitted') : t('salaries.exportFailed'),
      { status, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    );
  }

  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);

  const headers = SALARY_EXPORT_FIELDS.map((field) => t(`salaries.field.${field}`));

  const body =
    format === 'csv'
      ? salaryCsv(headers, data.rows)
      : await salaryWorkbook(headers, data.rows, t('salaries.title'));

  return new Response(body, {
    headers: {
      'content-type': CONTENT_TYPE[format],
      'content-disposition': `attachment; filename="${fileNameFor(locale, format)}"`,
      /*
       * Never cached, and this one matters more than most.
       *
       * A pay list is the most sensitive file this product hands out; a copy
       * sitting in a shared proxy or handed back tomorrow would be wrong *and*
       * would be a salary nobody meant to leave the building twice.
       */
      'cache-control': 'no-store, private',
    },
  });
}
