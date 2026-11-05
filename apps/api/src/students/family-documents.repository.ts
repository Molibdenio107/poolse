import { documentsForSports, type FamilyDocument } from '@poolse/rules';
import { withOrg } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { clubToday } from '../common/club-day.js';
import { readDocuments } from './documents.repository.js';
import { listExams } from './medical-exams.repository.js';

/**
 * A child's papers as a family sees them — POOLSE-179. A status per document and
 * whether the club's form can be printed: never a number, a file or who filed
 * it, so a family learns what is missing and reads nothing the office holds.
 */
export interface FamilyDocumentRow {
  kind: FamilyDocument;
  status: 'missing' | 'ok' | 'expired';
  /** `YYYY-MM-DD`, for a paper that lapses. */
  validUntil: string | null;
  /** What the form prints from, when it is a form the club has set up. */
  print: { path: 'boletim' | 'fpn'; seasonId: string | null; minor: boolean } | null;
  /** A form the club prints, and the club has not set it up. */
  notConfigured: boolean;
}

/** The sports of a student's active turmas, by each turma's recinto. */
async function sportsOf(organizationId: string, studentId: string): Promise<string[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ sport: string }>(
      `SELECT DISTINCT coalesce(pa.sport_id, 'pool') AS sport
         FROM enrollment e
         JOIN class_group g
           ON g.id = e.class_group_id AND g.organization_id = e.organization_id AND g.archived_at IS NULL
         LEFT JOIN playing_area pa
           ON pa.id = g.playing_area_id AND pa.organization_id = g.organization_id
        WHERE e.student_id = $1 AND e.status = 'active'`,
      [studentId],
    );
    return rows.map((row) => row.sport);
  });
}

/** Null when the student is not this club's. */
export async function familyDocuments(
  organizationId: string,
  studentId: string,
): Promise<FamilyDocumentRow[] | null> {
  const held = await readDocuments(organizationId, studentId);
  if (held === null) return null;
  const today = clubToday();
  const live = held.copies.filter((copy) => copy.replacedAt === null);
  const season = held.seasons.find((one) => one.published)?.id ?? null;
  // No birth date is the guardian path: never a guess at adult.
  const minor = held.minor !== false;

  const row = (kind: FamilyDocument): FamilyDocumentRow => {
    if (kind === 'fpn_declaration') {
      const form = minor ? 'fpn_declaration_minor' : 'fpn_declaration';
      const filed = live.some((copy) => copy.kind === form && copy.seasonId === season);
      return {
        kind,
        status: filed ? 'ok' : 'missing',
        validUntil: null,
        print: held.templates[form] ? { path: 'fpn', seasonId: season, minor } : null,
        notConfigured: !held.templates[form],
      };
    }
    if (kind === 'socio_form') {
      return {
        kind,
        status: live.some((copy) => copy.kind === 'socio_form') ? 'ok' : 'missing',
        validUntil: null,
        print: held.templates.socio_form ? { path: 'boletim', seasonId: null, minor } : null,
        notConfigured: !held.templates.socio_form,
      };
    }
    // id_document; the exam's status is added by the caller.
    const until = held.idDocument.validUntil;
    const known = held.idDocument.hasNumber || live.some((copy) => copy.kind === 'id_document');
    return {
      kind,
      status: !known ? 'missing' : until !== null && until < today ? 'expired' : 'ok',
      validUntil: until,
      print: null,
      notConfigured: false,
    };
  };

  // `false`: the note and the file are the office's. The result stays there too.
  const exams = await listExams(organizationId, studentId, false);
  return documentsForSports(await sportsOf(organizationId, studentId)).map((kind) => {
    if (kind !== 'medical_exam') return row(kind);
    return {
      kind,
      status: exams === null || exams.state === 'none' ? 'missing' : exams.state === 'valid' ? 'ok' : 'expired',
      validUntil: exams?.current?.validUntil ?? null,
      print: null,
      notConfigured: false,
    };
  });
}

/** A family printing a form is on the student's record: who, which, when. */
export async function recordFamilyPrint(
  organizationId: string,
  studentId: string,
  kind: 'boletim' | 'fpn',
): Promise<void> {
  await withOrg(organizationId, (tx) =>
    recordAudit(tx, {
      action: 'student.document_printed',
      entityType: 'student',
      entityId: studentId,
      data: { kind },
    }),
  );
}
