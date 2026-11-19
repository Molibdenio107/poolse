/**
 * Which of a person's own details a club needs before they start — POOLSE-227
 * (Rui, 19-11-2026). One definition, read by the API's `GET /me` (which decides
 * whether the *Confirmar os seus dados* gate shows) and by the gate's form
 * (which marks the fields `*`), so the two can never disagree.
 *
 * The answer is about the data, never about whether the gate was seen: a person
 * with nothing missing is never asked, and one who later clears a field is
 * asked again.
 */

/** In the order the form shows them. */
export const DETAIL_FIELDS = [
  'firstName',
  'lastName',
  'mobile',
  'taxNumber',
  'address',
  'postalCode',
  'locality',
] as const;

export type DetailField = (typeof DETAIL_FIELDS)[number];

/** A name and a mobile: what every club needs to reach anybody. */
const CONTACT: readonly DetailField[] = ['firstName', 'lastName', 'mobile'];

/** Staff also give a NIF and a morada — the club's payroll (rule 7). */
const STAFF: readonly DetailField[] = [...CONTACT, 'taxNumber', 'address', 'postalCode', 'locality'];

export interface RequiredDetailsContext {
  /**
   * The reader's student record is on the adult path (`student_is_adult_path`).
   * A minor with a login is not asked: their contacts are their guardian's.
   */
  adultPathStudent: boolean;
}

/** The union of what each of the reader's roles needs, in `DETAIL_FIELDS` order. */
export function requiredDetails(roles: readonly string[], context: RequiredDetailsContext): DetailField[] {
  const wanted = new Set<DetailField>();
  for (const role of roles) {
    if (role === 'instructor' || role === 'maintenance') STAFF.forEach((field) => wanted.add(field));
    else if (role === 'owner' || role === 'admin' || role === 'guardian') CONTACT.forEach((field) => wanted.add(field));
    else if (role === 'student' && context.adultPathStudent) CONTACT.forEach((field) => wanted.add(field));
  }
  return DETAIL_FIELDS.filter((field) => wanted.has(field));
}

/** The required fields that are blank. Whitespace is blank. */
export function missingDetails(
  required: readonly DetailField[],
  values: Partial<Record<DetailField, string | null | undefined>>,
): DetailField[] {
  return required.filter((field) => {
    const value = values[field];
    return value === null || value === undefined || value.trim() === '';
  });
}
