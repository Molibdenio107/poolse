import { getLocale, getTranslations } from 'next-intl/server';
import type { LabResult } from '@/lib/api';
import { formatStamp } from '@/lib/date-format';
import { formatReading } from '@/lib/pool-metrics';
import type { LabGrade } from '@/lib/water';
import { LabGradeChip } from '@/components/lab-grade-chip';
import { ArchiveLabResultButton, LabResultForm } from './lab-result-form';

/**
 * Análises laboratoriais — POOLSE-72.
 *
 * Each report with its grade under NP 4542:2017 §4.4, in words and with an
 * icon so colour never carries it alone. The grade comes from the API
 * (`gradeLabResult()`), never recomputed here. Every failure is said with the
 * value it was judged against, what the lab did not report is named, and an
 * alert says honestly whether anything was sent.
 */
export async function LabResultsSection({
  poolId,
  results,
  total,
  canRecord,
  canArchive,
  emailConfigured,
  importer,
  pagination,
}: {
  poolId: string;
  /** This page's results — ten at a time since 29-10-2026. */
  results: LabResult[];
  /** Every result, across the pages, so "none yet" is about the pool. */
  total: number;
  canRecord: boolean;
  canArchive: boolean;
  emailConfigured: boolean;
  /** The report import, on top of the list (Rui, 29-10-2026). */
  importer: React.ReactNode;
  pagination: React.ReactNode;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();
  const name = (parameter: string): string => t(`labResults.parameter.${parameter}`);

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-foreground-muted">{t('labResults.hint')}</p>

      {/* The ways in come first, the record after (Rui, 29-10-2026). */}
      {importer}
      {canRecord && <LabResultForm poolId={poolId} />}

      {total === 0 ? (
        <p className="rounded border border-dashed border-border p-4 text-sm text-foreground-muted">
          {t('labResults.empty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {results.map((result) => {
            const { grading } = result;
            return (
              <li key={result.id} className="flex flex-col gap-3 rounded border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-col">
                    <span className="font-medium">
                      {t('labResults.sampledAt', { when: formatStamp(result.sampledAt) })}
                    </span>
                    <span className="text-sm text-foreground-muted">
                      {[result.laboratory, result.reportReference].filter(Boolean).join(' · ') ||
                        t('labResults.noLaboratory')}
                    </span>
                  </span>
                  <LabGradeChip grade={grading.grade} label={gradeLabel(t, grading.grade)} />
                </div>

                {grading.failures.length > 0 && (
                  <ul className="flex flex-col gap-1 text-sm">
                    {grading.failures.map((failure) => (
                      <li key={failure.parameter}>
                        {t(`labResults.failure.${failure.kind}`, {
                          parameter: name(failure.parameter),
                          value: formatReading(failure.value, locale),
                          unit: failure.unit,
                          limit: formatReading(failure.limit, locale),
                        })}
                        {failure.ph === null && ` ${t('labResults.noPh')}`}
                      </li>
                    ))}
                  </ul>
                )}

                {!grading.microbiologyReported && (
                  <p className="text-sm text-foreground-muted">{t('labResults.noMicrobiology')}</p>
                )}
                {grading.microbiologyReported && grading.organismsMissing.length > 0 && (
                  <p className="text-sm text-foreground-muted">
                    {t('labResults.notReported', {
                      list: grading.organismsMissing.map(name).join(', '),
                    })}
                  </p>
                )}

                <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                  {result.values.map((value) => (
                    <div key={value.parameter} className="flex justify-between gap-3">
                      <dt className="text-foreground-muted">{name(value.parameter)}</dt>
                      <dd>
                        {formatReading(value.value, locale)} {value.unit}
                      </dd>
                    </div>
                  ))}
                </dl>

                {(result.samplePoint || result.sampleDepth) && (
                  <p className="text-sm text-foreground-muted">
                    {t('labResults.samplePointShown', {
                      point: result.samplePoint ?? '—',
                      depth: result.sampleDepth === null ? '—' : t(`labResults.depth.${result.sampleDepth}`),
                    })}
                  </p>
                )}

                {result.alert !== null && (
                  <p className="text-sm">
                    {result.alert.deliveredAt !== null
                      ? t('labResults.alertSent', { count: result.alert.recipients.length })
                      : emailConfigured
                        ? t('labResults.alertNotSent')
                        : t('labResults.alertNoProvider')}
                  </p>
                )}

                {canArchive && <ArchiveLabResultButton poolId={poolId} labResultId={result.id} />}
              </li>
            );
          })}
        </ul>
      )}

      {pagination}
    </div>
  );
}

type T = Awaited<ReturnType<typeof getTranslations>>;

function gradeLabel(t: T, grade: LabGrade | null): string {
  return grade === null ? t('labResults.grade.none') : t(`labResults.grade.${grade}`);
}
