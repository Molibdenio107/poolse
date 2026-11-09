import { withOrg, type Tx } from '@poolse/db';
import { sellPassIn, STUDENT_NAME, type PassKind, type Sale } from '../reception/passes.repository.js';

/**
 * *Natação livre* in the family app — POOLSE-204 (Rui, 08-11-2026).
 *
 * What a reader may use (their own passes, their children's, and a family pack
 * of the guardian who holds it), what the club sells on the phone, and the
 * purchase itself.
 *
 * **A phone purchase is owed until paid**, and the pack refuses entry until it
 * is: the check-in trigger reads `pass_current.paid`. **One unpaid phone pack
 * per payer** at a time. The price is the server's, from `pass_price_for()` via
 * the sale's own body (`sellPassIn`); the client sends a product, a person and
 * an idempotency key, never an amount.
 */

export interface AppPass {
  id: string;
  productName: string;
  facilityName: string;
  kind: PassKind;
  entries: number | null;
  entriesLeft: number | null;
  validUntil: string | null;
  shared: boolean;
  /** A phone pack whose document is not settled yet: it does not open the door. */
  unpaid: boolean;
  holderName: string | null;
}

export interface AppPassProduct {
  id: string;
  name: string;
  facilityName: string;
  kind: PassKind;
  entries: number | null;
  validityDays: number | null;
  shareable: boolean;
  /** What each person the reader may buy for pays, and why. */
  prices: { personKey: string; amountCents: number; categoryNames: string | null }[];
}

/** Somebody the reader may buy for: `self`, or a child's student id. */
export interface AppBuyer {
  key: string;
  name: string;
  self: boolean;
}

export interface AppOwedPass {
  passId: string;
  productName: string;
  amountCents: number;
  documentNo: string;
  invoiceId: string;
}

export interface AppPasses {
  passes: AppPass[];
  forSale: AppPassProduct[];
  people: AppBuyer[];
  /** False for a minor's own login: they see passes, they never buy. */
  canBuy: boolean;
  /** Phone packs this reader owes — *Pagamentos* shows them (Rui, 08-11-2026). */
  owed: AppOwedPass[];
}

export class NoSuchAppProductError extends Error {}
export class NotYourChildError extends Error {}
export class FamilyPackIsTheHoldersError extends Error {}
export class UnpaidAppPackError extends Error {
  constructor(readonly documentNo: string) {
    super('An unpaid phone pack is waiting');
  }
}
export class PurchaseKeyTakenError extends Error {}
export class MinorMayNotBuyError extends Error {}

/** The reader's own student records (an adult swimmer, or a child on their own login). */
const MY_STUDENTS = `SELECT s.id FROM student s
                      WHERE s.membership_id = $1::uuid AND s.archived_at IS NULL`;
/** The children the reader is a live guardian of. */
const MY_CHILDREN = `SELECT g.student_id FROM guardian_access g
                       JOIN student s ON s.id = g.student_id AND s.organization_id = g.organization_id
                      WHERE g.guardian_membership_id = $1::uuid
                        AND g.archived_at IS NULL AND s.archived_at IS NULL`;

/**
 * Whether this reader may buy: a guardian, or a student on the adult path.
 * A minor's own login reads and never buys (as the FPN form).
 */
async function mayBuy(tx: Tx, membershipId: string, isGuardian: boolean): Promise<boolean> {
  if (isGuardian) return true;
  const { rows } = await tx.query<{ adult: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM student s
        WHERE s.membership_id = $1::uuid AND s.archived_at IS NULL
          AND student_is_adult_path(s.organization_id, s.id)) AS adult`,
    [membershipId],
  );
  return rows[0]?.adult === true;
}

export async function readAppPasses(
  organizationId: string,
  membershipId: string,
  isGuardian: boolean,
): Promise<AppPasses> {
  return withOrg(organizationId, async (tx) => {
    const canBuy = await mayBuy(tx, membershipId, isGuardian);

    const { rows: passes } = await tx.query<{
      id: string;
      product_name: string;
      facility_name: string;
      kind: PassKind;
      entries: number | null;
      entries_left: number | null;
      valid_until: string | null;
      shared: boolean;
      unpaid: boolean;
      holder_name: string | null;
    }>(
      `SELECT pc.id, pr.name AS product_name, f.name AS facility_name, pc.kind::text AS kind,
              pc.entries, pc.entries_left, to_char(pc.valid_until, 'YYYY-MM-DD') AS valid_until,
              pc.shared, (pc.sold_via = 'app' AND NOT pc.paid) AS unpaid,
              coalesce(${STUDENT_NAME('pc.student_id')},
                       CASE WHEN pc.membership_id IS NULL THEN NULL
                            ELSE person_name(pc.membership_id) END) AS holder_name
         FROM pass_current pc
         JOIN pass_product pr ON pr.id = pc.product_id AND pr.organization_id = pc.organization_id
         JOIN facility f ON f.id = pc.facility_id AND f.organization_id = pc.organization_id
        WHERE NOT pc.voided AND NOT pc.expired
          AND (pc.entries_left IS NULL OR pc.entries_left > 0)
          AND (pc.membership_id = $1::uuid
               OR pc.student_id IN (${MY_STUDENTS})
               OR pc.student_id IN (${MY_CHILDREN})
               -- A family pack the reader's guardian holds: the one definition decides.
               OR (pc.shared AND EXISTS (
                     SELECT 1 FROM pass_family(pc.organization_id, pc.id) fam
                      WHERE fam.student_id IN (${MY_STUDENTS}))))
        ORDER BY pc.sold_at DESC, pc.id`,
      [membershipId],
    );

    const people: AppBuyer[] = [];
    if (canBuy) {
      const { rows: me } = await tx.query<{ name: string }>(`SELECT person_name($1::uuid) AS name`, [membershipId]);
      people.push({ key: 'self', name: me[0]?.name ?? '', self: true });
      if (isGuardian) {
        const { rows: children } = await tx.query<{ id: string; name: string }>(
          `SELECT c.student_id AS id, ${STUDENT_NAME('c.student_id')} AS name
             FROM (${MY_CHILDREN}) c ORDER BY 2`,
          [membershipId],
        );
        for (const child of children) people.push({ key: child.id, name: child.name, self: false });
      }
    }

    const { rows: products } = await tx.query<{
      id: string;
      name: string;
      facility_name: string;
      kind: PassKind;
      entries: number | null;
      validity_days: number | null;
      shareable: boolean;
    }>(
      `SELECT p.id, p.name, f.name AS facility_name, p.kind::text AS kind, p.entries,
              p.validity_days, p.shareable
         FROM pass_product p
         JOIN facility f ON f.id = p.facility_id AND f.organization_id = p.organization_id
        WHERE p.sold_in_app AND p.archived_at IS NULL AND f.archived_at IS NULL
        ORDER BY f.name, p.amount_cents, lower(p.name)`,
    );

    const forSale: AppPassProduct[] = [];
    for (const product of products) {
      const prices: AppPassProduct['prices'] = [];
      // A family pack is the payer's own; a personal pack, for anybody they buy for.
      for (const person of product.shareable ? people.filter((one) => one.self) : people) {
        const { rows } = await tx.query<{ amount_cents: number; category_names: string | null }>(
          `SELECT amount_cents, category_names FROM pass_price_for($1, $2, $3::uuid, $4::uuid)`,
          [organizationId, product.id, person.self ? membershipId : null, person.self ? null : person.key],
        );
        if (rows[0] !== undefined) {
          prices.push({
            personKey: person.key,
            amountCents: rows[0].amount_cents,
            categoryNames: rows[0].category_names,
          });
        }
      }
      forSale.push({
        id: product.id,
        name: product.name,
        facilityName: product.facility_name,
        kind: product.kind,
        entries: product.entries,
        validityDays: product.validity_days,
        shareable: product.shareable,
        prices,
      });
    }

    const { rows: owed } = await tx.query<{
      pass_id: string;
      product_name: string;
      amount_cents: number;
      document_no: string;
      invoice_id: string;
    }>(
      `SELECT pc.id AS pass_id, pr.name AS product_name, l.amount_cents, i.document_no, i.id AS invoice_id
         FROM pass_current pc
         JOIN pass_product pr ON pr.id = pc.product_id AND pr.organization_id = pc.organization_id
         JOIN invoice i ON i.id = pc.sale_invoice_id AND i.organization_id = pc.organization_id
         JOIN invoice_line l ON l.id = pc.sale_line_id AND l.organization_id = pc.organization_id
        WHERE pc.sold_via = 'app' AND NOT pc.paid AND NOT pc.voided
          AND i.payer_membership_id = $1::uuid
        ORDER BY pc.sold_at`,
      [membershipId],
    );

    return {
      passes: passes.map((row) => ({
        id: row.id,
        productName: row.product_name,
        facilityName: row.facility_name,
        kind: row.kind,
        entries: row.entries,
        entriesLeft: row.entries_left,
        validUntil: row.valid_until,
        shared: row.shared,
        unpaid: row.unpaid,
        holderName: row.holder_name,
      })),
      forSale: canBuy ? forSale : [],
      people,
      canBuy,
      owed: owed.map((row) => ({
        passId: row.pass_id,
        productName: row.product_name,
        amountCents: row.amount_cents,
        documentNo: row.document_no,
        invoiceId: row.invoice_id,
      })),
    };
  });
}

/**
 * Buy a pack on the phone — POOLSE-204, rule 5. One transaction: the checks,
 * then the sale's own body with the price from `pass_price_for()`. The same key
 * twice is the same sale, returned again rather than a second document.
 */
export async function buyInApp(
  organizationId: string,
  membershipId: string,
  isGuardian: boolean,
  input: { productId: string; studentId: string | null; purchaseKey: string },
): Promise<Sale & { repeated: boolean }> {
  return withOrg(organizationId, async (tx) => {
    // One buyer at a time: the unpaid test below and the insert are one step.
    await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('app-pass:' || $1::text, 0))`, [membershipId]);

    const { rows: earlier } = await tx.query<{
      pass_id: string;
      invoice_id: string;
      document_no: string;
      payer: string | null;
    }>(
      `SELECT pc.id AS pass_id, i.id AS invoice_id, i.document_no, i.payer_membership_id AS payer
         FROM pass p
         JOIN pass_current pc ON pc.id = p.id AND pc.organization_id = p.organization_id
         JOIN invoice i ON i.id = pc.sale_invoice_id AND i.organization_id = pc.organization_id
        WHERE p.purchase_key = $1::uuid`,
      [input.purchaseKey],
    );
    if (earlier[0] !== undefined) {
      if (earlier[0].payer !== membershipId) throw new PurchaseKeyTakenError();
      return {
        passId: earlier[0].pass_id,
        invoiceId: earlier[0].invoice_id,
        documentNo: earlier[0].document_no,
        checkInId: null,
        repeated: true,
      };
    }

    if (!(await mayBuy(tx, membershipId, isGuardian))) throw new MinorMayNotBuyError();

    const { rows: product } = await tx.query<{ facility_id: string; shareable: boolean }>(
      `SELECT p.facility_id, p.shareable
         FROM pass_product p
         JOIN facility f ON f.id = p.facility_id AND f.organization_id = p.organization_id
        WHERE p.id = $1::uuid AND p.sold_in_app AND p.archived_at IS NULL AND f.archived_at IS NULL`,
      [input.productId],
    );
    if (product[0] === undefined) throw new NoSuchAppProductError();

    if (input.studentId !== null) {
      if (!isGuardian) throw new NotYourChildError();
      const { rows: child } = await tx.query(
        `SELECT 1 FROM (${MY_CHILDREN}) c WHERE c.student_id = $2::uuid`,
        [membershipId, input.studentId],
      );
      if (child.length === 0) throw new NotYourChildError();
      if (product[0].shareable) throw new FamilyPackIsTheHoldersError();
    }

    const { rows: unpaid } = await tx.query<{ document_no: string }>(
      `SELECT i.document_no
         FROM pass_current pc
         JOIN invoice i ON i.id = pc.sale_invoice_id AND i.organization_id = pc.organization_id
        WHERE pc.sold_via = 'app' AND NOT pc.paid AND NOT pc.voided
          AND i.payer_membership_id = $1::uuid
        LIMIT 1`,
      [membershipId],
    );
    if (unpaid[0] !== undefined) throw new UnpaidAppPackError(unpaid[0].document_no);

    try {
      const sale = await sellPassIn(
        tx,
        organizationId,
        product[0].facility_id,
        {
          productId: input.productId,
          membershipId: input.studentId === null ? membershipId : null,
          validFrom: null,
          checkInPoolId: null,
          basePrice: false,
        },
        { studentId: input.studentId, payerMembershipId: membershipId, purchaseKey: input.purchaseKey },
      );
      return { ...sale, repeated: false };
    } catch (error) {
      // Another buyer's key, inserted in between: never theirs to read.
      if ((error as { code?: string; constraint?: string }).constraint === 'pass_purchase_key_uq') {
        throw new PurchaseKeyTakenError();
      }
      throw error;
    }
  });
}
