import { BadRequestException } from '@nestjs/common';
import type { Tx } from '@poolse/db';

/**
 * A student's address and identity — POOLSE-131 (Rui, 30-10-2026).
 *
 * Morada, localidade, código postal, filiação, estado civil, profissão,
 * habilitações, naturalidade, nacionalidade and nº de utente: all optional,
 * the student's own. One group, so every read path carries it as one column
 * and every write path as one call. Identity: named and never valued in the
 * change log, cleared on anonymisation (the migration's trigger). The SNS
 * number is owner and admin only (`forReader`).
 */
export interface StudentIdentity {
  addressLine: string | null;
  locality: string | null;
  postalCode: string | null;
  parentOneName: string | null;
  parentTwoName: string | null;
  maritalStatus: MaritalStatus | null;
  profession: string | null;
  education: string | null;
  birthplace: string | null;
  nationality: string | null;
  snsNumber: string | null;
  /** For a reader who may not see the number: whether one is on file. */
  snsRecorded?: boolean;
}

export const MARITAL_STATUSES = ['single', 'married', 'civil_union', 'divorced', 'widowed'] as const;
export type MaritalStatus = (typeof MARITAL_STATUSES)[number];

/** The API field and its column, in the one order every path uses. */
const COLUMNS = [
  ['addressLine', 'address_line'],
  ['locality', 'locality'],
  ['postalCode', 'postal_code'],
  ['parentOneName', 'parent_one_name'],
  ['parentTwoName', 'parent_two_name'],
  ['maritalStatus', 'marital_status'],
  ['profession', 'profession'],
  ['education', 'education'],
  ['birthplace', 'birthplace'],
  ['nationality', 'nationality'],
  ['snsNumber', 'sns_number'],
] as const satisfies readonly (readonly [keyof StudentIdentity, string])[];

export const IDENTITY_FIELDS = COLUMNS.map(([field]) => field);

/** The same pairs, for a statement that writes some of them (the import's blanks). */
export const IDENTITY_COLUMNS: readonly (readonly [Exclude<keyof StudentIdentity, 'snsRecorded'>, string])[] = COLUMNS;

/** The group as one jsonb column, for a SELECT over `student` aliased `s`. */
export const IDENTITY_SELECT = (s: string): string =>
  `jsonb_build_object(${COLUMNS.map(([field, column]) =>
    column === 'marital_status' ? `'${field}', ${s}.${column}::text` : `'${field}', ${s}.${column}`,
  ).join(', ')})`;

const LIMITS: Partial<Record<keyof StudentIdentity, number>> = {
  addressLine: 200,
  locality: 100,
  parentOneName: 160,
  parentTwoName: 160,
  profession: 120,
  education: 120,
  birthplace: 120,
};

function text(body: Record<string, unknown>, field: keyof StudentIdentity): string | null {
  const raw = body[field];
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') throw refuse(field, 'students.identity.invalid');
  const value = raw.trim().replace(/\s+/g, ' ');
  if (value === '') return null;
  const limit = LIMITS[field];
  if (limit !== undefined && value.length > limit) throw refuse(field, 'students.identity.tooLong');
  return value;
}

function refuse(field: string, key: string): BadRequestException {
  return new BadRequestException({ code: 'invalid_identity', message: `Invalid ${field}`, fields: { [field]: key } });
}

/**
 * The group from a request body, or undefined when the caller sent none of it —
 * an import or a lead conversion that predates POOLSE-131 leaves what is on
 * file alone rather than blanking it.
 */
export function parseIdentity(body: Record<string, unknown>): StudentIdentity | undefined {
  if (!IDENTITY_FIELDS.some((field) => field in body)) return undefined;

  const postal = text(body, 'postalCode');
  const postalCode = postal === null ? null : postal.replace(/\s/g, '');
  if (postalCode !== null && !/^\d{4}-\d{3}$/.test(postalCode)) throw refuse('postalCode', 'students.identity.postalCode');

  const marital = text(body, 'maritalStatus');
  if (marital !== null && !(MARITAL_STATUSES as readonly string[]).includes(marital)) {
    throw refuse('maritalStatus', 'students.identity.invalid');
  }

  const country = text(body, 'nationality');
  const nationality = country === null ? null : country.toUpperCase();
  if (nationality !== null && !/^[A-Z]{2}$/.test(nationality)) throw refuse('nationality', 'students.identity.invalid');

  const sns = text(body, 'snsNumber');
  const snsNumber = sns === null ? null : sns.replace(/\s/g, '');
  if (snsNumber !== null && !/^\d{9}$/.test(snsNumber)) throw refuse('snsNumber', 'students.identity.snsNumber');

  return {
    addressLine: text(body, 'addressLine'),
    locality: text(body, 'locality'),
    postalCode,
    parentOneName: text(body, 'parentOneName'),
    parentTwoName: text(body, 'parentTwoName'),
    maritalStatus: marital as MaritalStatus | null,
    profession: text(body, 'profession'),
    education: text(body, 'education'),
    birthplace: text(body, 'birthplace'),
    nationality,
    snsNumber,
  };
}

/** Writes the whole group onto one student, inside the caller's transaction. */
export async function writeIdentity(tx: Tx, studentId: string, identity: StudentIdentity): Promise<void> {
  const sets = COLUMNS.map(([, column], index) =>
    column === 'marital_status' ? `${column} = $${index + 2}::marital_status` : `${column} = $${index + 2}`,
  ).join(', ');
  await tx.query(`UPDATE student SET ${sets} WHERE id = $1`, [
    studentId,
    ...COLUMNS.map(([field]) => identity[field] ?? null),
  ]);
}

/** The group as on file, for a change log's before. */
export async function readIdentity(tx: Tx, studentId: string): Promise<StudentIdentity | null> {
  const { rows } = await tx.query<{ identity: StudentIdentity }>(
    `SELECT ${IDENTITY_SELECT('s')} AS identity FROM student s WHERE s.id = $1`,
    [studentId],
  );
  return rows[0]?.identity ?? null;
}

/** The fields that moved — named in `withheld`, never valued (POOLSE-80). */
export function identityChanges(before: StudentIdentity | null, after: StudentIdentity): string[] {
  return IDENTITY_FIELDS.filter((field) => (before?.[field] ?? null) !== (after[field] ?? null));
}

/**
 * What one reader may see of it. The SNS number is health-adjacent: owner and
 * admin read it, everybody else learns only whether one is on file.
 */
export function forReader(identity: StudentIdentity, mayReadSns: boolean): StudentIdentity {
  if (mayReadSns) return { ...identity, snsRecorded: identity.snsNumber !== null };
  return { ...identity, snsNumber: null, snsRecorded: identity.snsNumber !== null };
}
