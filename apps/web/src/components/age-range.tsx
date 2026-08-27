'use client';

import { useTranslations } from 'next-intl';
import type { StudentLevel } from '@/lib/api';
import { rangeShape } from '@/lib/ages';
import { cn } from '@/lib/utils';

/**
 * A level's age range, in words — backlog round 4, ticket 2.
 *
 * Three shapes, because "3–5", "18 e mais" and "até 3" are different sentences
 * rather than one template with a blank in it. A level with no bounds renders
 * nothing at all: an empty badge saying "—" would imply a range somebody forgot
 * to fill in, when "any age" is a real and common answer.
 */
export function AgeRangeBadge({
  level,
  className,
}: {
  level: Pick<StudentLevel, 'minAgeYears' | 'maxAgeYears'>;
  className?: string;
}): React.ReactElement | null {
  const t = useTranslations();
  const shape = rangeShape(level);
  if (shape === null) return null;

  const text =
    shape.kind === 'both'
      ? t('students.ageBoth', { min: shape.min, max: shape.max })
      : shape.kind === 'min'
        ? t('students.ageMin', { min: shape.min })
        : t('students.ageMax', { max: shape.max });

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
