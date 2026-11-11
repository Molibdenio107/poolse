import { withOrg, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { currentTenant } from '../tenant/tenant.context.js';
import { personName } from '../people/names.js';
import { insertStudent, type StudentInput } from '../students/students.repository.js';

/**
 * Free swim — POOLSE-68, slice 1.
 *
 * Somebody walks in, pays for one entry or a pack of ten, and swims. Three
 * things live here and each has one definition in SQL that this file reads
 * rather than repeats:
 *
 * - **What a pass has left** is `pass_current` — entries used, entries left,
 *   expired, void. Never a counter on the row.
 * - **Who is in the water** is `pool_occupancy()` — free swimmers inside the
 *   site's default stay plus the people in classes running now.
 * - **Whether an entry is allowed** is the `pass_check_in_allowed` trigger,
 *   which raises with its figures in DETAIL. `checkInRefusal` in the controller
 *   reads them; nothing here re-derives a number to build a sentence.
 *
 * **A sale is a document.** Selling writes the pass, an invoice with one line
 * naming it, and the payment taken at the desk, in one transaction — and with
 * `checkInPoolId` the entry too, so a full tank refuses the sale rather than
 * selling a ticket nobody can use.
 */

export type PassKind = 'single' | 'pack' | 'period';
export type MoneyProvenance = 'actual' | 'contracted' | 'estimated' | 'assumed';

export interface PassProduct {
  id: string;
  kind: PassKind;
  name: string;
  /** A pack's entries. Null for the other two shapes. */
  entries: number | null;
  /** Required on a period pass, optional on a pack, null on a single entry. */
  validityDays: number | null;
  amountCents: number;
  vatRate: number;
  vatExempt: boolean;
  provenance: MoneyProvenance;
  /** How many have been sold — what makes retiring one a decision. */
  soldCount: number;
  /** The price per category set — POOLSE-203. The base is `amountCents`. */
  prices: PassPrice[];
  /** A *Pack família* — POOLSE-204: used by the holder and the children they guard. */
  shareable: boolean;
  /** Offered for purchase in the family app — POOLSE-204. */
  soldInApp: boolean;
}

/** One price for one set of categories (a single one, or a typed combination) — POOLSE-203. */
export interface PassPrice {
  id: string;
  categoryIds: string[];
  /** In rank order, the club's own words. */
  categoryNames: string[];
  amountCents: number;
}

/** What one person pays for one product today, and why — `pass_price_for()`. */
export interface PersonPrice {
  productId: string;
  amountCents: number;
  baseCents: number;
  /** *Sénior + Sócio*; null at the base price. */
  categoryNames: string | null;
}

export interface PassProductInput {
  kind: PassKind;
  name: string;
  entries: number | null;
  validityDays: number | null;
  amountCents: number;
  vatRate: number;
  vatExempt: boolean;
  shareable: boolean;
  soldInApp: boolean;
}

export interface PoolOccupancy {
  poolId: string;
  poolName: string;
  /** `pool.max_capacity`. Null is "not measured" and refuses nothing. */
  capacity: number | null;
  swimmers: number;
  inClasses: number;
  /**
   * What shuts the tank now — POOLSE-84. A check-in is refused while it is set
   * (by the trigger, under the pool lock); this is what lets reception say so
   * before anybody tries.
   */
  closure: { reason: string; until: string; partOfDay: 'morning' | 'afternoon' | null } | null;
}

export interface InWater {
  checkInId: string;
  passId: string;
  poolId: string;
  /** Null for an anonymous single entry. */
  membershipId: string | null;
  personName: string | null;
  productName: string;
  kind: PassKind;
  checkedInAt: string;
  /** The checked-out moment, else the end of the default stay. */
  leavesAt: string;
}

export interface Pass {
  id: string;
  productName: string;
  kind: PassKind;
  entries: number | null;
  entriesUsed: number;
  entriesLeft: number | null;
  validFrom: string;
  validUntil: string | null;
  soldAt: string;
  voided: boolean;
  expired: boolean;
  /** The day has not come yet — a monthly pass sold to start on the first. */
  notYet: boolean;
  /** Somebody on this pass is in the water right now. */
  inWater: boolean;
  documentNo: string | null;
  invoiceId: string | null;
  /** POOLSE-204: who holds it — the person at the desk, or a child they guard. */
  holderName: string | null;
  holderStudentId: string | null;
  /** A family pack: anybody in `family` may check in on it. */
  shared: boolean;
  soldVia: 'reception' | 'app';
  /** A phone pack works once paid. */
  paid: boolean;
  /** Who may check in on it, from `pass_family()`. */
  family: Swimmer[];
}

/** One person who may swim on a pass — a login or a student, never both. */
export interface Swimmer {
  membershipId: string | null;
  studentId: string | null;
  name: string;
}

/** A student's name as the club reads it (`student_person`). */
export const STUDENT_NAME = (idExpression: string): string =>
  `(SELECT btrim(sp.first_name || ' ' || sp.last_name) FROM student_person sp WHERE sp.id = ${idExpression})`;

/** `pass_family()` as a JSON list of swimmers with names, for one pass alias. */
export const FAMILY_JSON = (passAlias: string): string => `
  (SELECT coalesce(json_agg(json_build_object(
            'membershipId', fam.membership_id,
            'studentId', fam.student_id,
            'name', coalesce(${STUDENT_NAME('fam.student_id')},
                             CASE WHEN fam.membership_id IS NULL THEN NULL
                                  ELSE person_name(fam.membership_id) END, ''))
          ORDER BY fam.membership_id IS NULL, fam.student_id), '[]'::json)
     FROM pass_family(${passAlias}.organization_id, ${passAlias}.id) fam)`;

export interface Reception {
  stayMinutes: number;
  pools: PoolOccupancy[];
  inWater: InWater[];
  products: PassProduct[];
  month: FreeSwimMonth;
  /** The club's age of majority — the desk's Nova pessoa asks for an encarregado under it. */
  ageOfMajority?: number;
}

/**
 * Free swim this month — POOLSE-68 AC 6, **never summed with fees**.
 *
 * What was sold: pass sale lines on documents issued this month and not since
 * credited. Every one is a document that happened and was paid at the counter,
 * so the figure is `actual` and complete — no coverage to report, because
 * there is no pass whose price is unknown. It is labelled as free swim wherever
 * it is shown, and the mensalidades card goes on counting only mensalidades.
 */
export interface FreeSwimMonth {
  /** The first day of the month counted, as the club's date. */
  from: string;
  salesCents: number;
  sales: number;
  /** Entries this month — check-ins, not passes. A pack sold in May swims in June. */
  entries: number;
  provenance: 'actual';
}

/** The dashboard's card: the tanks now, and the month. */
export interface FreeSwim {
  pools: PoolOccupancy[];
  month: FreeSwimMonth;
  /** Live products across the sites read. Zero means the club does not sell free swim. */
  products: number;
}

/** Raised when a product's facility, or the facility itself, is not this club's. */
export class NoSuchProductError extends Error {}
/** A pack or a period pass sold to nobody. Only a single entry may be anonymous. */
export class OwnerRequiredError extends Error {}
/** The buyer is not a live person in this club. */
export class NoSuchPersonError extends Error {}
/** The site has no live invoice series to number the sale in. */
export class NoSeriesError extends Error {}
/** A price names a category this club does not have — POOLSE-203. */
export class NoSuchCategoryError extends Error {}

async function facilityExists(tx: Tx, facilityId: string): Promise<boolean> {
  const { rows } = await tx.query(
    `SELECT 1 FROM facility WHERE id = $1 AND archived_at IS NULL`,
    [facilityId],
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// The products a site sells
// ---------------------------------------------------------------------------

const PRODUCT_COLUMNS = `
  p.id, p.kind::text AS kind, p.name, p.entries, p.validity_days, p.amount_cents,
  p.vat_rate, p.vat_exempt, p.provenance::text AS provenance,
  (SELECT count(*) FROM pass s
    WHERE s.product_id = p.id AND s.organization_id = p.organization_id)::int AS sold_count,
  (SELECT coalesce(json_agg(json_build_object(
            'id', pp.id,
            'categoryIds', pp.category_ids,
            'categoryNames', (SELECT coalesce(json_agg(c.name ORDER BY c.rank, lower(c.name)), '[]'::json)
                                FROM fee_category c
                               WHERE c.organization_id = pp.organization_id AND c.id = ANY (pp.category_ids)),
            'amountCents', pp.amount_cents)
          ORDER BY cardinality(pp.category_ids), pp.amount_cents), '[]'::json)
     FROM pass_product_price pp
    WHERE pp.product_id = p.id AND pp.organization_id = p.organization_id
      AND pp.archived_at IS NULL) AS prices,
  p.shareable, p.sold_in_app`;

interface ProductRow {
  id: string;
  kind: PassKind;
  name: string;
  entries: number | null;
  validity_days: number | null;
  amount_cents: number;
  vat_rate: string;
  vat_exempt: boolean;
  provenance: MoneyProvenance;
  sold_count: number;
  prices: PassPrice[];
  shareable: boolean;
  sold_in_app: boolean;
}

function toProduct(row: ProductRow): PassProduct {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    entries: row.entries,
    validityDays: row.validity_days,
    amountCents: row.amount_cents,
    // `numeric` arrives as a string from pg, like every other rate here.
    vatRate: Number(row.vat_rate),
    vatExempt: row.vat_exempt,
    provenance: row.provenance,
    soldCount: row.sold_count,
    prices: row.prices,
    shareable: row.shareable,
    soldInApp: row.sold_in_app,
  };
}

async function readProducts(tx: Tx, facilityId: string): Promise<PassProduct[]> {
  const { rows } = await tx.query<ProductRow>(
    `SELECT ${PRODUCT_COLUMNS}
       FROM pass_product p
      WHERE p.facility_id = $1 AND p.archived_at IS NULL
      ORDER BY array_position(ARRAY['single','pack','period']::pass_kind[], p.kind),
               p.amount_cents, lower(p.name)`,
    [facilityId],
  );
  return rows.map(toProduct);
}

/** Null when the facility is not this club's. */
export async function listProducts(
  organizationId: string,
  facilityId: string,
): Promise<{ products: PassProduct[]; stayMinutes: number } | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ stay: number }>(
      `SELECT free_swim_stay_minutes AS stay FROM facility
        WHERE id = $1 AND archived_at IS NULL`,
      [facilityId],
    );
    if (rows[0] === undefined) return null;
    return { products: await readProducts(tx, facilityId), stayMinutes: rows[0].stay };
  });
}

/** The product's own columns from its shape, so a stale field cannot ride along. */
function shaped(input: PassProductInput): PassProductInput {
  return {
    ...input,
    entries: input.kind === 'pack' ? input.entries : null,
    validityDays: input.kind === 'single' ? null : input.validityDays,
    vatRate: input.vatExempt ? 0 : input.vatRate,
    // A single entry is one person on one day: nothing to share (CHECK too).
    shareable: input.kind !== 'single' && input.shareable,
  };
}

export async function createProduct(
  organizationId: string,
  facilityId: string,
  input: PassProductInput,
): Promise<string | null> {
  const product = shaped(input);
  return withOrg(organizationId, async (tx) => {
    if (!(await facilityExists(tx, facilityId))) return null;
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO pass_product
         (organization_id, facility_id, kind, name, entries, validity_days, amount_cents,
          vat_rate, vat_exempt, shareable, sold_in_app)
       VALUES ($1, $2, $3::pass_kind, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        organizationId,
        facilityId,
        product.kind,
        product.name,
        product.entries,
        product.validityDays,
        product.amountCents,
        product.vatRate,
        product.vatExempt,
        product.shareable,
        product.soldInApp,
      ],
    );
    const id = rows[0]!.id;
    // The name only: an amount stays out of the audit trail, as it does for pay.
    await recordAudit(tx, {
      action: 'pass_product.created',
      entityType: 'pass_product',
      entityId: id,
      data: { facilityId, name: product.name, kind: product.kind },
    });
    return id;
  });
}

/**
 * A product edited. Passes already sold keep what they were sold as — the pass
 * snapshots its shape and the invoice line its price.
 */
export async function updateProduct(
  organizationId: string,
  facilityId: string,
  productId: string,
  input: PassProductInput,
): Promise<boolean> {
  const product = shaped(input);
  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE pass_product
          SET kind = $3::pass_kind, name = $4, entries = $5, validity_days = $6,
              amount_cents = $7, vat_rate = $8, vat_exempt = $9,
              shareable = $10, sold_in_app = $11
        WHERE id = $2 AND facility_id = $1 AND archived_at IS NULL`,
      [
        facilityId,
        productId,
        product.kind,
        product.name,
        product.entries,
        product.validityDays,
        product.amountCents,
        product.vatRate,
        product.vatExempt,
        product.shareable,
        product.soldInApp,
      ],
    );
    if (rowCount === 0) return false;
    await recordAudit(tx, {
      action: 'pass_product.updated',
      entityType: 'pass_product',
      entityId: productId,
      data: { facilityId, name: product.name, kind: product.kind },
    });
    return true;
  });
}

/** Retired from sale. Passes sold under it stay valid until they run out. */
export async function archiveProduct(
  organizationId: string,
  facilityId: string,
  productId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE pass_product SET archived_at = now()
        WHERE id = $2 AND facility_id = $1 AND archived_at IS NULL`,
      [facilityId, productId],
    );
    if (rowCount === 0) return false;
    await recordAudit(tx, {
      action: 'pass_product.archived',
      entityType: 'pass_product',
      entityId: productId,
      data: { facilityId },
    });
    return true;
  });
}

export async function setStayMinutes(
  organizationId: string,
  facilityId: string,
  minutes: number,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE facility SET free_swim_stay_minutes = $2 WHERE id = $1 AND archived_at IS NULL`,
      [facilityId, minutes],
    );
    if (rowCount === 0) return false;
    await recordAudit(tx, {
      action: 'facility.free_swim_stay_changed',
      entityType: 'facility',
      entityId: facilityId,
      data: { minutes },
    });
    return true;
  });
}

// ---------------------------------------------------------------------------
// Reception — who is in the water
// ---------------------------------------------------------------------------

/**
 * Free swim this month at these sites, one statement whatever their number.
 *
 * The month is the club's (`club_today()`); an entry's day is its own site's.
 */
async function freeSwimMonth(tx: Tx, facilityIds: readonly string[]): Promise<FreeSwimMonth> {
  const { rows } = await tx.query<{
    from: string;
    sales_cents: string;
    sales: number;
    entries: number;
  }>(
    `WITH bounds AS (SELECT date_trunc('month', club_today())::date AS from_day)
     SELECT to_char(b.from_day, 'YYYY-MM-DD') AS from,
            (SELECT coalesce(sum(l.amount_cents), 0)
               FROM invoice_line l
               JOIN invoice i ON i.id = l.invoice_id AND i.organization_id = l.organization_id
              WHERE l.pass_id IS NOT NULL
                AND l.document_kind = 'invoice'
                AND i.facility_id = ANY($1::uuid[])
                AND i.issued_on >= b.from_day
                AND NOT EXISTS (
                  SELECT 1 FROM invoice c
                   WHERE c.corrects_invoice_id = i.id
                     AND c.organization_id = i.organization_id
                     AND c.kind = 'credit_note')) AS sales_cents,
            (SELECT count(*)::int
               FROM invoice_line l
               JOIN invoice i ON i.id = l.invoice_id AND i.organization_id = l.organization_id
              WHERE l.pass_id IS NOT NULL
                AND l.document_kind = 'invoice'
                AND i.facility_id = ANY($1::uuid[])
                AND i.issued_on >= b.from_day
                AND NOT EXISTS (
                  SELECT 1 FROM invoice c
                   WHERE c.corrects_invoice_id = i.id
                     AND c.organization_id = i.organization_id
                     AND c.kind = 'credit_note')) AS sales,
            (SELECT count(*)::int
               FROM pass_check_in c
               JOIN pool p ON p.id = c.pool_id AND p.organization_id = c.organization_id
               JOIN facility f ON f.id = p.facility_id AND f.organization_id = p.organization_id
              WHERE p.facility_id = ANY($1::uuid[])
                AND c.archived_at IS NULL
                AND (c.checked_in_at AT TIME ZONE f.timezone)::date >= b.from_day) AS entries
       FROM bounds b`,
    [facilityIds],
  );
  const row = rows[0]!;
  return {
    from: row.from,
    // A sum arrives as bigint, which node-postgres hands over as a string.
    salesCents: Number(row.sales_cents),
    sales: row.sales,
    entries: row.entries,
    provenance: 'actual',
  };
}

/** Each tank at these sites, now. One statement: `pool_occupancy` per row. */
async function occupancyOf(tx: Tx, facilityIds: readonly string[]): Promise<PoolOccupancy[]> {
  const { rows } = await tx.query<{
    id: string;
    name: string;
    capacity: number | null;
    swimmers: number;
    in_classes: number;
    closure_reason: string | null;
    closure_until: string | null;
    closure_part: 'morning' | 'afternoon' | null;
  }>(
    `SELECT p.id, p.name, o.capacity, o.swimmers, o.in_classes,
            k.reason AS closure_reason, k.until::text AS closure_until,
            k.part_of_day::text AS closure_part
       FROM pool p
       CROSS JOIN LATERAL pool_occupancy(p.organization_id, p.id) o
       LEFT JOIN LATERAL pool_closure_at(p.organization_id, p.id, now()) k ON true
      WHERE p.facility_id = ANY($1::uuid[]) AND p.archived_at IS NULL
      ORDER BY lower(p.name), p.id`,
    [facilityIds],
  );
  return rows.map((row) => ({
    poolId: row.id,
    poolName: row.name,
    capacity: row.capacity,
    swimmers: row.swimmers,
    inClasses: row.in_classes,
    closure:
      row.closure_until === null
        ? null
        : {
            reason: row.closure_reason ?? '',
            until: row.closure_until,
            partOfDay: row.closure_part,
          },
  }));
}

/** The dashboard card's read — the reader's sites, already narrowed by the selector. */
export async function readFreeSwim(
  organizationId: string,
  facilityIds: readonly string[],
): Promise<FreeSwim> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pass_product
        WHERE facility_id = ANY($1::uuid[]) AND archived_at IS NULL`,
      [facilityIds],
    );
    return {
      pools: await occupancyOf(tx, facilityIds),
      month: await freeSwimMonth(tx, facilityIds),
      products: rows[0]!.n,
    };
  });
}

/**
 * The reception screen in one read: each tank's occupancy, who is in the water
 * on a pass, and what may be sold. Null when the facility is not this club's.
 *
 * **Bounded by a window, not paged** — the in-water list is check-ins inside
 * the default stay, which a tank's own size bounds. Paging it would hide the
 * swimmer reception came to check out.
 */
export async function readReception(
  organizationId: string,
  facilityId: string,
): Promise<Reception | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows: facility } = await tx.query<{ stay: number }>(
      `SELECT free_swim_stay_minutes AS stay FROM facility
        WHERE id = $1 AND archived_at IS NULL`,
      [facilityId],
    );
    if (facility[0] === undefined) return null;

    const pools = await occupancyOf(tx, [facilityId]);

    const { rows: inWater } = await tx.query<{
      check_in_id: string;
      pass_id: string;
      pool_id: string;
      membership_id: string | null;
      person_name: string | null;
      product_name: string;
      kind: PassKind;
      checked_in_at: string;
      leaves_at: string;
    }>(
      // Who swam (POOLSE-204), not who holds the pass: on a family pack they differ.
      `SELECT c.id AS check_in_id, c.pass_id, c.pool_id, c.membership_id,
              coalesce(${STUDENT_NAME('c.student_id')},
                       CASE WHEN c.membership_id IS NULL THEN NULL
                            ELSE ${personName('c.membership_id')} END) AS person_name,
              pr.name AS product_name, s.kind::text AS kind,
              c.checked_in_at, leaves.at AS leaves_at
         FROM pass_check_in c
         JOIN pass s ON s.id = c.pass_id AND s.organization_id = c.organization_id
         JOIN pass_product pr ON pr.id = s.product_id AND pr.organization_id = s.organization_id
         JOIN pool p ON p.id = c.pool_id AND p.organization_id = c.organization_id
         JOIN facility f ON f.id = p.facility_id AND f.organization_id = p.organization_id
         CROSS JOIN LATERAL (
           SELECT coalesce(c.checked_out_at,
                           c.checked_in_at + make_interval(mins => f.free_swim_stay_minutes)) AS at
         ) leaves
        WHERE p.facility_id = $1
          AND c.archived_at IS NULL
          AND c.checked_in_at <= now()
          AND leaves.at > now()
        ORDER BY c.checked_in_at DESC, c.id`,
      [facilityId],
    );

    return {
      stayMinutes: facility[0].stay,
      pools,
      inWater: inWater.map((row) => ({
        checkInId: row.check_in_id,
        passId: row.pass_id,
        poolId: row.pool_id,
        membershipId: row.membership_id,
        personName: row.person_name,
        productName: row.product_name,
        kind: row.kind,
        checkedInAt: new Date(row.checked_in_at).toISOString(),
        leavesAt: new Date(row.leaves_at).toISOString(),
      })),
      products: await readProducts(tx, facilityId),
      month: await freeSwimMonth(tx, [facilityId]),
    };
  });
}

/**
 * One person's passes at this site, newest first. Bounded by one person — a
 * swimmer does not buy a register's worth of packs — so not paged.
 */
export async function passesOf(
  organizationId: string,
  facilityId: string,
  membershipId: string,
): Promise<Pass[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      product_name: string;
      kind: PassKind;
      entries: number | null;
      entries_used: number;
      entries_left: number | null;
      valid_from: string;
      valid_until: string | null;
      sold_at: string;
      voided: boolean;
      expired: boolean;
      not_yet: boolean;
      in_water: boolean;
      document_no: string | null;
      invoice_id: string | null;
      holder_name: string | null;
      student_id: string | null;
      shared: boolean;
      sold_via: 'reception' | 'app';
      paid: boolean;
      family: Swimmer[];
    }>(
      `SELECT pc.id, pr.name AS product_name, pc.kind::text AS kind, pc.entries,
              pc.entries_used, pc.entries_left,
              to_char(pc.valid_from, 'YYYY-MM-DD') AS valid_from,
              to_char(pc.valid_until, 'YYYY-MM-DD') AS valid_until,
              pc.sold_at, pc.voided, pc.expired,
              pc.valid_from > (now() AT TIME ZONE f.timezone)::date AS not_yet,
              EXISTS (
                SELECT 1 FROM pass_check_in c
                 WHERE c.pass_id = pc.id AND c.organization_id = pc.organization_id
                   AND c.archived_at IS NULL
                   AND c.checked_in_at <= now()
                   AND coalesce(c.checked_out_at,
                                c.checked_in_at
                                  + make_interval(mins => f.free_swim_stay_minutes)) > now()
              ) AS in_water,
              i.document_no, i.id AS invoice_id,
              coalesce(${STUDENT_NAME('pc.student_id')},
                       CASE WHEN pc.membership_id IS NULL THEN NULL
                            ELSE person_name(pc.membership_id) END) AS holder_name,
              pc.student_id, pc.shared, pc.sold_via::text AS sold_via, pc.paid,
              ${FAMILY_JSON('pc')} AS family
         FROM pass_current pc
         JOIN pass_product pr ON pr.id = pc.product_id AND pr.organization_id = pc.organization_id
         JOIN facility f ON f.id = pc.facility_id AND f.organization_id = pc.organization_id
         LEFT JOIN invoice i ON i.id = pc.sale_invoice_id AND i.organization_id = pc.organization_id
        -- The person's own, and their children's (POOLSE-204): a child's pack
        -- is checked in from the guardian at the desk.
        WHERE pc.facility_id = $1
          AND (pc.membership_id = $2
               OR pc.student_id IN (
                    SELECT g.student_id FROM guardian_access g
                     WHERE g.guardian_membership_id = $2 AND g.archived_at IS NULL))
        ORDER BY pc.sold_at DESC, pc.id`,
      [facilityId, membershipId],
    );

    return rows.map((row) => ({
      id: row.id,
      productName: row.product_name,
      kind: row.kind,
      entries: row.entries,
      entriesUsed: row.entries_used,
      entriesLeft: row.entries_left,
      validFrom: row.valid_from,
      validUntil: row.valid_until,
      soldAt: new Date(row.sold_at).toISOString(),
      voided: row.voided,
      expired: row.expired,
      notYet: row.not_yet,
      inWater: row.in_water,
      documentNo: row.document_no,
      invoiceId: row.invoice_id,
      holderName: row.holder_name,
      holderStudentId: row.student_id,
      shared: row.shared,
      soldVia: row.sold_via,
      paid: row.paid,
      family: row.family,
    }));
  });
}

// ---------------------------------------------------------------------------
// Selling and checking in
// ---------------------------------------------------------------------------

/**
 * The price for one set of categories — POOLSE-203. One live price per exact
 * set: typing a set that already has one changes its amount. Sold passes keep
 * what they were sold at (the line snapshots it). False: no such product here.
 */
export async function setProductPrice(
  organizationId: string,
  facilityId: string,
  productId: string,
  categoryIds: string[],
  amountCents: number,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows: product } = await tx.query(
      `SELECT 1 FROM pass_product WHERE id = $1 AND facility_id = $2 AND archived_at IS NULL`,
      [productId, facilityId],
    );
    if (product.length === 0) return false;
    try {
      const { rows } = await tx.query<{ id: string }>(
        `WITH wanted AS (
           SELECT ARRAY(SELECT DISTINCT x FROM unnest($4::uuid[]) AS x ORDER BY 1) AS ids
         ),
         updated AS (
           UPDATE pass_product_price pp SET amount_cents = $5
             FROM wanted
            WHERE pp.product_id = $3 AND pp.category_ids = wanted.ids AND pp.archived_at IS NULL
           RETURNING pp.id
         )
         INSERT INTO pass_product_price (organization_id, facility_id, product_id, category_ids, amount_cents)
         SELECT $1, $2, $3, wanted.ids, $5 FROM wanted
          WHERE NOT EXISTS (SELECT 1 FROM updated)
         RETURNING id`,
        [organizationId, facilityId, productId, categoryIds, amountCents],
      );
      await recordAudit(tx, {
        action: 'pass_price.set',
        entityType: 'pass_product',
        entityId: productId,
        data: { categoryIds, amountCents, created: rows.length > 0 },
      });
    } catch (error) {
      // Another club's or a made-up category: the per-element key's refusal.
      if ((error as { code?: string }).code === '23503') throw new NoSuchCategoryError();
      throw error;
    }
    return true;
  });
}

/** Remove one price (an archive). False: no such live price on this product here. */
export async function archiveProductPrice(
  organizationId: string,
  facilityId: string,
  productId: string,
  priceId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `UPDATE pass_product_price SET archived_at = now()
        WHERE id = $1 AND product_id = $2 AND facility_id = $3 AND archived_at IS NULL
      RETURNING id`,
      [priceId, productId, facilityId],
    );
    if (rows.length === 0) return false;
    await recordAudit(tx, {
      action: 'pass_price.removed',
      entityType: 'pass_product',
      entityId: productId,
      data: { priceId },
    });
    return true;
  });
}

/**
 * What this person pays for each of the site's products today, and why —
 * straight from `pass_price_for()`, for reception's sale form. Null: no such
 * person in this club.
 */
export async function pricesForPerson(
  organizationId: string,
  facilityId: string,
  membershipId: string,
): Promise<PersonPrice[] | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows: person } = await tx.query(
      `SELECT 1 FROM membership WHERE id = $1 AND archived_at IS NULL`,
      [membershipId],
    );
    if (person.length === 0) return null;
    const { rows } = await tx.query<{
      product_id: string;
      amount_cents: number;
      base_cents: number;
      category_names: string | null;
    }>(
      `SELECT p.id AS product_id, r.amount_cents, p.amount_cents AS base_cents, r.category_names
         FROM pass_product p
         CROSS JOIN LATERAL pass_price_for($1, p.id, $3::uuid) r
        WHERE p.facility_id = $2 AND p.archived_at IS NULL`,
      [organizationId, facilityId, membershipId],
    );
    return rows.map((row) => ({
      productId: row.product_id,
      amountCents: row.amount_cents,
      baseCents: row.base_cents,
      categoryNames: row.category_names,
    }));
  });
}

export interface SaleInput {
  productId: string;
  /** Null only for a single entry. */
  membershipId: string | null;
  /** The pass's first day. Null means today at the site. */
  validFrom: string | null;
  /** Check the buyer in at once, into this tank — "sell and check in" in one act. */
  checkInPoolId: string | null;
  /**
   * POOLSE-203, rule 4: sell at the product's base price rather than the
   * person's category price. The only override there is; audited.
   */
  basePrice: boolean;
}

/**
 * What a phone purchase adds to a sale — POOLSE-204. The pass may be a child's
 * (`studentId`, then `membershipId` is null), the document is addressed to the
 * buyer, nothing is taken at a counter, and the key makes a double tap one sale.
 */
export interface AppSaleExtras {
  studentId: string | null;
  payerMembershipId: string;
  purchaseKey: string;
}

export interface Sale {
  passId: string;
  invoiceId: string;
  documentNo: string;
  checkInId: string | null;
}

async function insertCheckIn(
  tx: Tx,
  organizationId: string,
  passId: string,
  poolId: string,
  swimmer: { membershipId: string | null; studentId: string | null } = { membershipId: null, studentId: null },
): Promise<string> {
  // Nobody named: the trigger makes it the holder's, or refuses a family pack.
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO pass_check_in (organization_id, pass_id, pool_id, checked_in_by, membership_id, student_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [organizationId, passId, poolId, currentTenant().membershipId, swimmer.membershipId, swimmer.studentId],
  );
  return rows[0]!.id;
}

/**
 * Sell a pass: the pass, its document, the money taken, and optionally the
 * first entry — one transaction, so a refusal at any step sells nothing.
 *
 * **The money is recorded at the counter.** Reception takes it as the pass is
 * handed over; leaving the document unpaid would put every walk-in on the
 * chase list as overdue by the next morning.
 */
export async function sellPass(
  organizationId: string,
  facilityId: string,
  input: SaleInput,
): Promise<Sale> {
  return withOrg(organizationId, (tx) => sellPassIn(tx, organizationId, facilityId, input, null));
}

/**
 * The sale's body, for the desk (`app` null) and for the phone (POOLSE-204),
 * inside the caller's transaction.
 */
export async function sellPassIn(
  tx: Tx,
  organizationId: string,
  facilityId: string,
  input: SaleInput,
  app: AppSaleExtras | null,
): Promise<Sale> {
  {
    const { rows: found } = await tx.query<{
      kind: PassKind;
      name: string;
      entries: number | null;
      validity_days: number | null;
      amount_cents: number;
      vat_rate: string;
      vat_exempt: boolean;
      shareable: boolean;
      today: string;
    }>(
      `SELECT p.kind::text AS kind, p.name, p.entries, p.validity_days, p.amount_cents,
              p.vat_rate, p.vat_exempt, p.shareable,
              to_char((now() AT TIME ZONE f.timezone)::date, 'YYYY-MM-DD') AS today
         FROM pass_product p
         JOIN facility f ON f.id = p.facility_id AND f.organization_id = p.organization_id
        WHERE p.id = $2 AND p.facility_id = $1
          AND p.archived_at IS NULL AND f.archived_at IS NULL`,
      [facilityId, input.productId],
    );
    const product = found[0];
    if (product === undefined) throw new NoSuchProductError();
    const studentId = app?.studentId ?? null;
    if (product.kind !== 'single' && input.membershipId === null && studentId === null) {
      throw new OwnerRequiredError();
    }
    if (studentId !== null) {
      const { rows: child } = await tx.query(
        `SELECT 1 FROM student WHERE id = $1 AND archived_at IS NULL`,
        [studentId],
      );
      if (child.length === 0) throw new NoSuchPersonError();
    }
    if (input.membershipId !== null) {
      // RLS hides another club's person, so this is also the cross-tenant answer.
      const { rows: person } = await tx.query(
        `SELECT 1 FROM membership WHERE id = $1 AND archived_at IS NULL`,
        [input.membershipId],
      );
      if (person.length === 0) throw new NoSuchPersonError();
    }

    /*
     * The price, and why — POOLSE-203. `pass_price_for()` is the precedence;
     * nothing here re-derives it. The office may sell at the base instead,
     * never at a number it typed, and that choice is audited below.
     */
    const { rows: priced } = await tx.query<{ amount_cents: number; category_names: string | null }>(
      `SELECT amount_cents, category_names FROM pass_price_for($1, $2, $3::uuid, $4::uuid)`,
      [organizationId, input.productId, input.membershipId, studentId],
    );
    const resolved = priced[0] ?? { amount_cents: product.amount_cents, category_names: null };
    const amountCents = input.basePrice ? product.amount_cents : resolved.amount_cents;
    const categoryNames = input.basePrice ? null : resolved.category_names;

    // A single entry is good on the day it is sold and no other.
    const validFrom =
      product.kind === 'single' ? product.today : (input.validFrom ?? product.today);

    const { rows: passRows } = await tx.query<{ id: string; valid_until: string | null }>(
      // A family pack is shared when a login holds it (POOLSE-204); sold_via and
      // the key are snapshotted with the rest.
      `INSERT INTO pass
         (organization_id, facility_id, product_id, membership_id, kind, entries,
          valid_from, valid_until, sold_by, student_id, shared, sold_via, purchase_key)
       VALUES ($1, $2, $3, $4, $5::pass_kind, $6, $7::date,
               CASE $5::pass_kind
                 WHEN 'single' THEN $7::date
                 ELSE $7::date + ($8::int - 1)
               END,
               $9, $10, $11, $12::pass_sold_via, $13)
       RETURNING id, to_char(valid_until, 'YYYY-MM-DD') AS valid_until`,
      [
        organizationId,
        facilityId,
        input.productId,
        input.membershipId,
        product.kind,
        product.kind === 'single' ? 1 : product.entries,
        validFrom,
        product.validity_days,
        currentTenant().membershipId,
        studentId,
        product.shareable && input.membershipId !== null,
        app === null ? 'reception' : 'app',
        app?.purchaseKey ?? null,
      ],
    );
    const passId = passRows[0]!.id;

    const { rows: series } = await tx.query<{ id: string }>(
      `SELECT id FROM invoice_series
        WHERE facility_id = $1 AND kind = 'invoice' AND is_default AND archived_at IS NULL`,
      [facilityId],
    );
    if (series[0] === undefined) throw new NoSeriesError();

    /*
     * The payer is the pass's owner, snapshotted as every document snapshots
     * it, or nobody — the anonymous entry, which the interface prints as
     * Consumidor final. Null name and null ids together, by CHECK.
     */
    const { rows: invoiceRows } = await tx.query<{ id: string; document_no: string }>(
      // Dated on the site's own day — the day the pass starts — not the
      // database's UTC date, which puts a sale at 00:30 in the previous month.
      `INSERT INTO invoice
         (organization_id, facility_id, series_id, issued_on, due_on, payer_membership_id,
          payer_name, payer_tax_number, payer_address, payer_email)
       SELECT $1, $2, $3, $5::date, $5::date, m.id,
              ${personName('m.id')}, m.tax_number, m.address, person_email(m.id)
         FROM (SELECT $4::uuid AS id) wanted
         LEFT JOIN membership m ON m.id = wanted.id AND m.archived_at IS NULL
       RETURNING id, document_no`,
      [organizationId, facilityId, series[0].id, app?.payerMembershipId ?? input.membershipId, product.today],
    );
    const invoice = invoiceRows[0]!;

    await tx.query(
      // The amount and the category names are snapshotted: a later change to
      // the price table never touches a sold pass (POOLSE-203, rule 3).
      `INSERT INTO invoice_line
         (organization_id, invoice_id, pass_id, description, period_start, months,
          amount_cents, vat_rate, vat_exempt, sort_order, fee_category_name)
       VALUES ($1, $2, $3, $4, $5::date, 1, $6, $7, $8, 0, $9)`,
      [
        organizationId,
        invoice.id,
        passId,
        product.name,
        validFrom,
        amountCents,
        product.vat_rate,
        product.vat_exempt,
        categoryNames,
      ],
    );

    // A free entry (a courtesy pass at 0 €) has nothing to settle; a phone pack
    // is owed until the office records it paid (POOLSE-204).
    if (amountCents > 0 && app === null) {
      await tx.query(
        `INSERT INTO invoice_payment
           (organization_id, invoice_id, amount_cents, paid_on, source, recorded_by)
         VALUES ($1, $2, $3, $5::date, 'manual', $4)`,
        [organizationId, invoice.id, amountCents, currentTenant().membershipId, product.today],
      );
    }

    const checkInId =
      input.checkInPoolId === null
        ? null
        : await insertCheckIn(tx, organizationId, passId, input.checkInPoolId);

    await recordAudit(tx, {
      action: 'pass.sold',
      entityType: 'pass',
      entityId: passId,
      data: {
        documentNo: invoice.document_no,
        product: product.name,
        checkedIn: checkInId !== null,
        soldVia: app === null ? 'reception' : 'app',
        amountCents,
        categories: categoryNames,
        // The override, with what it overrode (POOLSE-203, rule 4).
        ...(input.basePrice && resolved.amount_cents !== product.amount_cents
          ? { basePriceOverride: { resolvedCents: resolved.amount_cents, resolvedCategories: resolved.category_names } }
          : {}),
      },
    });

    return { passId, invoiceId: invoice.id, documentNo: invoice.document_no, checkInId };
  }
}

/**
 * One entry. Every rule — the site, a void pass, its dates, its entries, one
 * body per pass, and the tank's capacity — is the trigger's, and it refuses
 * with the figures in DETAIL. Null when the pass is not this site's.
 */
export async function checkIn(
  organizationId: string,
  facilityId: string,
  passId: string,
  poolId: string,
  swimmer: { membershipId: string | null; studentId: string | null } = { membershipId: null, studentId: null },
): Promise<string | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query(
      `SELECT 1 FROM pass WHERE id = $1 AND facility_id = $2`,
      [passId, facilityId],
    );
    if (rows.length === 0) return null;
    return insertCheckIn(tx, organizationId, passId, poolId, swimmer);
  });
}

/** Out early. Only a check-in still in the water, so a stay is never lengthened. */
export async function checkOut(
  organizationId: string,
  facilityId: string,
  checkInId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE pass_check_in c
          SET checked_out_at = now()
         FROM pool p, facility f
        WHERE c.id = $2
          AND p.id = c.pool_id AND p.organization_id = c.organization_id
          AND f.id = p.facility_id AND f.organization_id = p.organization_id
          AND p.facility_id = $1
          AND c.archived_at IS NULL
          AND c.checked_out_at IS NULL
          AND c.checked_in_at + make_interval(mins => f.free_swim_stay_minutes) > now()`,
      [facilityId, checkInId],
    );
    return (rowCount ?? 0) > 0;
  });
}

/**
 * A check-in entered by mistake: it gives the entry back to the pack and the
 * place back to the tank. The row stays, as the record of the mistake.
 */
export async function cancelCheckIn(
  organizationId: string,
  facilityId: string,
  checkInId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE pass_check_in c
          SET archived_at = now()
         FROM pool p
        WHERE c.id = $2
          AND p.id = c.pool_id AND p.organization_id = c.organization_id
          AND p.facility_id = $1
          AND c.archived_at IS NULL`,
      [facilityId, checkInId],
    );
    if ((rowCount ?? 0) === 0) return false;
    await recordAudit(tx, {
      action: 'pass.check_in_cancelled',
      entityType: 'pass_check_in',
      entityId: checkInId,
      data: { facilityId },
    });
    return true;
  });
}

// ---------------------------------------------------------------------------
// A walk-in the club will see again
// ---------------------------------------------------------------------------

export interface WalkInInput {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  taxNumber: string | null;
  birthDate: string | null;
  /**
   * A minor at the desk (Rui, 11-11-2026): also a student, with the encarregado
   * the student form demands, so somebody answers for the child. Already
   * checked by `parseStudent`; null for an adult or an unknown age.
   */
  student: StudentInput | null;
}

/**
 * A person with no role and no login — somebody who swims here and is not a
 * student, a guardian or staff. A membership like any other, so the duplicate
 * guards on email and NIF apply and a returning swimmer is found by search.
 */
export async function createWalkIn(organizationId: string, input: WalkInInput): Promise<string> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO membership
         (organization_id, status, first_name, last_name, email, phone, tax_number, birth_date)
       VALUES ($1, 'active', $2, $3, $4::citext, $5, $6, $7::date)
       RETURNING id`,
      [organizationId, input.firstName, input.lastName, input.email, input.phone, input.taxNumber, input.birthDate],
    );
    const id = rows[0]!.id;
    /*
     * The child is a student too, the person the desk sells to: `membership_id`
     * is "known to the club in their own right", which a swimmer buying passes
     * is. One transaction, so a refused encarregado leaves no orphan person.
     */
    let studentId: string | null = null;
    if (input.student !== null) {
      studentId = await insertStudent(tx, organizationId, input.student);
      if (studentId === null) throw new Error('walk-in student: no such level');
      await tx.query(`UPDATE student SET membership_id = $2 WHERE id = $1`, [studentId, id]);
    }
    await recordAudit(tx, {
      action: 'membership.walk_in_created',
      entityType: 'membership',
      entityId: id,
      data: studentId === null ? {} : { studentId },
    });
    return id;
  });
}
