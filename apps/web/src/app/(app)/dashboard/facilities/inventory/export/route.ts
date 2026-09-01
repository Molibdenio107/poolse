import { getLocale, getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type InventoryExport } from '@/lib/api';
import { INVENTORY_EXPORT_FIELDS } from '@/lib/inventory-sheet';
import { inventoryCsv, inventoryWorkbook } from './write-sheet';

/**
 * The store room, downloaded — round 6.
 *
 * A route handler rather than a server action: the answer is a file, and a
 * server action returns a value to React. This way the button is an ordinary
 * link, the browser does what browsers do with an attachment, and it works with
 * no JavaScript at all.
 *
 * It replaces the CSV the pool page built in the browser. That version could
 * only ever be a CSV, wrote its own headers, and had no relationship to any
 * importer — so a club that exported the list, corrected it and sent it back had
 * to map five columns by hand. Now the header row *is* the import's field
 * labels, and the file maps itself.
 *
 * The Clerk token still never reaches the browser — `apiFetch` runs here, on the
 * server, exactly as it does on every page.
 */

/**
 * The formats the list can leave in.
 *
 * Two, and only two. `.xlsx` because that is what a club works in, and `.csv`
 * because it is the one format every other system on earth reads — a supplier's
 * order form, an accountant's software, a committee asking what the club owns.
 */
type Format = 'xlsx' | 'csv';

const CONTENT_TYPE: Record<Format, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
};

/** A filename a Windows, macOS and Linux machine will all accept unchanged. */
function fileNameFor(locale: string, filtered: boolean, format: Format): string {
  const base = locale === 'en' ? 'inventory' : 'inventario';
  // Dated, because an inventory export is a stocktake and two of them without
  // dates in the same folder are indistinguishable.
  const today = new Date().toISOString().slice(0, 10);
  // ASCII only, deliberately. A `Content-Disposition` carrying accented
  // characters needs the RFC 5987 encoding and is mangled by something in the
  // chain often enough that it is not worth the accent.
  return `poolse-${base}${filtered ? '-filtrado' : ''}-${today}.${format}`;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const facilityId = (url.searchParams.get('facilityId') ?? '').trim();
  const search = (url.searchParams.get('search') ?? '').trim();
  // Anything unrecognised falls back to the workbook rather than erroring: a
  // mistyped query parameter should still hand somebody their list.
  const format: Format = url.searchParams.get('format') === 'csv' ? 'csv' : 'xlsx';

  const query = new URLSearchParams();
  if (facilityId !== '') query.set('facilityId', facilityId);
  // The search travels; the page does not. An export under a filtered list must
  // be that list, and it must be all of it rather than the page on screen.
  if (search !== '') query.set('search', search);

  let data: InventoryExport;
  try {
    data = await apiFetch<InventoryExport>(
      `/inventory/export${query.size > 0 ? `?${query}` : ''}`,
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
   * line. `inventory.field.*` is what the mapping step shows and what
   * `matchInventoryColumns` is written to recognise, so a file exported here
   * maps itself when it comes back.
   */
  const headers = INVENTORY_EXPORT_FIELDS.map((field) => t(`inventory.field.${field}`));

  const body =
    format === 'csv'
      ? inventoryCsv(headers, data.items)
      : await inventoryWorkbook(headers, data.items, t('inventory.title'));

  return new Response(body, {
    headers: {
      'content-type': CONTENT_TYPE[format],
      'content-disposition': `attachment; filename="${fileNameFor(locale, search !== '', format)}"`,
      // A stocktake changes every week and this is a snapshot of it; a cached
      // copy handed back tomorrow would be wrong in a way nobody would check.
      'cache-control': 'no-store',
    },
  });
}
