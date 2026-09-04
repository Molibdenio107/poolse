import { withOrg, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { TOTAL_COUNT, windowed, type Paginated, type PageQuery } from '../common/pagination.js';
import {
  previewPartners,
  type ExistingPartner,
  type PartnerGroupTree,
  type PartnerImportContext,
  type PartnerImportRow,
  type PartnerSummary,
  type RawPartnerRow,
} from './partner-import.js';

/**
 * Parcerias — POOLSE-47.
 *
 * A municipal pool sells most of its water in blocks to organisations rather
 * than to families, and until this existed Poolse showed a club an empty morning
 * where in fact a school had booked every lane. This is the table behind the
 * partner tab, and `partner_group` is the thing that will land on the grid —
 * `ES D. Dinis` never does; `6A` does.
 *
 * **The derived columns are computed in SQL.** Horas/semana and pistas·hora over
 * a page of partners is the exact shape the conventions call out: filtering or
 * summing in JavaScript after the window gives page 2 fewer rows than page 1 and
 * a total counting rows the reader cannot see. `listPartners` does all of it in
 * one statement, and `packages/db/test/parcerias.sql` test 10 holds the
 * arithmetic still.
 */

export const PARTNER_TYPES = [
  'escola',
  'agrupamento',
  'ipss_misericordia',
  'jardim_infancia',
  'clube',
  'camara',
  'empresa',
  'outro',
] as const;

export type PartnerType = (typeof PARTNER_TYPES)[number];

export const PARTNER_STATUSES = ['ativa', 'inativa'] as const;
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];

export const BILLING_MODELS = [
  'por_hora_pista',
  'por_bloco',
  'por_participante',
  'mensal_fixo',
] as const;

export type BillingModel = (typeof BILLING_MODELS)[number];

export function isPartnerType(value: unknown): value is PartnerType {
  return typeof value === 'string' && (PARTNER_TYPES as readonly string[]).includes(value);
}

export function isPartnerStatus(value: unknown): value is PartnerStatus {
  return typeof value === 'string' && (PARTNER_STATUSES as readonly string[]).includes(value);
}

export function isBillingModel(value: unknown): value is BillingModel {
  return typeof value === 'string' && (BILLING_MODELS as readonly string[]).includes(value);
}

/** One row of the partner list, derived columns and all — criterion 8. */
export interface PartnerRow {
  id: string;
  name: string;
  type: PartnerType;
  status: PartnerStatus;
  color: string;
  groupCount: number;
  /** Contracted hours a week in the published season. Zero, never null — QA 47.6. */
  weeklyHours: number;
  /** Lane-hours a week: the same hours, multiplied by how many lanes each takes. */
  weeklyLaneHours: number;
  /**
   * What the agreement contracts for, in integer minor units.
   *
   * A total *is* money and is therefore cents, even though the `unit_price` it
   * came from is not. The rounding happens once, here, at the end — which is the
   * whole reason the unit price is `numeric(12,6)`.
   */
  contractedCents: number | null;
  billingModel: BillingModel | null;
}

export interface PartnerContact {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
}

export interface PartnerAgreement {
  id: string;
  seasonId: string | null;
  startDate: string;
  endDate: string | null;
  billingModel: BillingModel;
  /** A decimal string, never a JS number — see `readNumeric`. */
  unitPrice: string;
  /** Null means isento. Not "unknown". */
  vatRate: string | null;
  paymentPeriod: string | null;
  notes: string | null;
  /** Always null until file storage lands. The control is disabled, not hidden. */
  documentKey: string | null;
}

export interface PartnerGroup {
  id: string;
  name: string;
  participantCount: number;
  levelId: string | null;
  levelName: string | null;
  bringsOwnInstructor: boolean;
  ownInstructorName: string | null;
  tag: string | null;
  notes: string | null;
}

/** One booking of this partner's, for the read-only Horário panel — criterion 9. */
export interface PartnerBooking {
  id: string;
  groupName: string;
  /** ISO weekday, Monday 1 … Sunday 7. */
  weekday: number;
  startTime: string;
  durationMinutes: number;
  poolName: string | null;
  laneNames: string[];
}

export interface PartnerDetail {
  id: string;
  facilityId: string;
  name: string;
  type: PartnerType;
  status: PartnerStatus;
  color: string;
  nif: string | null;
  address: string | null;
  notes: string | null;
  contacts: PartnerContact[];
  agreement: PartnerAgreement | null;
  groups: PartnerGroup[];
  bookings: PartnerBooking[];
}

export interface PartnerInput {
  name: string;
  type: PartnerType;
  status: PartnerStatus;
  color: string;
  nif: string | null;
  address: string | null;
  notes: string | null;
}

export interface ContactInput {
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
}

export interface AgreementInput {
  seasonId: string | null;
  startDate: string;
  endDate: string | null;
  billingModel: BillingModel;
  unitPrice: string;
  vatRate: string | null;
  paymentPeriod: string | null;
  notes: string | null;
}

export interface GroupInput {
  name: string;
  participantCount: number;
  levelId: string | null;
  bringsOwnInstructor: boolean;
  ownInstructorName: string | null;
  tag: string | null;
  notes: string | null;
}

/** Raised when a name collides with one already at this facility, or in this partner. */
export class DuplicateNameError extends Error {
  constructor(override readonly name: string) {
    super('duplicate name');
  }
}

/** Raised when a partner cannot be archived because its groups are still booked. */
export class PartnerInUseError extends Error {
  constructor(readonly bookings: number) {
    super('partner in use');
  }
}

/**
 * 23505 is a unique violation, which here can only be a name collision: the two
 * partial indexes on `lower(strip_accents(name))` are the only unique
 * constraints either table carries beyond its primary key.
 */
function asDuplicate<T>(error: unknown, name: string): T {
  if (error instanceof Error && (error as { code?: string }).code === '23505') {
    throw new DuplicateNameError(name);
  }
  throw error;
}

/**
 * A `numeric` from Postgres, kept as the string it arrives as.
 *
 * `pg` hands `numeric` back as a string precisely because it does not fit a
 * float, and this is the module where that matters most — `14.375` through
 * `Number()` and back is the rounding the column type exists to prevent.
 * Nothing here parses one; it travels to the browser as a decimal string and is
 * formatted for display there.
 */
function readNumeric(raw: string | null): string | null {
  return raw;
}

/**
 * The season the list is read against.
 *
 * The published one — criterion 8 says the derived columns are computed over it,
 * and a draft is a plan nobody has committed to. A club with no published season
 * gets null, and every derived column reads zero rather than the endpoint
 * failing: an empty answer is correct there, not an error.
 */
async function publishedSeason(tx: Tx): Promise<string | null> {
  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM season WHERE status = 'published' LIMIT 1`,
  );
  return rows[0]?.id ?? null;
}

/**
 * A facility's partners, one page, with everything the list column headers ask
 * for computed in the same statement — criterion 8.
 *
 * The two `LEFT JOIN LATERAL` blocks are the shape that matters. An ordinary
 * join to bookings would multiply a partner's row by its bookings and turn
 * `count(groups)` into nonsense; aggregating in subqueries keeps one row per
 * partner and lets the window function count partners rather than join output.
 *
 * `archived` partners are absent. `inativa` ones are present — criterion 7 says
 * an inactive partnership keeps its history and only disappears from the
 * pickers, which is the caller's filter to apply, not this one's.
 */
export async function listPartners(
  organizationId: string,
  facilityId: string,
  page: PageQuery,
): Promise<Paginated<PartnerRow>> {
  return withOrg(organizationId, async (tx) => {
    const season = await publishedSeason(tx);

    return windowed(
      page,
      (limit, offset) =>
        tx.query<{
          id: string;
          name: string;
          type: PartnerType;
          status: PartnerStatus;
          color: string;
          group_count: number;
          weekly_minutes: number;
          weekly_lane_minutes: number;
          contracted_cents: number | null;
          billing_model: BillingModel | null;
          total_count: number;
        }>(
          `SELECT p.id,
                  p.name,
                  p.type,
                  p.status,
                  p.color,
                  coalesce(g.group_count, 0)::int         AS group_count,
                  coalesce(b.weekly_minutes, 0)::int      AS weekly_minutes,
                  coalesce(b.weekly_lane_minutes, 0)::int AS weekly_lane_minutes,
                  a.contracted_cents,
                  a.billing_model,
                  ${TOTAL_COUNT}
             FROM partner p
             LEFT JOIN LATERAL (
               SELECT count(*)::int AS group_count
                 FROM partner_group pg
                WHERE pg.partner_id = p.id
                  AND pg.organization_id = p.organization_id
                  AND pg.archived_at IS NULL
             ) g ON true
             LEFT JOIN LATERAL (
               SELECT sum(cs.duration_minutes)::int AS weekly_minutes,
                      sum(cs.duration_minutes * coalesce(l.lanes, 1))::int
                        AS weekly_lane_minutes
                 FROM partner_group pg
                 JOIN class_schedule cs
                   ON cs.partner_group_id = pg.id
                  AND cs.organization_id = pg.organization_id
                  AND cs.archived_at IS NULL
                  AND cs.season_id = $2::uuid
                 LEFT JOIN LATERAL (
                   SELECT count(*)::int AS lanes
                     FROM booking_lane bl
                    WHERE bl.schedule_id = cs.id
                      AND bl.organization_id = cs.organization_id
                 ) l ON true
                WHERE pg.partner_id = p.id
                  AND pg.organization_id = p.organization_id
                  AND pg.archived_at IS NULL
             ) b ON true
             /*
              * The agreement in force, which is the most recently started one
              * that has not ended. ORDER BY start_date DESC LIMIT 1 rather
              * than a "current" flag: a flag is a second answer that somebody
              * has to remember to move, and the dates already say it.
              */
             LEFT JOIN LATERAL (
               SELECT round(pa.unit_price * 100)::int AS contracted_cents,
                      pa.billing_model
                 FROM partner_agreement pa
                WHERE pa.partner_id = p.id
                  AND pa.organization_id = p.organization_id
                  AND pa.archived_at IS NULL
                  AND pa.start_date <= current_date
                  AND (pa.end_date IS NULL OR pa.end_date >= current_date)
                ORDER BY pa.start_date DESC
                LIMIT 1
             ) a ON true
            WHERE p.facility_id = $1 AND p.archived_at IS NULL
            ORDER BY p.name
            LIMIT $3 OFFSET $4`,
          [facilityId, season, limit, offset],
        ),
      (row) => ({
        id: row.id,
        name: row.name,
        type: row.type,
        status: row.status,
        color: row.color,
        groupCount: row.group_count,
        // Minutes come out of SQL and become hours here, which is display
        // arithmetic on an integer and cannot lose anything. The *money* is
        // rounded in SQL, where the numeric still has its six decimal places.
        weeklyHours: row.weekly_minutes / 60,
        weeklyLaneHours: row.weekly_lane_minutes / 60,
        contractedCents: row.contracted_cents,
        billingModel: row.billing_model,
      }),
    );
  });
}

/**
 * The partners a picker may offer — criterion 7 and QA 47.11.
 *
 * Active only. An `inativa` partner keeps every booking it ever had, and the
 * grid still names it on last season's cells; it simply cannot be chosen for a
 * new one. That is the difference between this and `listPartners`.
 */
export async function listBookablePartners(
  organizationId: string,
  facilityId: string,
): Promise<{ id: string; name: string; color: string; groups: { id: string; name: string }[] }[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      name: string;
      color: string;
      groups: { id: string; name: string }[] | null;
    }>(
      `SELECT p.id, p.name, p.color,
              coalesce(
                jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name) ORDER BY g.name)
                  FILTER (WHERE g.id IS NOT NULL),
                '[]'::jsonb
              ) AS groups
         FROM partner p
         LEFT JOIN partner_group g
           ON g.partner_id = p.id
          AND g.organization_id = p.organization_id
          AND g.archived_at IS NULL
        WHERE p.facility_id = $1
          AND p.archived_at IS NULL
          AND p.status = 'ativa'
        GROUP BY p.id, p.name, p.color
        ORDER BY p.name`,
      [facilityId],
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      color: row.color,
      groups: row.groups ?? [],
    }));
  });
}

/**
 * One partner in full — criterion 9.
 *
 * Five reads in one transaction rather than one join: a partner has contacts,
 * one agreement, several groups and a timetable, and joining all four produces a
 * cartesian product that has to be unpicked in JavaScript. These are bounded
 * lists — a partner's groups are bounded by the partner, which is the written
 * pagination exemption — so five small statements is the cheaper and clearer
 * shape.
 */
export async function getPartner(
  organizationId: string,
  partnerId: string,
): Promise<PartnerDetail | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      facility_id: string;
      name: string;
      type: PartnerType;
      status: PartnerStatus;
      color: string;
      nif: string | null;
      address: string | null;
      notes: string | null;
    }>(
      `SELECT id, facility_id, name, type, status, color, nif, address, notes
         FROM partner
        WHERE id = $1 AND archived_at IS NULL`,
      [partnerId],
    );

    const partner = rows[0];
    if (partner === undefined) return null;

    const contacts = await tx.query<{
      id: string;
      name: string;
      role: string | null;
      email: string | null;
      phone: string | null;
    }>(
      `SELECT id, name, role, email, phone
         FROM partner_contact
        WHERE partner_id = $1 AND archived_at IS NULL
        ORDER BY name`,
      [partnerId],
    );

    const agreements = await tx.query<{
      id: string;
      season_id: string | null;
      start_date: string;
      end_date: string | null;
      billing_model: BillingModel;
      unit_price: string;
      vat_rate: string | null;
      payment_period: string | null;
      notes: string | null;
      document_key: string | null;
    }>(
      `SELECT id, season_id, start_date::text, end_date::text, billing_model,
              unit_price::text, vat_rate::text, payment_period, notes, document_key
         FROM partner_agreement
        WHERE partner_id = $1 AND archived_at IS NULL
        ORDER BY start_date DESC
        LIMIT 1`,
      [partnerId],
    );

    const groups = await tx.query<{
      id: string;
      name: string;
      participant_count: number;
      level_id: string | null;
      level_name: string | null;
      brings_own_instructor: boolean;
      own_instructor_name: string | null;
      tag: string | null;
      notes: string | null;
    }>(
      `SELECT g.id, g.name, g.participant_count, g.level_id, sl.name AS level_name,
              g.brings_own_instructor, g.own_instructor_name, g.tag, g.notes
         FROM partner_group g
         LEFT JOIN student_level sl
           ON sl.id = g.level_id AND sl.organization_id = g.organization_id
        WHERE g.partner_id = $1 AND g.archived_at IS NULL
        ORDER BY g.name`,
      [partnerId],
    );

    /*
     * The read-only Horário panel — criterion 9.
     *
     * Empty until POOLSE-49 and 50 let somebody put a group on the grid, and
     * deliberately built now: the panel is what proves the model round-trips,
     * and an empty state that says "no hours booked yet" is honest where a
     * missing panel would look like a page that had not finished loading.
     */
    const season = await publishedSeason(tx);
    const bookings = await tx.query<{
      id: string;
      group_name: string;
      weekday: number;
      start_time: string;
      duration_minutes: number;
      pool_name: string | null;
      lane_names: string[] | null;
    }>(
      `SELECT cs.id,
              g.name AS group_name,
              cs.weekday,
              cs.start_time::text,
              cs.duration_minutes,
              max(po.name) AS pool_name,
              coalesce(
                array_agg(l.name ORDER BY l.position) FILTER (WHERE l.id IS NOT NULL),
                '{}'
              ) AS lane_names
         FROM class_schedule cs
         JOIN partner_group g
           ON g.id = cs.partner_group_id AND g.organization_id = cs.organization_id
         LEFT JOIN booking_lane bl
           ON bl.schedule_id = cs.id AND bl.organization_id = cs.organization_id
         LEFT JOIN lane l ON l.id = bl.lane_id AND l.organization_id = cs.organization_id
         LEFT JOIN pool po ON po.id = l.pool_id AND po.organization_id = cs.organization_id
        WHERE g.partner_id = $1
          AND cs.archived_at IS NULL
          AND cs.season_id = $2::uuid
        GROUP BY cs.id, g.name, cs.weekday, cs.start_time, cs.duration_minutes
        ORDER BY cs.weekday, cs.start_time`,
      [partnerId, season],
    );

    const agreement = agreements.rows[0];

    return {
      id: partner.id,
      facilityId: partner.facility_id,
      name: partner.name,
      type: partner.type,
      status: partner.status,
      color: partner.color,
      nif: partner.nif,
      address: partner.address,
      notes: partner.notes,
      contacts: contacts.rows,
      agreement:
        agreement === undefined
          ? null
          : {
              id: agreement.id,
              seasonId: agreement.season_id,
              startDate: agreement.start_date,
              endDate: agreement.end_date,
              billingModel: agreement.billing_model,
              unitPrice: agreement.unit_price,
              vatRate: readNumeric(agreement.vat_rate),
              paymentPeriod: agreement.payment_period,
              notes: agreement.notes,
              documentKey: agreement.document_key,
            },
      groups: groups.rows.map((row) => ({
        id: row.id,
        name: row.name,
        participantCount: row.participant_count,
        levelId: row.level_id,
        levelName: row.level_name,
        bringsOwnInstructor: row.brings_own_instructor,
        ownInstructorName: row.own_instructor_name,
        tag: row.tag,
        notes: row.notes,
      })),
      bookings: bookings.rows.map((row) => ({
        id: row.id,
        groupName: row.group_name,
        weekday: row.weekday,
        startTime: row.start_time.slice(0, 5),
        durationMinutes: row.duration_minutes,
        poolName: row.pool_name,
        laneNames: row.lane_names ?? [],
      })),
    };
  });
}

export async function createPartner(
  organizationId: string,
  facilityId: string,
  input: PartnerInput,
): Promise<{ id: string } | null> {
  return withOrg(organizationId, async (tx) => {
    const facility = await tx.query(
      `SELECT 1 FROM facility WHERE id = $1 AND archived_at IS NULL`,
      [facilityId],
    );
    if (facility.rowCount === 0) return null;

    let id: string;
    try {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO partner
           (organization_id, facility_id, name, type, status, color, nif, address, notes)
         VALUES ($1, $2, $3, $4::partner_type, $5::partner_status, $6, $7, $8, $9)
         RETURNING id`,
        [
          organizationId,
          facilityId,
          input.name,
          input.type,
          input.status,
          input.color,
          input.nif,
          input.address,
          input.notes,
        ],
      );
      id = rows[0]!.id;
    } catch (error) {
      return asDuplicate<{ id: string }>(error, input.name);
    }

    await recordAudit(tx, {
      action: 'partner.created',
      entityType: 'partner',
      entityId: id,
      data: { name: input.name, type: input.type, facilityId },
    });

    return { id };
  });
}

export async function updatePartner(
  organizationId: string,
  partnerId: string,
  input: PartnerInput,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    try {
      const { rowCount } = await tx.query(
        `UPDATE partner
            SET name = $2, type = $3::partner_type, status = $4::partner_status,
                color = $5, nif = $6, address = $7, notes = $8
          WHERE id = $1 AND archived_at IS NULL`,
        [
          partnerId,
          input.name,
          input.type,
          input.status,
          input.color,
          input.nif,
          input.address,
          input.notes,
        ],
      );
      if (rowCount === 0) return false;
    } catch (error) {
      return asDuplicate<boolean>(error, input.name);
    }

    await recordAudit(tx, {
      action: 'partner.updated',
      entityType: 'partner',
      entityId: partnerId,
      data: { name: input.name, status: input.status },
    });

    return true;
  });
}

/**
 * Archives a partner, and refuses while its groups are still on the grid.
 *
 * Soft, as everything here is — the history is what explains last season. The
 * in-use check exists because archiving a partner whose groups are booked would
 * leave the grid drawing cells for a partner the list no longer shows, which
 * reads as corruption rather than as a decision somebody made.
 *
 * `inativa` is the answer for a partnership that has simply lapsed. This is for
 * a row that should not have existed.
 */
export async function archivePartner(
  organizationId: string,
  partnerId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ bookings: number }>(
      `SELECT count(*)::int AS bookings
         FROM class_schedule cs
         JOIN partner_group g
           ON g.id = cs.partner_group_id AND g.organization_id = cs.organization_id
        WHERE g.partner_id = $1 AND cs.archived_at IS NULL`,
      [partnerId],
    );

    const bookings = rows[0]?.bookings ?? 0;
    if (bookings > 0) throw new PartnerInUseError(bookings);

    const { rowCount } = await tx.query(
      `UPDATE partner SET archived_at = now() WHERE id = $1 AND archived_at IS NULL`,
      [partnerId],
    );
    if (rowCount === 0) return false;

    // The children go with it, so a re-added partner does not inherit a list of
    // contacts nobody expected. Archived, never deleted.
    await tx.query(
      `UPDATE partner_contact SET archived_at = now()
        WHERE partner_id = $1 AND archived_at IS NULL`,
      [partnerId],
    );
    await tx.query(
      `UPDATE partner_group SET archived_at = now()
        WHERE partner_id = $1 AND archived_at IS NULL`,
      [partnerId],
    );

    await recordAudit(tx, {
      action: 'partner.archived',
      entityType: 'partner',
      entityId: partnerId,
    });

    return true;
  });
}

/** Confirms a partner exists and is this tenant's, before writing a child row. */
async function partnerExists(tx: Tx, partnerId: string): Promise<boolean> {
  const { rowCount } = await tx.query(
    `SELECT 1 FROM partner WHERE id = $1 AND archived_at IS NULL`,
    [partnerId],
  );
  return (rowCount ?? 0) > 0;
}

export async function addContact(
  organizationId: string,
  partnerId: string,
  input: ContactInput,
): Promise<{ id: string } | null> {
  return withOrg(organizationId, async (tx) => {
    if (!(await partnerExists(tx, partnerId))) return null;

    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO partner_contact (organization_id, partner_id, name, role, email, phone)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [organizationId, partnerId, input.name, input.role, input.email, input.phone],
    );

    await recordAudit(tx, {
      action: 'partner.contact.added',
      entityType: 'partner',
      entityId: partnerId,
      data: { name: input.name },
    });

    return { id: rows[0]!.id };
  });
}

export async function removeContact(
  organizationId: string,
  contactId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE partner_contact SET archived_at = now()
        WHERE id = $1 AND archived_at IS NULL`,
      [contactId],
    );
    if (rowCount === 0) return false;

    await recordAudit(tx, {
      action: 'partner.contact.removed',
      entityType: 'partner_contact',
      entityId: contactId,
    });

    return true;
  });
}

/**
 * Records the agreement in force.
 *
 * One agreement is shown, the most recently started; a new one is a new row
 * rather than an edit, so last year's price survives to explain last year's
 * invoices. The ticket's open question — whether an agreement outlives a season
 * — is answered by `seasonId` being nullable: null means "runs until ended", and
 * the dates are the truth.
 *
 * **This issues nothing.** Open question 3, answered the ticket's recommended
 * way: the mensalidades engine bills a family a monthly plan against enrolments,
 * a partnership bills an organisation for lane-hours against a contract with a
 * NIF and its own VAT treatment. Forcing both through one engine would make the
 * student path carry a concept it does not have. So this stores the agreement
 * and computes what is contracted; POOLSE-52 exposes the numbers.
 */
export async function setAgreement(
  organizationId: string,
  partnerId: string,
  input: AgreementInput,
): Promise<{ id: string } | null> {
  return withOrg(organizationId, async (tx) => {
    if (!(await partnerExists(tx, partnerId))) return null;

    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO partner_agreement
         (organization_id, partner_id, season_id, start_date, end_date,
          billing_model, unit_price, vat_rate, payment_period, notes)
       VALUES ($1, $2, $3, $4::date, $5::date, $6::partner_billing_model,
               $7::numeric, $8::numeric, $9, $10)
       RETURNING id`,
      [
        organizationId,
        partnerId,
        input.seasonId,
        input.startDate,
        input.endDate,
        input.billingModel,
        input.unitPrice,
        input.vatRate,
        input.paymentPeriod,
        input.notes,
      ],
    );

    await recordAudit(tx, {
      action: 'partner.agreement.recorded',
      entityType: 'partner',
      entityId: partnerId,
      // The price is in the trail because "what did we agree" is exactly the
      // question somebody asks a year later, and the row may have been replaced.
      data: {
        billingModel: input.billingModel,
        unitPrice: input.unitPrice,
        vatRate: input.vatRate,
        startDate: input.startDate,
      },
    });

    return { id: rows[0]!.id };
  });
}

export async function addGroup(
  organizationId: string,
  partnerId: string,
  input: GroupInput,
): Promise<{ id: string } | null> {
  return withOrg(organizationId, async (tx) => {
    if (!(await partnerExists(tx, partnerId))) return null;

    let id: string;
    try {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO partner_group
           (organization_id, partner_id, name, participant_count, level_id,
            brings_own_instructor, own_instructor_name, tag, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          organizationId,
          partnerId,
          input.name,
          input.participantCount,
          input.levelId,
          input.bringsOwnInstructor,
          input.ownInstructorName,
          input.tag,
          input.notes,
        ],
      );
      id = rows[0]!.id;
    } catch (error) {
      return asDuplicate<{ id: string }>(error, input.name);
    }

    await recordAudit(tx, {
      action: 'partner.group.added',
      entityType: 'partner',
      entityId: partnerId,
      data: { name: input.name, participantCount: input.participantCount },
    });

    return { id };
  });
}

export async function updateGroup(
  organizationId: string,
  groupId: string,
  input: GroupInput,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    try {
      const { rowCount } = await tx.query(
        `UPDATE partner_group
            SET name = $2, participant_count = $3, level_id = $4,
                brings_own_instructor = $5, own_instructor_name = $6,
                tag = $7, notes = $8
          WHERE id = $1 AND archived_at IS NULL`,
        [
          groupId,
          input.name,
          input.participantCount,
          input.levelId,
          input.bringsOwnInstructor,
          input.ownInstructorName,
          input.tag,
          input.notes,
        ],
      );
      if (rowCount === 0) return false;
    } catch (error) {
      return asDuplicate<boolean>(error, input.name);
    }

    await recordAudit(tx, {
      action: 'partner.group.updated',
      entityType: 'partner_group',
      entityId: groupId,
      data: { name: input.name },
    });

    return true;
  });
}

/**
 * Archives a group, refusing while it is still booked.
 *
 * Same reasoning as the partner: a group that vanishes from the list while its
 * cells stay on the grid looks like data loss. Unbook it first, which is a thing
 * somebody can actually do once POOLSE-50 exists.
 */
export async function archiveGroup(organizationId: string, groupId: string): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ bookings: number }>(
      `SELECT count(*)::int AS bookings
         FROM class_schedule
        WHERE partner_group_id = $1 AND archived_at IS NULL`,
      [groupId],
    );

    const bookings = rows[0]?.bookings ?? 0;
    if (bookings > 0) throw new PartnerInUseError(bookings);

    const { rowCount } = await tx.query(
      `UPDATE partner_group SET archived_at = now() WHERE id = $1 AND archived_at IS NULL`,
      [groupId],
    );
    if (rowCount === 0) return false;

    await recordAudit(tx, {
      action: 'partner.group.archived',
      entityType: 'partner_group',
      entityId: groupId,
    });

    return true;
  });
}

/* ------------------------------------------------------- importing — POOLSE-48 */

export interface PartnerImportRequest {
  facilityId: string;
  rows: RawPartnerRow[];
  commit: boolean;
  /** Row indexes ticked on the preview. Null means "the default selection". */
  include: number[] | null;
}

export interface PartnerImportResult {
  rows: PartnerImportRow[];
  partners: PartnerGroupTree[];
  summary: PartnerSummary;
  /** Only on a commit. */
  createdPartners?: number;
  createdGroups?: number;
  updatedGroups?: number;
  skipped?: number;
}

/** The partners already at this site, with everything a row could match or change. */
async function existingPartners(tx: Tx, facilityId: string): Promise<ExistingPartner[]> {
  const { rows } = await tx.query<{
    id: string;
    name: string;
    type: string;
    groups:
      | {
          id: string;
          name: string;
          participant_count: number;
          tag: string | null;
          own_instructor_name: string | null;
          level_id: string | null;
          notes: string | null;
        }[]
      | null;
  }>(
    `SELECT p.id, p.name, p.type::text AS type,
            (SELECT json_agg(json_build_object(
                      'id', g.id,
                      'name', g.name,
                      'participant_count', g.participant_count,
                      'tag', g.tag,
                      'own_instructor_name', g.own_instructor_name,
                      'level_id', g.level_id,
                      'notes', g.notes) ORDER BY g.name)
               FROM partner_group g
              WHERE g.partner_id = p.id
                AND g.organization_id = p.organization_id
                AND g.archived_at IS NULL) AS groups
       FROM partner p
      WHERE p.facility_id = $1 AND p.archived_at IS NULL`,
    [facilityId],
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type as ExistingPartner['type'],
    groups: (row.groups ?? []).map((group) => ({
      id: group.id,
      name: group.name,
      participantCount: group.participant_count,
      tag: group.tag,
      ownInstructorName: group.own_instructor_name,
      levelId: group.level_id,
      notes: group.notes,
    })),
  }));
}

/**
 * Preview, then commit — one function called twice — POOLSE-48.
 *
 * The same arrangement the register and the inventory use, for the same reason:
 * the failure this cannot afford is an operator approving one set of rows and a
 * different set being written. `previewPartners` decides everything; this reads
 * the context, and on a commit writes exactly what the preview said.
 *
 * **One transaction for the whole file** — criterion 8. `withOrg` gives one, and
 * a partner created without the groups that justified it is worse than nothing:
 * the operator would re-import to fix it and get a second, differently-broken
 * half.
 */
export async function runPartnerImport(
  organizationId: string,
  request: PartnerImportRequest,
): Promise<PartnerImportResult | null> {
  return withOrg(organizationId, async (tx) => {
    const site = await tx.query(
      `SELECT 1 FROM facility WHERE id = $1 AND archived_at IS NULL`,
      [request.facilityId],
    );
    if (site.rowCount === 0) return null;

    const levels = await tx.query<{ id: string; name: string }>(
      `SELECT id, name FROM student_level WHERE archived_at IS NULL`,
    );

    const context: PartnerImportContext = {
      existing: await existingPartners(tx, request.facilityId),
      levels: levels.rows,
    };

    const { rows, partners, summary } = previewPartners(request.rows, context);
    if (!request.commit) return { rows, partners, summary };

    const ticked = request.include === null ? null : new Set(request.include);

    let createdPartners = 0;
    let createdGroups = 0;
    let updatedGroups = 0;
    let skipped = 0;

    /** Partner key to id, filled as partners are found or created. */
    const partnerIds = new Map<string, string>();
    for (const node of partners) {
      if (node.partnerId !== null) partnerIds.set(node.key, node.partnerId);
    }

    for (const row of rows) {
      if (!row.importable) continue;

      /*
       * The default when the client expressed no selection: create what is new,
       * leave what already exists alone. The same rule the preview ticks on
       * screen, so the two agree by construction rather than by memory —
       * criterion 5's "unticked by default", enforced on this side too.
       */
      const wanted = ticked === null ? !row.existing : ticked.has(row.index);
      if (!wanted) {
        skipped += 1;
        continue;
      }

      /*
       * The partner, once per file however many rows named it — criterion 3.
       *
       * Created lazily rather than up front, so a partnership whose every row
       * the operator unticked is never created at all. A school in the list with
       * no classes under it is a row nobody asked for.
       */
      let partnerId = partnerIds.get(row.partnerKey);
      if (partnerId === undefined) {
        const made = await tx.query<{ id: string }>(
          `INSERT INTO partner (organization_id, facility_id, name, type)
           VALUES ($1, $2, $3, $4::partner_type) RETURNING id`,
          [organizationId, request.facilityId, row.partnerName, row.partnerType],
        );
        partnerId = made.rows[0]!.id;
        partnerIds.set(row.partnerKey, partnerId);
        createdPartners += 1;

        await recordAudit(tx, {
          action: 'partner.imported',
          entityType: 'partner',
          entityId: partnerId,
          data: { name: row.partnerName, type: row.partnerType },
        });
      }

      /*
       * A contact, only where the sheet carried one and the partner has none.
       *
       * A partnerships file repeats the coordinator on every row, so inserting
       * per row would give a school twelve identical contacts. And a club that
       * has already typed one in should not have it displaced by a spreadsheet.
       *
       * `contactReachable` is the preview's answer, not a second condition:
       * `partner_contact_reachable` refuses a contact with neither an email nor
       * a telephone, and deciding that here as well as there is how the two
       * drift into a commit that 500s on a file the preview approved.
       */
      if (row.contactReachable) {
        await tx.query(
          `INSERT INTO partner_contact (organization_id, partner_id, name, email, phone)
           SELECT $1, $2, $3, $4::citext, $5
            WHERE NOT EXISTS (
              SELECT 1 FROM partner_contact
               WHERE partner_id = $2 AND organization_id = $1 AND archived_at IS NULL
            )`,
          [
            organizationId,
            partnerId,
            row.contactName ?? row.contactEmail ?? '',
            row.contactEmail,
            row.contactPhone,
          ],
        );
      }

      if (row.groupId !== null) {
        /*
         * The stocktake. Only what the sheet actually said: `coalesce` on the
         * nullable columns so a file with no Tag column does not blank a tag
         * somebody typed. Re-importing last year's list has to be harmless,
         * because it is the commonest thing a club will really do with this.
         */
        await tx.query(
          `UPDATE partner_group
              SET participant_count = $2,
                  tag = coalesce($3, tag),
                  own_instructor_name = coalesce($4, own_instructor_name),
                  brings_own_instructor = brings_own_instructor OR $4 IS NOT NULL,
                  level_id = coalesce($5, level_id),
                  notes = coalesce($6, notes)
            WHERE id = $1 AND archived_at IS NULL`,
          [
            row.groupId,
            row.participantCount,
            row.tag,
            row.ownInstructorName,
            row.levelId,
            row.notes,
          ],
        );
        updatedGroups += 1;
        continue;
      }

      await tx.query(
        `INSERT INTO partner_group
           (organization_id, partner_id, name, participant_count, level_id,
            brings_own_instructor, own_instructor_name, tag, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          organizationId,
          partnerId,
          row.groupName,
          row.participantCount,
          row.levelId,
          row.ownInstructorName !== null,
          row.ownInstructorName,
          row.tag,
          row.notes,
        ],
      );
      createdGroups += 1;
    }

    await recordAudit(tx, {
      action: 'partners.imported',
      entityType: 'facility',
      entityId: request.facilityId,
      data: { createdPartners, createdGroups, updatedGroups, skipped },
    });

    return { rows, partners, summary, createdPartners, createdGroups, updatedGroups, skipped };
  });
}
