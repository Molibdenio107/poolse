/**
 * How a set of lanes reads — POOLSE-46.
 *
 * A booking used to hold one lane, so the label was one string. It can now hold
 * several: a competition squad takes two or three, hidroginástica takes the
 * tank. Three shapes, and the first is still by far the commonest:
 *
 *   []        nothing to say — the class has no lane chosen, which is ordinary
 *   [3]       "pista 3"
 *   [2,3,4]   "pistas 2–4", because that is how a club says it
 *   [1,4]     "pistas 1, 4" — a gap is real and must not be smoothed into a run
 *
 * Written once here rather than at each call site, because the range-versus-list
 * rule is exactly the kind of thing two copies would eventually disagree about.
 */
export function laneLabel(
  lanes: number[],
  t: (key: string, values?: Record<string, string | number>) => string,
): string | null {
  if (lanes.length === 0) return null;

  const sorted = [...lanes].sort((a, b) => a - b);
  const first = sorted[0]!;

  if (sorted.length === 1) return t('classes.laneN', { lane: first });

  const last = sorted[sorted.length - 1]!;
  // Contiguous, so it reads as a range. `1, 4` is not, and saying "1–4" would
  // claim two lanes the class does not have.
  const contiguous = sorted.every((lane, at) => lane === first + at);

  return contiguous
    ? t('classes.laneRange', { from: first, to: last })
    : t('classes.laneList', { lanes: sorted.join(', ') });
}
