import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch } from '@/lib/api';
import { EXAM_EXPORT_FIELDS } from '@/lib/exam-sheet';
import type { ExamExportRow } from '@/lib/medical-exams';
import { today as clubToday } from '@/lib/dates';
import { examWorkbook } from './write-sheet';

/**
 * The club's exames médicos, downloaded — POOLSE-133.
 *
 * A route handler, as the pay list's: the answer is a file. The API decides who
 * may have it (owner and admin); hiding the link is a courtesy, never the
 * control. Never cached — the dates of a child's medical exam are health data.
 */
export async function GET(): Promise<Response> {
  const t = await getTranslations();

  let data: { rows: ExamExportRow[] };
  try {
    data = await apiFetch<{ rows: ExamExportRow[] }>('/medical-exams/export');
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    return new Response(status === 403 ? t('exams.notPermitted') : t('exams.export.failed'), {
      status,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const headers = EXAM_EXPORT_FIELDS.map((field) => t(`exams.field.${field}`));
  const body = await examWorkbook(headers, data.rows, t('exams.export.sheetName'));

  return new Response(body, {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      // ASCII only, as every export here: an accent in Content-Disposition is
      // mangled somewhere in the chain often enough not to be worth it.
      'content-disposition': `attachment; filename="poolse-exames-medicos-${clubToday()}.xlsx"`,
      'cache-control': 'no-store, private',
    },
  });
}
