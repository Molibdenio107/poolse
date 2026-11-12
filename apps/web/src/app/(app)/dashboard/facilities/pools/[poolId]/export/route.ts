import ExcelJS from 'exceljs';
import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type PoolDetail } from '@/lib/api';
import { formatDate, formatTime } from '@/lib/date-format';
import { POOL_METRICS } from '@/lib/pool-metrics';
import { today as clubToday } from '@/lib/dates';

/**
 * Histórico as an Excel workbook — Rui, 12-11-2026, beside the existing CSV.
 *
 * A route handler, as the register's export is: the answer is a file, the
 * button is a plain link, and the Clerk token stays on the server (`apiFetch`).
 * The API's own role check decides who may read the analyses; this route adds
 * no second rule.
 *
 * **What this writes, the water import reads back** (`WATER_EXPORT_FIELDS`):
 * *Data* (dd-MM-yyyy) and *Hora* on the facility's clock, one numeric column per
 * metric the tank measures, then *Notas* — every header a word the importer's
 * column matcher already knows, so a corrected sheet re-imports with no mapping.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ poolId: string }> }): Promise<Response> {
  const { poolId } = await params;
  const t = await getTranslations();

  let pool: PoolDetail;
  try {
    pool = await apiFetch<PoolDetail>(`/facilities/pools/${poolId}`);
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    return new Response(null, { status: status === 403 || status === 404 ? status : 500 });
  }

  const measured = POOL_METRICS.filter((metric) =>
    pool.analyses.some((analysis) => analysis.values.some((value) => value.metric === metric)),
  );

  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet(t('facilities.waterExport.sheet'));
  sheet.addRow([
    t('facilities.waterExport.date'),
    t('facilities.waterExport.time'),
    ...measured.map((metric) => `${t(`facilities.metric.${metric}`)} (${t(`facilities.unit.${metric}`)})`),
    t('facilities.waterExport.notes'),
  ]);
  sheet.getRow(1).font = { bold: true };

  // Oldest first, as the importer and a person reading down a month expect.
  for (const analysis of pool.analyses) {
    const at = new Date(analysis.takenAt);
    sheet.addRow([
      formatDate(at),
      formatTime(at),
      ...measured.map((metric) => analysis.values.find((value) => value.metric === metric)?.value ?? null),
      analysis.notes ?? '',
    ]);
  }
  sheet.columns.forEach((column) => {
    column.width = 16;
  });

  const bytes = await book.xlsx.writeBuffer();
  // ASCII only in the filename, as the register's export: accents in a
  // Content-Disposition are mangled somewhere in the chain often enough.
  const slug = pool.name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return new Response(bytes, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="poolse-${slug || 'tanque'}-${clubToday()}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
