import type { StudentLevel } from '@/lib/api';

/**
 * Who an escalão admits, and who else already claims those ages — round 5.
 *
 * Kept out of the components because three of them ask the same two questions:
 * the list draws a marker, the form warns before saving, and the student's
 * record says whether their escalão is for them.
 */

export type LevelSex = 'mixed' | 'male' | 'female' | 'nobody';

export function levelSex(level: {
  admitsMale: boolean;
  admitsFemale: boolean;
}): LevelSex {
  if (level.admitsMale && level.admitsFemale) return 'mixed';
  if (level.admitsMale) return 'male';
  if (level.admitsFemale) return 'female';
  // Refused by the table and by the form. Representable here only so nothing
  // has to throw while somebody is midway through unticking both boxes.
  return 'nobody';
}

/** The range as a closed interval in months, with the open ends filled in. */
function bounds(level: {
  minAgeMonths: number | null;
  maxAgeMonths: number | null;
}): [number, number] {
  return [level.minAgeMonths ?? 0, level.maxAgeMonths ?? 1440];
}

/**
 * The escalões whose ages a proposed one would run into, for the same sex.
 *
 * A **warning**, not a rule. Overlaps are normal in a real club — natação
 * adaptada from ten upwards runs alongside every competitive escalão — so the
 * form says who else covers these ages and lets the operator decide. What the
 * database refuses is narrower: the *identical* range for the same sex, which is
 * one escalão entered twice.
 *
 * An escalão with no range at all claims nothing, and is never reported.
 */
export function overlapping(
  levels: StudentLevel[],
  proposed: {
    minAgeMonths: number | null;
    maxAgeMonths: number | null;
    admitsMale: boolean;
    admitsFemale: boolean;
  },
  exceptId: string | null,
): StudentLevel[] {
  if (proposed.minAgeMonths === null && proposed.maxAgeMonths === null) return [];

  const [from, to] = bounds(proposed);

  return levels.filter((level) => {
    if (level.id === exceptId) return false;
    if (level.minAgeMonths === null && level.maxAgeMonths === null) return false;

    const sharesSex =
      (level.admitsMale && proposed.admitsMale) ||
      (level.admitsFemale && proposed.admitsFemale);
    if (!sharesSex) return false;

    const [otherFrom, otherTo] = bounds(level);
    return from <= otherTo && otherFrom <= to;
  });
}
