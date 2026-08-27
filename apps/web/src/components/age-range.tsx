'use client';

import { useTranslations } from 'next-intl';
import type { StudentLevel } from '@/lib/api';
import { rangeShape, shapeOfMonths, type AgeShape } from '@/lib/ages';
import { cn } from '@/lib/utils';

/**
 * A level's age range, in words — backlog round 4 ticket 2, and POOLSE-06.
 *
 * Three shapes, because "3–5 anos", "18 anos e mais" and "até 3 anos" are
 * different sentences rather than one template with a blank in it. A level with
 * no bounds renders nothing at all: an empty badge saying "—" would imply a
 * range somebody forgot to fill in, when "any age" is a real and common answer.
 *
 * Below a year the unit changes, which is the whole point of POOLSE-06 — "6
 * meses" is what a baby class is actually advertised as, and "0 anos" said
 * nothing useful.
 */

/** "6 meses", "1 ano", "3 anos", "1 ano e 6 meses". */
export function useAgeWords(): (shape: AgeShape) => string {
  const t = useTranslations();

  return (shape) => {
    if (shape.unit === 'months') return t('students.ageMonths', { count: shape.months });
    if (shape.unit === 'years') return t('students.ageYears', { count: shape.years });
    return t('students.ageYearsAndMonths', {
      years: t('students.ageYears', { count: shape.years }),
      months: t('students.ageMonths', { count: shape.months }),
    });
  };
}

/** The same, for a raw month count. */
export function useMonthWords(): (months: number) => string {
  const words = useAgeWords();
  return (months) => words(shapeOfMonths(months));
}

export function AgeRangeBadge({
  level,
  className,
}: {
  level: Pick<StudentLevel, 'minAgeMonths' | 'maxAgeMonths'>;
  className?: string;
}): React.ReactElement | null {
  const t = useTranslations();
  const words = useAgeWords();

  const shape = rangeShape(level);
  if (shape === null) return null;

  const text =
    shape.kind === 'both'
      ? t('students.ageBoth', { min: words(shape.min!), max: words(shape.max!) })
      : shape.kind === 'min'
        ? t('students.ageMin', { min: words(shape.min!) })
        : t('students.ageMax', { max: words(shape.max!) });

  return (
    <span
      className={cn(
        'whitespace-nowrap rounded bg-surface-muted px-2 py-0.5 text-sm text-foreground-muted',
        className,
      )}
    >
      {text}
    </span>
  );
}
