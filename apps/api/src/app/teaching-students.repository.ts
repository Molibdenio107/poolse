import { withOrg } from '@poolse/db';
import { displayName, nameOrder, shortName } from '../people/names.js';
import { progressSummary, type ProgressBest } from '../students/family-progress.repository.js';
import { lessonContact, type LessonContact } from '../students/students.repository.js';

/**
 * The teacher's *Alunos* tab (Rui, 07-11-2026): everybody in a turma they teach,
 * and a small card per student. "They teach" is the turma's own instructor, on a
 * live turma and a live enrolment; a stand-in reaches a child through the lesson's
 * *Contactos*, not here.
 */
const MINE = `
  FROM student_person s
  JOIN enrollment e ON e.student_id = s.id AND e.organization_id = s.organization_id
  JOIN class_group cg ON cg.id = e.class_group_id AND cg.organization_id = e.organization_id
 WHERE cg.instructor_membership_id = $1
   AND cg.archived_at IS NULL
   AND s.archived_at IS NULL
   AND (e.ended_on IS NULL OR e.ended_on >= current_date)`;

/** A face only with the family's photo consent, as on the register. */
const PHOTO = `
  CASE WHEN EXISTS (SELECT 1 FROM consent pc
                     WHERE pc.organization_id = s.organization_id AND pc.student_id = s.id
                       AND pc.kind = 'photo' AND pc.granted AND pc.withdrawn_at IS NULL)
       THEN s.photo_file_id END`;

export interface TeachingStudent {
  id: string;
  shortName: string;
  photoFileId: string | null;
  turmas: string[];
}

export interface TeachingStudentCard extends TeachingStudent {
  name: string;
  birthDate: string | null;
  levelName: string | null;
  favouriteStroke: string | null;
  bests: ProgressBest[];
  contact: LessonContact;
}

export async function teachingStudents(organizationId: string, membershipId: string): Promise<TeachingStudent[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<TeachingStudent>(
      `SELECT s.id, ${shortName('s')} AS "shortName", ${PHOTO} AS "photoFileId",
              array_agg(DISTINCT cg.name ORDER BY cg.name) AS turmas
         ${MINE}
        GROUP BY s.id, s.organization_id, s.photo_file_id, s.first_name, s.last_name
        ORDER BY ${nameOrder('s')}`,
      [membershipId],
    );
    return rows;
  });
}

/** One student's card, or null when they are not in a turma this person teaches. */
export async function teachingStudentCard(
  organizationId: string,
  membershipId: string,
  studentId: string,
): Promise<TeachingStudentCard | null> {
  const found = await withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<Omit<TeachingStudentCard, 'favouriteStroke' | 'bests' | 'contact'>>(
      `SELECT s.id, ${shortName('s')} AS "shortName", ${displayName('s')} AS name, ${PHOTO} AS "photoFileId",
              to_char(s.birth_date, 'YYYY-MM-DD') AS "birthDate",
              (SELECT l.name FROM student_level l
                WHERE l.id = s.level_id AND l.organization_id = s.organization_id) AS "levelName",
              array_agg(DISTINCT cg.name ORDER BY cg.name) AS turmas
         ${MINE}
          AND s.id = $2
        GROUP BY s.id, s.organization_id, s.photo_file_id, s.first_name, s.last_name, s.birth_date, s.level_id`,
      [membershipId, studentId],
    );
    return rows[0] ?? null;
  });
  if (found === null) return null;
  const [progress, contact] = await Promise.all([
    progressSummary(organizationId, studentId),
    // Audited as `student.contact_read`: these are a family's numbers.
    lessonContact(organizationId, studentId),
  ]);
  if (contact === null) return null;
  return { ...found, favouriteStroke: progress.favouriteStroke, bests: progress.bests, contact };
}
