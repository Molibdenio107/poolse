import { documentsForSports, type FamilyDocument } from '@poolse/rules';
import { withOrg } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { clubToday } from '../common/club-day.js';
import { fpnPrint, readDocuments } from './documents.repository.js';
import { listExams } from './medical-exams.repository.js';
import { maySendFor, pendingKinds } from './family-submissions.repository.js';

/**
 * A child's papers as a family sees them — POOLSE-179. A status per document and
 * whether the club's form can be printed: never a number, a file or who filed
 * it, so a family learns what is missing and reads nothing the office holds.
 */
export interface FamilyDocumentRow {
  kind: FamilyDocument;
  /** `sent`: the family sent one and the office has not decided yet (POOLSE-179 slice 2). */
  status: 'missing' | 'ok' | 'expired' | 'sent';
  /** `YYYY-MM-DD`, for a paper that lapses. */
  validUntil: string | null;
  /** What the form prints from, when it is a form the club has set up. */
  print: { path: 'boletim' | 'fpn'; seasonId: string | null; minor: boolean } | null;
  /** A form the club prints, and the club has not set it up. */
  notConfigured: boolean;
  /** This reader may send this kind now: a live encarregado or an adult student, nothing waiting. */
  canSend: boolean;
  /** The FPN form's mandatory fields still empty, as keys — POOLSE-193. Empty for the rest. */
  missing: string[];
  /** This reader could act on the form, and mandatory data stops them. */
  incomplete: boolean;
}

/** What the phone's review shows before the FPN form is downloaded — POOLSE-193 rule 2. */
export interface FpnReview {
  studentName: string;
  signerName: string;
  minor: boolean;
  addressLine: string | null;
  locality: string | null;
  postalCode: string | null;
  idDocumentType: string | null;
  /** In full (Rui, 06-11-2026): the form prints it, and the read is audited. */
  idDocumentNumber: string | null;
  issuedOn: string | null;
  validUntil: string | null;
  disciplines: string[];
  seasonName: string | null;
  association: string | null;
  clubCode: string | null;
  missing: string[];
  status: FamilyDocumentRow['status'];
  canSend: boolean;
  print: FamilyDocumentRow['print'];
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
  membershipId: string,
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
        canSend: false,
        missing: held.missing,
        incomplete: false,
      };
    }
    if (kind === 'socio_form') {
      return {
        kind,
        status: live.some((copy) => copy.kind === 'socio_form') ? 'ok' : 'missing',
        validUntil: null,
        print: held.templates.socio_form ? { path: 'boletim', seasonId: null, minor } : null,
        notConfigured: !held.templates.socio_form,
        canSend: false,
        missing: [],
        incomplete: false,
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
      canSend: false,
      missing: [],
      incomplete: false,
    };
  };

  // `false`: the note and the file are the office's. The result stays there too.
  const exams = await listExams(organizationId, studentId, false);
  const [pending, maySend] = await Promise.all([
    pendingKinds(organizationId, studentId),
    maySendFor(organizationId, membershipId, studentId),
  ]);
  const rows: FamilyDocumentRow[] = documentsForSports(await sportsOf(organizationId, studentId)).map((kind): FamilyDocumentRow => {
    if (kind !== 'medical_exam') return row(kind);
    return {
      kind,
      status: exams === null || exams.state === 'none' ? 'missing' : exams.state === 'valid' ? 'ok' : 'expired',
      validUntil: exams?.current?.validUntil ?? null,
      print: null,
      notConfigured: false,
      canSend: false,
      missing: [],
      incomplete: false,
    };
  });

  // POOLSE-179 slice 2: something sent and waiting reads as such, and is not
  // sent twice. The office's own status wins only once it has decided.
  return rows.map((one): FamilyDocumentRow => {
    const waiting =
      one.kind === 'fpn_declaration'
        ? pending.has('fpn_declaration') || pending.has('fpn_declaration_minor')
        : pending.has(one.kind);
    const incomplete = maySend && !waiting && one.missing.length > 0;
    return {
      ...one,
      status: waiting ? 'sent' : one.status,
      // The boletim is only ever downloaded (Rui, 06-11-2026).
      canSend: maySend && !waiting && one.kind !== 'socio_form' && !incomplete,
      incomplete,
      // A minor's own login reads the FPN form's state and does not take it (POOLSE-193 rule 1).
      print: one.kind === 'fpn_declaration' && !maySend ? null : one.print,
    };
  });
}

/**
 * The FPN form's values for the person who will sign it — POOLSE-193. Null when
 * the student is not this club's. The caller has already asked `maySendFor`.
 */
export async function familyFpnReview(
  organizationId: string,
  studentId: string,
  membershipId: string,
): Promise<FpnReview | null> {
  const rows = await familyDocuments(organizationId, studentId, membershipId);
  const row = rows?.find((one) => one.kind === 'fpn_declaration');
  if (row === undefined) return null;
  const held = await readDocuments(organizationId, studentId);
  if (held === null) return null;
  const season = held.seasons.find((one) => one.published)?.id ?? null;
  // Reads the ID number, and `fpnPrint` audits that.
  const form = await fpnPrint(organizationId, studentId, season, held.minor !== false);
  if (form === null) return null;
  return {
    studentName: form.studentName,
    signerName: form.signerName,
    minor: form.minor,
    addressLine: form.addressLine,
    locality: form.locality,
    postalCode: form.postalCode,
    idDocumentType: form.idDocumentType,
    idDocumentNumber: form.idDocumentNumber,
    issuedOn: form.issuedOn,
    validUntil: form.validUntil,
    disciplines: form.disciplines,
    seasonName: form.seasonName,
    association: form.association,
    clubCode: form.clubCode,
    missing: row.missing,
    status: row.status,
    canSend: row.canSend,
    print: row.print,
    notConfigured: row.notConfigured,
  };
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
