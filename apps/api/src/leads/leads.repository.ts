import { withOrg, withoutTenantScope, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { enrollmentRefusal, insertEnrollment } from '../classes/classes.repository.js';
import { insertStudent, type StudentInput } from '../students/students.repository.js';

/**
 * Online pre-registration — POOLSE-69.
 *
 * Two halves. The public half is two definer functions keyed on the club's slug
 * (`public_lead_form`, `submit_lead`) and nothing else: no tenant is ever looked
 * up here and then entered. The staff half is ordinary tenant code, and its
 * conversions write the student and the enrolment through the same functions the
 * student form and the turma roster use, in one transaction.
 */

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

export interface PublicLeadForm {
  clubName: string;
  facilities: { id: string; name: string }[];
  levels: { id: string; name: string }[];
}

interface RawForm {
  clubName: string;
  facilities: { id: string; name: string }[];
  levels: { id: string; name: string }[];
}

/** An open club's form, or null for every other slug. Built field by field. */
export async function readLeadForm(slug: string): Promise<PublicLeadForm | null> {
  const raw = await withoutTenantScope(async (tx) => {
    const { rows } = await tx.query<{ form: RawForm | null }>(
      'SELECT public_lead_form($1) AS form',
      [slug],
    );
    return rows[0]?.form ?? null;
  });
  if (raw === null) return null;
  return {
    clubName: raw.clubName,
    facilities: raw.facilities.map((f) => ({ id: f.id, name: f.name })),
    levels: raw.levels.map((l) => ({ id: l.id, name: l.name })),
  };
}

/** What the public form posts, already shape-checked by the controller. */
export interface LeadSubmission {
  swimmerFirstName: string;
  swimmerLastName: string;
  swimmerBirthDate: string;
  swimmerTaxNumber: string | null;
  guardianName: string | null;
  guardianRelationship: string | null;
  guardianTaxNumber: string | null;
  email: string;
  phone: string | null;
  note: string | null;
  facilityId: string | null;
  levelId: string | null;
  preferredDays: number[];
  locale: 'pt-PT' | 'en';
  consentTextVersion: string;
}

/**
 * Hands a submission to `submit_lead`, which writes it or does not. Nothing it
 * returns or throws reaches the caller's answer — the controller says the same
 * sentence either way — so a failure here is only for the log.
 */
export async function submitLead(slug: string, lead: LeadSubmission): Promise<void> {
  await withoutTenantScope(async (tx) => {
    await tx.query('SELECT submit_lead($1, $2::jsonb)', [slug, JSON.stringify(lead)]);
  });
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

export type LeadStatus = 'new' | 'waitlisted' | 'trial_booked' | 'converted' | 'dismissed';

export interface Lead {
  id: string;
  status: LeadStatus;
  createdAt: string;
  swimmerFirstName: string;
  swimmerLastName: string;
  swimmerBirthDate: string;
  swimmerTaxNumber: string | null;
  guardianName: string | null;
  guardianRelationship: string | null;
  guardianTaxNumber: string | null;
  email: string;
  phone: string | null;
  note: string | null;
  locale: string;
  preferredDays: number[];
  facilityId: string | null;
  facilityName: string | null;
  levelId: string | null;
  levelName: string | null;
  consentTextVersion: string;
  consentedAt: string;
  dismissedReason: string | null;
  studentId: string | null;
  trialSessionId: string | null;
  trialStartsAt: string | null;
  trialGroupName: string | null;
  trialTimezone: string | null;
  decidedAt: string | null;
}

interface LeadRow {
  id: string;
  status: LeadStatus;
  created_at: Date;
  swimmer_first_name: string;
  swimmer_last_name: string;
  swimmer_birth_date: string;
  swimmer_tax_number: string | null;
  guardian_name: string | null;
  guardian_relationship: string | null;
  guardian_tax_number: string | null;
  email: string;
  phone: string | null;
  note: string | null;
  locale: string;
  preferred_days: number[];
  facility_id: string | null;
  facility_name: string | null;
  level_id: string | null;
  level_name: string | null;
  consent_text_version: string;
  consented_at: Date;
  dismissed_reason: string | null;
  student_id: string | null;
  trial_session_id: string | null;
  trial_starts_at: Date | null;
  trial_group_name: string | null;
  trial_timezone: string | null;
  decided_at: Date | null;
}

/*
 * `swimmer_birth_date::text` so a date stays a day (never a UTC instant), and
 * every join LEFT — a lead with no preference, or a trial whose turma was
 * archived since, is still a lead.
 */
const LEAD_SELECT = `
  SELECT l.id, l.status::text AS status, l.created_at,
         l.swimmer_first_name, l.swimmer_last_name,
         l.swimmer_birth_date::text AS swimmer_birth_date, l.swimmer_tax_number,
         l.guardian_name, l.guardian_relationship, l.guardian_tax_number,
         l.email::text AS email, l.phone, l.note, l.locale,
         l.preferred_days::int[] AS preferred_days,
         l.facility_id, f.name AS facility_name,
         l.level_id, sl.name AS level_name,
         l.consent_text_version, l.consented_at, l.dismissed_reason,
         l.student_id, l.trial_session_id,
         cs.starts_at AS trial_starts_at, cg.name AS trial_group_name,
         tf.timezone AS trial_timezone,
         l.decided_at
    FROM lead l
    LEFT JOIN facility f
      ON f.id = l.facility_id AND f.organization_id = l.organization_id
    LEFT JOIN student_level sl
      ON sl.id = l.level_id AND sl.organization_id = l.organization_id
    LEFT JOIN class_session cs
      ON cs.id = l.trial_session_id AND cs.organization_id = l.organization_id
    LEFT JOIN class_group cg
      ON cg.id = cs.class_group_id AND cg.organization_id = cs.organization_id
    LEFT JOIN facility tf
      ON tf.id = cg.facility_id AND tf.organization_id = cg.organization_id`;

function toLead(row: LeadRow): Lead {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    swimmerFirstName: row.swimmer_first_name,
    swimmerLastName: row.swimmer_last_name,
    swimmerBirthDate: row.swimmer_birth_date,
    swimmerTaxNumber: row.swimmer_tax_number,
    guardianName: row.guardian_name,
    guardianRelationship: row.guardian_relationship,
    guardianTaxNumber: row.guardian_tax_number,
    email: row.email,
    phone: row.phone,
    note: row.note,
    locale: row.locale,
    preferredDays: row.preferred_days,
    facilityId: row.facility_id,
    facilityName: row.facility_name,
    levelId: row.level_id,
    levelName: row.level_name,
    consentTextVersion: row.consent_text_version,
    consentedAt: row.consented_at.toISOString(),
    dismissedReason: row.dismissed_reason,
    studentId: row.student_id,
    trialSessionId: row.trial_session_id,
    trialStartsAt: row.trial_starts_at?.toISOString() ?? null,
    trialGroupName: row.trial_group_name,
    trialTimezone: row.trial_timezone,
    decidedAt: row.decided_at?.toISOString() ?? null,
  };
}

/** `open` is the queue to work (new, trial booked); `done` is the rest. */
export type LeadView = 'open' | 'done';

export async function listLeads(organizationId: string, view: LeadView): Promise<Lead[]> {
  const statuses = view === 'open' ? ['new', 'trial_booked'] : ['waitlisted', 'converted', 'dismissed'];
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<LeadRow>(
      `${LEAD_SELECT}
        WHERE l.archived_at IS NULL AND l.status::text = ANY($1::text[])
        ORDER BY l.created_at DESC
        LIMIT 500`,
      [statuses],
    );
    return rows.map(toLead);
  });
}

export async function readLead(organizationId: string, leadId: string): Promise<Lead | null> {
  return withOrg(organizationId, (tx) => leadById(tx, leadId));
}

async function leadById(tx: Tx, leadId: string, lock = false): Promise<Lead | null> {
  if (lock) {
    await tx.query('SELECT 1 FROM lead WHERE id = $1 AND archived_at IS NULL FOR UPDATE', [leadId]);
  }
  const { rows } = await tx.query<LeadRow>(
    `${LEAD_SELECT} WHERE l.id = $1 AND l.archived_at IS NULL`,
    [leadId],
  );
  return rows[0] ? toLead(rows[0]) : null;
}

/** The queue's count of leads still to answer, for the menu and the card. */
export async function countOpenLeads(organizationId: string): Promise<number> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM lead
        WHERE archived_at IS NULL AND status IN ('new', 'trial_booked')`,
    );
    return rows[0]?.n ?? 0;
  });
}

// ---------------------------------------------------------------------------
// The four actions
// ---------------------------------------------------------------------------

/** Only a lead nobody has placed or turned away can be acted on. */
const OPEN: readonly LeadStatus[] = ['new', 'trial_booked'];

export class LeadNotOpenError extends Error {
  constructor(readonly status: LeadStatus) {
    super(`lead is ${status}`);
  }
}
export class TrialFullError extends Error {
  constructor(
    readonly capacity: number,
    readonly taken: number,
  ) {
    super('occurrence is full');
  }
}
export class TrialUnavailableError extends Error {}

/**
 * The student the lead describes, as the student form would post it.
 *
 * The caller runs this through `parseStudent`, so the guardian rule, the NIF
 * checksum and "one NIF, one person" are the form's own. A minor's contact is
 * the guardian's; an adult's is their own. The free-text note is not copied:
 * a parent writes "he has asthma" in it, and a student's notes are not the
 * sensitive-fields path.
 */
export function studentBodyFor(lead: Lead): Record<string, unknown> {
  const hasGuardian = lead.guardianName !== null;
  return {
    firstName: lead.swimmerFirstName,
    lastName: lead.swimmerLastName,
    birthDate: lead.swimmerBirthDate,
    levelId: lead.levelId,
    taxNumber: lead.swimmerTaxNumber,
    contactEmail: hasGuardian ? null : lead.email,
    contactPhone: hasGuardian ? null : lead.phone,
    ...(hasGuardian
      ? {
          guardianName: lead.guardianName,
          guardianRelationship: lead.guardianRelationship,
          guardianEmail: lead.email,
          guardianPhone: lead.phone,
          guardianTaxNumber: lead.guardianTaxNumber,
        }
      : {}),
  };
}

export type PlaceOutcome =
  | { ok: true; studentId: string; attached: boolean }
  | { ok: false; reason: 'not_found' | 'group_not_found' };

/**
 * Waitlists or enrols a lead — one transaction, one insert path each.
 *
 * **A NIF that is already a student's attaches to that student** (QA 4): the
 * lead becomes the person the club already has, never a second one. Otherwise
 * `insertStudent` writes them, and its guardian sync matches the parent on
 * NIF-else-email exactly as the form does. Then `insertEnrollment`, whose
 * capacity trigger is the guarantee; a full turma rolls the student back with
 * it, so pressing the button again cannot make a twin.
 */
export async function placeLead(
  organizationId: string,
  leadId: string,
  groupId: string,
  input: StudentInput,
  waiting: boolean,
  actorMembershipId: string,
): Promise<PlaceOutcome> {
  try {
    return await withOrg(organizationId, async (tx) => {
      const lead = await leadById(tx, leadId, true);
      if (lead === null) return { ok: false, reason: 'not_found' } as const;
      if (!OPEN.includes(lead.status)) throw new LeadNotOpenError(lead.status);

      let studentId: string | null = null;
      let attached = false;
      if (input.taxNumber !== null) {
        const { rows } = await tx.query<{ id: string }>(
          `SELECT id FROM student
            WHERE tax_number = $1 AND archived_at IS NULL`,
          [input.taxNumber],
        );
        if (rows[0]) {
          studentId = rows[0].id;
          attached = true;
        }
      }
      if (studentId === null) {
        // A level archived since the form was filled is no preference, not a refusal.
        const level = input.levelId === null ? null : await tx.query(
          'SELECT 1 FROM student_level WHERE id = $1 AND archived_at IS NULL',
          [input.levelId],
        );
        const levelId = level !== null && level.rows.length > 0 ? input.levelId : null;
        studentId = await insertStudent(tx, organizationId, { ...input, levelId });
        if (studentId === null) return { ok: false, reason: 'not_found' } as const;
      }

      const placed = await insertEnrollment(tx, organizationId, groupId, studentId, waiting);
      if (placed === 'not_found') {
        // Nothing may survive a refusal — the student was written in this transaction.
        throw new GroupGone();
      }

      await tx.query(
        `UPDATE lead
            SET status = $2::lead_status, student_id = $3,
                decided_by_membership_id = $4, decided_at = now()
          WHERE id = $1`,
        [leadId, waiting ? 'waitlisted' : 'converted', studentId, actorMembershipId],
      );
      await recordAudit(tx, {
        action: waiting ? 'lead.waitlisted' : 'lead.converted',
        entityType: 'lead',
        entityId: leadId,
        data: { studentId, classGroupId: groupId, attached },
      });
      return { ok: true, studentId, attached } as const;
    });
  } catch (error) {
    if (error instanceof GroupGone) return { ok: false, reason: 'group_not_found' };
    throw enrollmentRefusal(error, groupId, leadId);
  }
}

class GroupGone extends Error {}

/**
 * Books an aula experimental, or moves one to another date.
 *
 * The seat is the trigger's to grant — `lead_trial_capacity` locks the
 * occurrence and reads `session_free_seats()` — so this only translates its
 * answer. A session id that is not this club's fails the composite key.
 */
export async function bookTrial(
  organizationId: string,
  leadId: string,
  sessionId: string,
  actorMembershipId: string,
): Promise<'booked' | 'not_found'> {
  try {
    return await withOrg(organizationId, async (tx) => {
      const lead = await leadById(tx, leadId, true);
      if (lead === null) return 'not_found';
      if (!OPEN.includes(lead.status)) throw new LeadNotOpenError(lead.status);

      await tx.query(
        `UPDATE lead
            SET status = 'trial_booked', trial_session_id = $2,
                decided_by_membership_id = $3, decided_at = now()
          WHERE id = $1`,
        [leadId, sessionId, actorMembershipId],
      );
      await recordAudit(tx, {
        action: 'lead.trial_booked',
        entityType: 'lead',
        entityId: leadId,
        data: { classSessionId: sessionId },
      });
      return 'booked';
    });
  } catch (error) {
    const pg = error as { code?: string; detail?: string };
    if (pg.code === '23503') return 'not_found';
    if (pg.code === '23514' && typeof pg.detail === 'string') {
      const [tag, capacity, taken] = pg.detail.split('|');
      if (tag === 'trial_capacity') throw new TrialFullError(Number(capacity), Number(taken));
      if (tag === 'trial_session_unavailable') throw new TrialUnavailableError();
    }
    throw error;
  }
}

export async function dismissLead(
  organizationId: string,
  leadId: string,
  reason: string,
  actorMembershipId: string,
): Promise<'dismissed' | 'not_found'> {
  return withOrg(organizationId, async (tx) => {
    const lead = await leadById(tx, leadId, true);
    if (lead === null) return 'not_found';
    if (!OPEN.includes(lead.status)) throw new LeadNotOpenError(lead.status);

    // A dismissed lead's trial no longer holds a seat: the status leaves
    // trial_booked, which is what session_free_seats() counts.
    await tx.query(
      `UPDATE lead
          SET status = 'dismissed', dismissed_reason = $2,
              decided_by_membership_id = $3, decided_at = now()
        WHERE id = $1`,
      [leadId, reason, actorMembershipId],
    );
    await recordAudit(tx, {
      action: 'lead.dismissed',
      entityType: 'lead',
      entityId: leadId,
      data: {},
    });
    return 'dismissed';
  });
}

export interface TrialOption {
  sessionId: string;
  startsAt: string;
  timezone: string;
  /** Null when the turma has no recorded capacity: not measured, not zero. */
  freeSeats: number | null;
}

/**
 * The next four weeks of one turma, for choosing a trial date. Full ones are
 * listed with zero rather than hidden, so "why is Tuesday not offered" has its
 * answer on the screen.
 */
export async function trialOptions(
  organizationId: string,
  groupId: string,
): Promise<TrialOption[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      starts_at: Date;
      timezone: string;
      free: number | null;
    }>(
      `SELECT cs.id, cs.starts_at, f.timezone, session_free_seats(cs.id) AS free
         FROM class_session cs
         JOIN class_group cg
           ON cg.id = cs.class_group_id AND cg.organization_id = cs.organization_id
         JOIN facility f
           ON f.id = cg.facility_id AND f.organization_id = cg.organization_id
        WHERE cs.class_group_id = $1
          AND cg.archived_at IS NULL
          AND cs.status <> 'cancelled'
          AND cs.starts_at > now()
          AND cs.starts_at < now() + interval '28 days'
        ORDER BY cs.starts_at
        LIMIT 40`,
      [groupId],
    );
    return rows.map((row) => ({
      sessionId: row.id,
      startsAt: row.starts_at.toISOString(),
      timezone: row.timezone,
      freeSeats: row.free === null ? null : Math.max(0, row.free),
    }));
  });
}

// ---------------------------------------------------------------------------
// The club's switch and its slug
// ---------------------------------------------------------------------------

export interface RegistrationSettings {
  slug: string;
  open: boolean;
}

export class SlugTakenError extends Error {}

export async function readRegistrationSettings(
  organizationId: string,
): Promise<RegistrationSettings> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ slug: string; open: boolean }>(
      `SELECT slug, public_registration_open AS open FROM organization WHERE id = $1`,
      [organizationId],
    );
    const row = rows[0]!;
    return { slug: row.slug, open: row.open };
  });
}

export async function updateRegistrationSettings(
  organizationId: string,
  settings: RegistrationSettings,
): Promise<RegistrationSettings> {
  try {
    return await withOrg(organizationId, async (tx) => {
      const { rows: before } = await tx.query<{ slug: string; open: boolean }>(
        `SELECT slug, public_registration_open AS open FROM organization WHERE id = $1 FOR UPDATE`,
        [organizationId],
      );
      await tx.query(
        `UPDATE organization SET slug = $2, public_registration_open = $3 WHERE id = $1`,
        [organizationId, settings.slug, settings.open],
      );
      await recordAudit(tx, {
        action: 'organization.registration_updated',
        entityType: 'organization',
        entityId: organizationId,
        data: { before: before[0], after: settings },
      });
      return settings;
    });
  } catch (error) {
    const pg = error as { code?: string; constraint?: string };
    if (pg.code === '23505' && pg.constraint === 'organization_slug_uq') throw new SlugTakenError();
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

/** The club's unconverted leads past `lead_retention()`, archived. Never deleted. */
export async function archiveStaleLeads(organizationId: string): Promise<number> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ n: number }>('SELECT archive_stale_leads() AS n');
    return rows[0]?.n ?? 0;
  });
}
