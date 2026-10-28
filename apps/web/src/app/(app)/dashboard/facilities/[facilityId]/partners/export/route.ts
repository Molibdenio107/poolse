import { getLocale, getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type Facilities, type PartnerExport } from '@/lib/api';
import { PARTNER_EXPORT_FIELDS } from '@/lib/partner-sheet';
import { formatDate } from '@/lib/date-format';
import { printableResponse } from '@/lib/print-table';
import { partnerCsv, partnerWorkbook, rowFor } from './write-sheet';
import { today as clubToday } from '@/lib/dates';

/**
 * The partner list, downloaded — POOLSE-48, criterion 10.
 *
 * A route handler rather than a server action: the answer is a file, and a
 * server action returns a value to React. This way the button is an ordinary
 * link, the browser does what browsers do with an attachment, and it works with
 * no JavaScript at all.
 *
 * The Clerk token still never reaches the browser — `apiFetch` runs here, on the
 * server, exactly as it does on every page. The API refuses an instructor, so
 * hiding the link on the panel is a courtesy rather than the control.
 */

/**
 * The formats the list can leave in.
 *
 * Two, and only two. `.xlsx` because that is what a club works in, and `.csv`
 * because it is the one format every other system reads — a school's own
 * secretariat, an accountant's software, a câmara asking who uses the pool.
 *
 * `format=pdf` is the same rows as a page to print — `lib/print-table.ts` — and
 * is not a `Format` because nothing about it is a download.
 */
type Format = 'xlsx' | 'csv';

const CONTENT_TYPE: Record<Format, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
};

/** A filename a Windows, macOS and Linux machine will all accept unchanged. */
function fileNameFor(locale: string, format: Format): string {
  const base = locale === 'en' ? 'partners' : 'parcerias';
  const today = clubToday();
  // ASCII only, deliberately. A `Content-Disposition` carrying accented
  // characters needs the RFC 5987 encoding and is mangled by something in the
  // chain often enough that it is not worth the accent.
  return `poolse-${base}-${today}.${format}`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ facilityId: string }> },
): Promise<Response> {
  const { facilityId } = await params;
  const url = new URL(request.url);
  // Anything unrecognised falls back to the workbook rather than erroring: a
  // mistyped query parameter should still hand somebody their list.
  const format: Format = url.searchParams.get('format') === 'csv' ? 'csv' : 'xlsx';

  let data: PartnerExport;
  try {
    data = await apiFetch<PartnerExport>(
      `/facilities/${encodeURIComponent(facilityId)}/partners/export`,
    );
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
   * line. `partners.field.*` is what the mapping step shows and what
   * `matchPartnerColumns` is written to recognise, so a file exported here maps
   * itself when it comes back.
   */
  const headers = PARTNER_EXPORT_FIELDS.map((field) => t(`partners.field.${field}`));
  // POOLSE-117: days in the reader's words; the importer reads either language.
  const dayName = (weekday: number): string => t(`week.${weekday}`);

  if (url.searchParams.get('format') === 'pdf') {
    // Which site, said on the paper — partnerships are per site. Best effort: a
    // list of sites that will not load costs the line, never the printout.
    const siteName = await apiFetch<Facilities>('/facilities')
      .then((sites) => sites.facilities.find((site) => site.id === facilityId)?.name ?? null)
      .catch(() => null);
    const subtitle = [
      siteName === null ? null : t('export.pdf.site', { name: siteName }),
      t('export.pdf.count', { count: data.rows.length }),
    ]
      .filter((part) => part !== null)
      .join(' · ');

    return printableResponse({
      locale,
      title: t('partners.title'),
      subtitle,
      headers,
      // The file writes the enum's own spelling so it re-imports in either
      // language; paper is read by a person, so the type is said in their words.
      rows: data.rows.map((row) => {
        const out = rowFor(row, dayName);
        const at = PARTNER_EXPORT_FIELDS.indexOf('partnerType');
        if (at >= 0) out[at] = t(`partners.kind.${row.partnerType}`);
        return out;
      }),
      printedOn: t('export.pdf.printedOn', { date: formatDate(new Date()) }),
      printLabel: t('export.pdf.printLabel'),
      emptyLabel: t('export.pdf.empty'),
    });
  }

  const body =
    format === 'csv'
      ? partnerCsv(headers, data.rows, dayName)
      : await partnerWorkbook(headers, data.rows, t('partners.title'), dayName);

  return new Response(body, {
    headers: {
      'content-type': CONTENT_TYPE[format],
      'content-disposition': `attachment; filename="${fileNameFor(locale, format)}"`,
      // A club's partner list changes through August and this is a snapshot of
      // it; a cached copy handed back tomorrow would be wrong in a way nobody
      // would check.
      'cache-control': 'no-store',
    },
  });
}
