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

/** A name and a mobile: what a club needs to reach a family or a member of staff. */
const CONTACT: readonly DetailField[] = ['firstName', 'lastName', 'mobile'];

/**
 * The owner and admins give a name; their mobile is offered, never required
 * (Rui, 19-11-2026): nothing in Poolse sends to it, so asking for it at the door
 * was a requirement with no use.
 */
const OFFICE: readonly DetailField[] = ['firstName', 'lastName'];

/**
 * Staff give a name and a mobile, like a family. Their NIF and morada are
 * *offered*, never required (Rui, 19-11-2026, which **reverses** POOLSE-227's
 * "required of instructors and maintenance at every club"): see
 * `asksPayrollDetails`.
 */
const STAFF: readonly DetailField[] = CONTACT;

/** The details offered to staff as optional: the NIF and the morada. */
export const PAYROLL_DETAILS: readonly DetailField[] = ['taxNumber', 'address', 'postalCode', 'locality'];

/** Whether the details screen offers the NIF and the morada (optional) to this reader. */
export function asksPayrollDetails(roles: readonly string[]): boolean {
  return roles.includes('instructor') || roles.includes('maintenance');
}

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
    else if (role === 'guardian') CONTACT.forEach((field) => wanted.add(field));
    else if (role === 'owner' || role === 'admin') OFFICE.forEach((field) => wanted.add(field));
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
