'use client';

import { useTranslations } from 'next-intl';
import type { Student, StudentLevel } from '@/lib/api';
import { fitsLevel } from '@/lib/ages';

/**
 * "This student has aged out of their level" — backlog round 4, ticket 3.
 *
 * A flag, and only a flag. Nothing here moves anybody: a child enrolled
 * correctly in "3–5 anos" turns six mid-season, and deciding when they go up is
 * the club's job. A system that promoted them automatically would be making a
 * pedagogical decision from a birthday.
 *
 * Silent for a student with no birth date, which is most of them until an import
 * has been cleaned up. Silent too for a level with no bounds, and for a student
 * who simply fits.
 */
export function AgedOutFlag({
  student,
  levels,
}: {
  student: Pick<Student, 'levelId' | 'birthDate'>;
  levels: StudentLevel[];
}): React.ReactElement | null {
  const t = useTranslations();

  if (student.levelId === null) return null;

  const level = levels.find((candidate) => candidate.id === student.levelId);
  if (level === undefined) return null;

  const fit = fitsLevel(level, student.birthDate);
  if (fit === 'fits' || fit === 'unknown') return null;

  return (
    <span className="whitespace-nowrap rounded bg-warning/15 px-2 py-0.5 text-sm text-warning">
      {t(fit === 'tooYoung' ? 'students.flagTooYoung' : 'students.flagTooOld')}
    </span>
  );
}
