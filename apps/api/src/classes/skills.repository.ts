import { withOrg } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { nameOrder, shortName } from '../people/names.js';

/**
 * Skills and where each student stands — POOLSE-20.
 *
 * The grid an instructor works from is students down, skills across. That shape
 * is what the queries here are built for: one read per turma rather than one per
 * student, because it is opened on a phone at the poolside and a request per row
 * is a request per row on a 4G connection in a building made of concrete.
 */

export type SkillState = 'not_started' | 'started' | 'tested' | 'attained';

export const SKILL_STATES: readonly SkillState[] = [
  'not_started',
  'started',
  'tested',
  'attained',
];

export interface Skill {
  id: string;
  levelId: string;
  name: string;
  sortOrder: number;
  minDays: number | null;
  minLessons: number | null;
  videoUrl: string | null;
}

export interface SkillMark {
  studentId: string;
  skillId: string;
  state: SkillState;
  /**
   * Whether the thresholds are satisfied for this pairing.
   *
   * Sent with the grid so the interface can show what will need an override
   * *before* somebody taps it, rather than refusing after. Computed per cell,
   * which is why the grid asks for it once rather than per tap.
   */
  ready: boolean;
  overridden: boolean;
}

export interface TurmaSkills {
  classGroupId: string;
  className: string;
  levelId: string | null;
  levelName: string | null;
  students: { id: string; name: string }[];
  skills: Skill[];
  marks: SkillMark[];
}

/**
 * Everything the grid needs, in one read.
 *
 * A turma whose level has no skills comes back with an empty `skills` and a full
 * `students` — the screen then says so, which is a better answer than an empty
 * page that looks broken.
 */
export async function turmaSkills(
  organizationId: string,
  classGroupId: string,
): Promise<TurmaSkills | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows: groups } = await tx.query<{
      id: string;
      name: string;
      level_id: string | null;
      level_name: string | null;
    }>(
      `SELECT cg.id, cg.name, cg.level_id, l.name AS level_name
         FROM class_group cg
         LEFT JOIN student_level l
                ON l.id = cg.level_id AND l.organization_id = cg.organization_id
        WHERE cg.id = $1 AND cg.archived_at IS NULL`,
      [classGroupId],
    );

    const group = groups[0];
    if (!group) return null;

    // Active enrolments only. A waiting-list student is not in the class, and a
    // grid that listed them would be marking somebody who was not there.
    const { rows: students } = await tx.query<{ id: string; name: string }>(
      `SELECT s.id, ${shortName('s')} AS name
         FROM enrollment e
         JOIN student s ON s.id = e.student_id AND s.organization_id = e.organization_id
        WHERE e.class_group_id = $1
          AND e.status = 'active'
          AND s.archived_at IS NULL
        ORDER BY ${nameOrder('s')}`,
      [classGroupId],
    );

    const { rows: skills } = await tx.query<{
      id: string;
      level_id: string;
      name: string;
      sort_order: number;
      min_days: number | null;
      min_lessons: number | null;
      video_url: string | null;
    }>(
      `SELECT id, level_id, name, sort_order, min_days, min_lessons, video_url
         FROM skill
        WHERE level_id = $1 AND archived_at IS NULL
        ORDER BY sort_order, name`,
      [group.level_id],
    );

    /*
     * Marks for exactly this grid.
     *
     * The cross join is what makes `ready` answerable for a cell that has no row
     * yet — a student who has not started a skill still needs to be told whether
     * signing it off would need an override. Bounded by the turma's roll and its
     * level's skills, so it is students × skills and no larger.
     */
    const { rows: marks } = await tx.query<{
      student_id: string;
      skill_id: string;
      state: SkillState;
      ready: boolean;
      overridden: boolean;
    }>(
      `SELECT s.id AS student_id,
              k.id AS skill_id,
              coalesce(p.state, 'not_started') AS state,
              skill_thresholds_met($1, s.id, k.id) AS ready,
              p.override_by_membership_id IS NOT NULL AS overridden
         FROM enrollment e
         JOIN student s ON s.id = e.student_id AND s.organization_id = e.organization_id
        CROSS JOIN skill k
         LEFT JOIN skill_progress p
                ON p.student_id = s.id AND p.skill_id = k.id
        WHERE e.class_group_id = $2
          AND e.status = 'active'
          AND s.archived_at IS NULL
          AND k.level_id = $3
          AND k.archived_at IS NULL`,
      [organizationId, classGroupId, group.level_id],
    );

    return {
      classGroupId: group.id,
      className: group.name,
      levelId: group.level_id,
      levelName: group.level_name,
      students,
      skills: skills.map((row) => ({
        id: row.id,
        levelId: row.level_id,
        name: row.name,
        sortOrder: row.sort_order,
        minDays: row.min_days,
        minLessons: row.min_lessons,
        videoUrl: row.video_url,
      })),
      marks: marks.map((row) => ({
        studentId: row.student_id,
        skillId: row.skill_id,
        state: row.state,
        ready: row.ready,
        overridden: row.overridden,
      })),
    };
  });
}

export interface MarkInput {
  studentId: string;
  skillId: string;
  state: SkillState;
  /** Required to sign off a skill whose thresholds are not met. */
  overrideReason?: string | null;
}

export interface MarkOutcome {
  saved: number;
  /**
   * Pairings refused because a threshold was not met and no reason was given.
   *
   * Reported rather than swallowed: an instructor who marked a column of twelve
   * and got ten needs to know which two, and why.
   */
  needsOverride: { studentId: string; skillId: string }[];
}

/**
 * Marks one or many cells — POOLSE-20, criterion 4.
 *
 * Takes a list because that is what the grid does: tapping a column header marks
 * one skill across the whole turma, tapping a row marks one student across every
 * skill. One request for the gesture, one transaction, so a lost connection
 * halfway through does not leave half a column marked.
 *
 * Criterion 5 says a lost connection must never lose entered marks. The client
 * keeps its own copy and re-sends; the transaction here is what makes re-sending
 * safe, because every write is an upsert of a known state rather than an
 * increment.
 */
export async function markSkills(
  organizationId: string,
  membershipId: string | null,
  marks: MarkInput[],
): Promise<MarkOutcome> {
  return withOrg(organizationId, async (tx) => {
    const needsOverride: MarkOutcome['needsOverride'] = [];
    let saved = 0;

    for (const mark of marks) {
      const reason = mark.overrideReason?.trim() ?? '';

      /*
       * Thresholds bite only on the way to Adquirido.
       *
       * Iniciado and Avaliado are observations about what is happening in the
       * water; nothing should stop an instructor recording those. It is the
       * sign-off that carries weight, and only that.
       */
      if (mark.state === 'attained') {
        const { rows } = await tx.query<{ skill_thresholds_met: boolean }>(
          `SELECT skill_thresholds_met($1, $2, $3)`,
          [organizationId, mark.studentId, mark.skillId],
        );

        if (rows[0]?.skill_thresholds_met === false && reason === '') {
          needsOverride.push({ studentId: mark.studentId, skillId: mark.skillId });
          continue;
        }
      }

      const overriding = mark.state === 'attained' && reason !== '';

      await tx.query(
        `INSERT INTO skill_progress (
           organization_id, student_id, skill_id, state,
           recorded_by_membership_id, override_by_membership_id, override_reason
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (student_id, skill_id) DO UPDATE
            SET state = EXCLUDED.state,
                recorded_by_membership_id = EXCLUDED.recorded_by_membership_id,
                -- An override belongs to the sign-off that needed it. Marking the
                -- skill again without one clears it rather than leaving a stale
                -- name attached to a decision nobody made.
                override_by_membership_id = EXCLUDED.override_by_membership_id,
                override_reason = EXCLUDED.override_reason`,
        [
          organizationId,
          mark.studentId,
          mark.skillId,
          mark.state,
          membershipId,
          overriding ? membershipId : null,
          overriding ? reason : null,
        ],
      );

      saved += 1;
    }

    if (saved > 0) {
      // One entry for the gesture, not one per cell: a column of twenty is one
      // thing an instructor did, and twenty rows would bury the trail.
      await recordAudit(tx, {
        action: 'skill.marked',
        /*
         * The entity is the skill, because that is what the id is.
         *
         * This said 'class_group' while carrying a skill id, so every marking
         * wrote an audit row pointing at a turma that does not exist — an entity
         * reference nothing could ever resolve.
         *
         * There is no turma to record instead: a batch is (student, skill) pairs
         * and may span several. The first skill id stands for the batch, which is
         * what it always did; only the label was wrong.
         */
        entityType: 'skill',
        entityId: marks[0]?.skillId ?? null,
        data: { saved, refused: needsOverride.length },
      });
    }

    return { saved, needsOverride };
  });
}

// ---------------------------------------------------------------------------
// Defining the skills of a level
// ---------------------------------------------------------------------------

export interface SkillInput {
  levelId: string;
  name: string;
  minDays: number | null;
  minLessons: number | null;
  videoUrl: string | null;
}

export async function listSkills(organizationId: string, levelId: string): Promise<Skill[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      level_id: string;
      name: string;
      sort_order: number;
      min_days: number | null;
      min_lessons: number | null;
      video_url: string | null;
    }>(
      `SELECT id, level_id, name, sort_order, min_days, min_lessons, video_url
         FROM skill
        WHERE level_id = $1 AND archived_at IS NULL
        ORDER BY sort_order, name`,
      [levelId],
    );

    return rows.map((row) => ({
      id: row.id,
      levelId: row.level_id,
      name: row.name,
      sortOrder: row.sort_order,
      minDays: row.min_days,
      minLessons: row.min_lessons,
      videoUrl: row.video_url,
    }));
  });
}

export async function createSkill(
  organizationId: string,
  input: SkillInput,
): Promise<string | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO skill (organization_id, level_id, name, sort_order,
                          min_days, min_lessons, video_url)
       SELECT $1, $2, $3,
              coalesce((SELECT max(sort_order) + 1 FROM skill
                         WHERE level_id = $2 AND archived_at IS NULL), 0),
              $4, $5, $6
        WHERE EXISTS (
          SELECT 1 FROM student_level
           WHERE id = $2 AND organization_id = $1 AND archived_at IS NULL
        )
       RETURNING id`,
      [
        organizationId,
        input.levelId,
        input.name,
        input.minDays,
        input.minLessons,
        input.videoUrl,
      ],
    );

    // No row means the level does not belong to this organization, or does not
    // exist. Indistinguishable on purpose — see the note on `findStudent`.
    const id = rows[0]?.id;
    if (id === undefined) return null;

    await recordAudit(tx, {
      action: 'skill.created',
      entityType: 'skill',
      entityId: id,
      data: { name: input.name, levelId: input.levelId },
    });

    return id;
  });
}

export async function archiveSkill(organizationId: string, skillId: string): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string; name: string }>(
      `UPDATE skill SET archived_at = now()
        WHERE id = $1 AND archived_at IS NULL
      RETURNING id, name`,
      [skillId],
    );
    if (!rows[0]) return false;

    await recordAudit(tx, {
      action: 'skill.archived',
      entityType: 'skill',
      entityId: skillId,
      data: { name: rows[0].name },
    });
    return true;
  });
}

/**
 * The order skills are taught in — POOLSE-40 AC7.
 *
 * Meaningful, not cosmetic: it is what POOLSE-19 will read to decide when a
 * level is finished, so a drag here changes what "ready to advance" means.
 *
 * Mirrors `reorderLevels` deliberately — one interaction pattern at two levels
 * of the hierarchy, and one query shape to understand rather than two.
 */
export async function reorderSkills(
  organizationId: string,
  levelId: string,
  ids: string[],
): Promise<boolean> {
  if (ids.length === 0) return true;

  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `UPDATE skill AS s
          SET sort_order = ordered.position
         FROM unnest($1::uuid[]) WITH ORDINALITY AS ordered(id, position)
        WHERE s.id = ordered.id
          AND s.level_id = $2
          AND s.archived_at IS NULL
      RETURNING s.id`,
      [ids, levelId],
    );

    // Nothing matched: archived, another level's, or another tenant's and RLS
    // hid it. Either way the caller is working from a stale list.
    if (rows.length === 0) return false;

    await recordAudit(tx, {
      action: 'skill.reordered',
      entityType: 'student_level',
      entityId: levelId,
      data: { count: rows.length },
    });

    return true;
  });
}
