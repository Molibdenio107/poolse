import { withOrg, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { currentTenant } from '../tenant/tenant.context.js';
import { personName } from '../people/names.js';

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
}

export interface PassProductInput {
  kind: PassKind;
  name: string;
  entries: number | null;
  validityDays: number | null;
  amountCents: number;
  vatRate: number;
  vatExempt: boolean;
}

export interface PoolOccupancy {
  poolId: string;
  poolName: string;
  /** `pool.max_capacity`. Null is "not measured" and refuses nothing. */
  capacity: number | null;
  swimmers: number;
  inClasses: number;
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
}

export interface Reception {
  stayMinutes: number;
  pools: PoolOccupancy[];
  inWater: InWater[];
  products: PassProduct[];
}

/** Raised when a product's facility, or the facility itself, is not this club's. */
export class NoSuchProductError extends Error {}
/** A pack or a period pass sold to nobody. Only a single entry may be anonymous. */
export class OwnerRequiredError extends Error {}
/** The buyer is not a live person in this club. */
export class NoSuchPersonError extends Error {}
/** The site has no live invoice series to number the sale in. */
export class NoSeriesError extends Error {}

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
    WHERE s.product_id = p.id AND s.organization_id = p.organization_id)::int AS sold_count`;

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
          vat_rate, vat_exempt)
       VALUES ($1, $2, $3::pass_kind, $4, $5, $6, $7, $8, $9)
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
              amount_cents = $7, vat_rate = $8, vat_exempt = $9
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

    const { rows: pools } = await tx.query<{
      id: string;
      name: string;
      capacity: number | null;
      swimmers: number;
      in_classes: number;
    }>(
      `SELECT p.id, p.name, o.capacity, o.swimmers, o.in_classes
         FROM pool p
         CROSS JOIN LATERAL pool_occupancy(p.organization_id, p.id) o
        WHERE p.facility_id = $1 AND p.archived_at IS NULL
        ORDER BY lower(p.name), p.id`,
      [facilityId],
    );

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
      `SELECT c.id AS check_in_id, c.pass_id, c.pool_id, s.membership_id,
              CASE WHEN s.membership_id IS NULL THEN NULL
                   ELSE ${personName('s.membership_id')} END AS person_name,
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
      pools: pools.map((row) => ({
        poolId: row.id,
        poolName: row.name,
        capacity: row.capacity,
        swimmers: row.swimmers,
        inClasses: row.in_classes,
      })),
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
              i.document_no, i.id AS invoice_id
         FROM pass_current pc
         JOIN pass_product pr ON pr.id = pc.product_id AND pr.organization_id = pc.organization_id
         JOIN facility f ON f.id = pc.facility_id AND f.organization_id = pc.organization_id
         LEFT JOIN invoice i ON i.id = pc.sale_invoice_id AND i.organization_id = pc.organization_id
        WHERE pc.facility_id = $1 AND pc.membership_id = $2
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
    }));
  });
}

// ---------------------------------------------------------------------------
// Selling and checking in
// ---------------------------------------------------------------------------

export interface SaleInput {
  productId: string;
  /** Null only for a single entry. */
  membershipId: string | null;
  /** The pass's first day. Null means today at the site. */
  validFrom: string | null;
  /** Check the buyer in at once, into this tank — "sell and check in" in one act. */
  checkInPoolId: string | null;
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
): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO pass_check_in (organization_id, pass_id, pool_id, checked_in_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [organizationId, passId, poolId, currentTenant().membershipId],
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
  return withOrg(organizationId, async (tx) => {
    const { rows: found } = await tx.query<{
      kind: PassKind;
      name: string;
      entries: number | null;
      validity_days: number | null;
      amount_cents: number;
      vat_rate: string;
      vat_exempt: boolean;
      today: string;
    }>(
      `SELECT p.kind::text AS kind, p.name, p.entries, p.validity_days, p.amount_cents,
              p.vat_rate, p.vat_exempt,
              to_char((now() AT TIME ZONE f.timezone)::date, 'YYYY-MM-DD') AS today
         FROM pass_product p
         JOIN facility f ON f.id = p.facility_id AND f.organization_id = p.organization_id
        WHERE p.id = $2 AND p.facility_id = $1
          AND p.archived_at IS NULL AND f.archived_at IS NULL`,
      [facilityId, input.productId],
    );
    const product = found[0];
    if (product === undefined) throw new NoSuchProductError();
    if (product.kind !== 'single' && input.membershipId === null) throw new OwnerRequiredError();
    if (input.membershipId !== null) {
      // RLS hides another club's person, so this is also the cross-tenant answer.
      const { rows: person } = await tx.query(
        `SELECT 1 FROM membership WHERE id = $1 AND archived_at IS NULL`,
        [input.membershipId],
      );
      if (person.length === 0) throw new NoSuchPersonError();
    }

    // A single entry is good on the day it is sold and no other.
    const validFrom =
      product.kind === 'single' ? product.today : (input.validFrom ?? product.today);

    const { rows: passRows } = await tx.query<{ id: string; valid_until: string | null }>(
      `INSERT INTO pass
         (organization_id, facility_id, product_id, membership_id, kind, entries,
          valid_from, valid_until, sold_by)
       VALUES ($1, $2, $3, $4, $5::pass_kind, $6, $7::date,
               CASE $5::pass_kind
                 WHEN 'single' THEN $7::date
                 ELSE $7::date + ($8::int - 1)
               END,
               $9)
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
      `INSERT INTO invoice
         (organization_id, facility_id, series_id, due_on, payer_membership_id,
          payer_name, payer_tax_number, payer_address, payer_email)
       SELECT $1, $2, $3, current_date, m.id,
              ${personName('m.id')}, m.tax_number, m.address, person_email(m.id)
         FROM (SELECT $4::uuid AS id) wanted
         LEFT JOIN membership m ON m.id = wanted.id AND m.archived_at IS NULL
       RETURNING id, document_no`,
      [organizationId, facilityId, series[0].id, input.membershipId],
    );
    const invoice = invoiceRows[0]!;

    await tx.query(
      `INSERT INTO invoice_line
         (organization_id, invoice_id, pass_id, description, period_start, months,
          amount_cents, vat_rate, vat_exempt, sort_order)
       VALUES ($1, $2, $3, $4, $5::date, 1, $6, $7, $8, 0)`,
      [
        organizationId,
        invoice.id,
        passId,
        product.name,
        validFrom,
        product.amount_cents,
        product.vat_rate,
        product.vat_exempt,
      ],
    );

    // A free entry (a courtesy pass at 0 €) has nothing to settle.
    if (product.amount_cents > 0) {
      await tx.query(
        `INSERT INTO invoice_payment
           (organization_id, invoice_id, amount_cents, paid_on, source, recorded_by)
         VALUES ($1, $2, $3, current_date, 'manual', $4)`,
        [organizationId, invoice.id, product.amount_cents, currentTenant().membershipId],
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
      data: { documentNo: invoice.document_no, product: product.name, checkedIn: checkInId !== null },
    });

    return { passId, invoiceId: invoice.id, documentNo: invoice.document_no, checkInId };
  });
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
): Promise<string | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query(
      `SELECT 1 FROM pass WHERE id = $1 AND facility_id = $2`,
      [passId, facilityId],
    );
    if (rows.length === 0) return null;
    return insertCheckIn(tx, organizationId, passId, poolId);
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
         (organization_id, status, first_name, last_name, email, phone, tax_number)
       VALUES ($1, 'active', $2, $3, $4::citext, $5, $6)
       RETURNING id`,
      [organizationId, input.firstName, input.lastName, input.email, input.phone, input.taxNumber],
    );
    const id = rows[0]!.id;
    await recordAudit(tx, {
      action: 'membership.walk_in_created',
      entityType: 'membership',
      entityId: id,
      data: {},
    });
    return id;
  });
}
