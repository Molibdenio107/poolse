import ExcelJS from 'exceljs';
import { getTranslations } from 'next-intl/server';
import { formatSwimTime, INDIVIDUAL_EVENTS } from '@poolse/rules';
import { ApiError, apiFetch, type QualifyingStandard } from '@/lib/api';
import { toCsv } from '@/lib/csv';
import { today as clubToday } from '@/lib/dates';
import { exportGrid, type QualifyingStroke } from '@/lib/qualifying-sheet';

/**
 * A standard's entry times for one pool length, in the FPN's own wide shape —
 * POOLSE-85, slice 2. What this writes, the importer reads back: the event
 * heading is `qualifying.field.event` and each group's heading is the one
 * `qualifyingMatchSpec` maps *certain* (`exportGrid`, tested in
 * `qualifying-sheet.test.ts`). Times are text in `m:ss.hh`, never a spreadsheet
 * duration that Excel would re-format.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const url = new URL(request.url);
  const course = url.searchParams.get('course') === 'scm' ? 'scm' : 'lcm';
  const format = url.searchParams.get('format') === 'csv' ? 'csv' : 'xlsx';
  const t = await getTranslations();

  let standard: QualifyingStandard;
  try {
    standard = await apiFetch<QualifyingStandard>(`/qualifying/standards/${encodeURIComponent(id)}`);
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    return new Response(status === 403 ? t('students.export.forbidden') : t('students.export.failed'), {
      status,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const grid = exportGrid({
    groups: standard.ageGroups,
    times: standard.times,
    course,
    eventHeader: t('qualifying.field.event'),
    strokeName: (stroke: QualifyingStroke) => t(`progress.strokes.${stroke}`),
    formatTime: formatSwimTime,
    order: INDIVIDUAL_EVENTS,
  });

  // ASCII only in the filename, as every export here.
  const fileName = `poolse-minimos-${course === 'lcm' ? '50m' : '25m'}-${clubToday()}.${format}`;
  let body: string | ArrayBuffer;
  if (format === 'csv') {
    body = toCsv(grid);
  } else {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Poolse';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet(course === 'lcm' ? '50 m' : '25 m');
    grid.forEach((row, index) => {
      const added = sheet.addRow(row);
      if (index === 0) added.font = { bold: true };
    });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.columns.forEach((column) => {
      column.width = 18;
    });
    body = (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
  }

  return new Response(body, {
    headers: {
      'content-type':
        format === 'csv'
          ? 'text/csv; charset=utf-8'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${fileName}"`,
      'cache-control': 'no-store',
    },
  });
}
