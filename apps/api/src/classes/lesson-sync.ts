import { Logger } from '@nestjs/common';
import { withOrg } from '@poolse/db';
import { findScheduleClashes, generateSeason, type ScheduleClash } from './sessions.repository.js';

/**
 * A turma's lessons follow its weekly pattern on their own — 11 October 2026.
 *
 * Lessons (`class_session`) used to exist only after somebody pressed *Gerar a
 * época*. A turma placed on the calendar afterwards had none, so its card lost
 * the training plan, the register and Cancelar aula — which is exactly what
 * happened to every turma whose lessons had been generated for September only.
 * Rui's call: lessons are created automatically whenever a weekly pattern is
 * written, so every block always has its lesson, as it did in September.
 *
 * **From today to the end of the published season**, never the past: a turma
 * placed today must not suddenly owe registers for the weeks before it existed.
 * `generate_sessions` is idempotent — it adds what is missing, leaves existing
 * lessons alone and applies the closures — so calling it after every pattern
 * write is the same as pressing the button, which stays for after a closure.
 *
 * **A clash is said, not generated around.** Two turmas sharing an instructor at
 * one hour make generation refuse, exactly as the button does; the caller gets
 * the clashes to name, and the write that triggered this still stands.
 *
 * Never throws: the pattern write already committed, and a lesson top-up that
 * failed is logged rather than turned into a failure of the save.
 */

export type LessonSync =
  | { created: number }
  | { clashes: ScheduleClash[] }
  | null;

const logger = new Logger('LessonSync');

export async function syncSeasonLessons(organizationId: string): Promise<LessonSync> {
  try {
    const window = await withOrg(organizationId, async (tx) => {
      const { rows } = await tx.query<{ from: string; to: string }>(
        `SELECT to_char(greatest(starts_on, club_today()), 'YYYY-MM-DD') AS "from",
                to_char(ends_on, 'YYYY-MM-DD') AS "to"
           FROM season
          WHERE status = 'published' AND archived_at IS NULL AND ends_on >= club_today()
          ORDER BY starts_on
          LIMIT 1`,
      );
      return rows[0] ?? null;
    });
    if (window === null) return null;

    const clashes = await findScheduleClashes(organizationId);
    if (clashes.length > 0) return { clashes };

    const result = await generateSeason(organizationId, window.from, window.to);
    return { created: result.created };
  } catch (error) {
    logger.warn(`Could not top up lessons for ${organizationId}: ${String(error)}`);
    return null;
  }
}
