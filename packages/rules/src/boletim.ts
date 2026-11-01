/**
 * A club's own boletim de sócio — POOLSE-142.
 *
 * **One list.** `BOLETIM_FIELDS` is what Poolse knows how to write on a club's
 * form; the SQL enum `boletim_field` spells exactly these keys, compared by
 * `boletim-template.integration.test.ts`. A new field is a value in both and a
 * branch in `boletimValue`.
 *
 * **One definition of what goes on the line.** The print and the editor's
 * preview call `boletimValue`, so a split date or a two-digit year is worked
 * out once. A paper form of a Portuguese club is Portuguese whoever prints it,
 * as the FPN's Anexo 2 is: month names here are pt-PT, and the caller passes
 * the marital status and nationality already in Portuguese words.
 */
export const BOLETIM_FIELDS = [
  'name',
  'parent_one_name',
  'parent_two_name',
  'birth_date',
  'birth_day',
  'birth_month',
  'birth_year',
  'marital_status',
  'profession',
  'education',
  'birthplace',
  'nationality',
  'address_line',
  'locality',
  'postal_code',
  'phone',
  'email',
  'tax_number',
  'id_document_number',
  'sns_number',
  'socio_number',
  'socio_since',
  'guardian_name',
  'guardian_phone',
  'guardian_email',
  'guardian_relationship',
  'today',
  'today_day',
  'today_month',
  'today_year',
  'today_year_short',
] as const;

export type BoletimField = (typeof BOLETIM_FIELDS)[number];

export function isBoletimField(value: unknown): value is BoletimField {
  return typeof value === 'string' && (BOLETIM_FIELDS as readonly string[]).includes(value);
}

/** The fields whose value is read only when a template places them (rule 5). */
export const GUARDED_BOLETIM_FIELDS: ReadonlySet<BoletimField> = new Set(['id_document_number', 'sns_number']);

/** The editor's groups, in the order a paper form usually asks. */
export const BOLETIM_FIELD_GROUPS: readonly { key: string; fields: readonly BoletimField[] }[] = [
  { key: 'person', fields: ['name', 'parent_one_name', 'parent_two_name', 'marital_status', 'profession', 'education'] },
  { key: 'birth', fields: ['birth_date', 'birth_day', 'birth_month', 'birth_year', 'birthplace', 'nationality'] },
  { key: 'contact', fields: ['address_line', 'locality', 'postal_code', 'phone', 'email'] },
  { key: 'documents', fields: ['tax_number', 'id_document_number', 'sns_number'] },
  { key: 'socio', fields: ['socio_number', 'socio_since'] },
  { key: 'guardian', fields: ['guardian_name', 'guardian_phone', 'guardian_email', 'guardian_relationship'] },
  { key: 'today', fields: ['today', 'today_day', 'today_month', 'today_year', 'today_year_short'] },
];

/** A placement: a field, x and y as fractions of the page (the baseline start), a size in pt. */
export interface BoletimPlacement {
  field: BoletimField;
  x: number;
  y: number;
  sizePt: number;
}

export const BOLETIM_SIZE_MIN = 6;
export const BOLETIM_SIZE_MAX = 24;
export const BOLETIM_SIZE_DEFAULT = 11;

/** A placement as the API receives it, or null when any part is wrong. */
export function parseBoletimPlacement(raw: unknown): BoletimPlacement | null {
  if (raw === null || typeof raw !== 'object') return null;
  const { field, x, y, sizePt } = raw as Record<string, unknown>;
  if (!isBoletimField(field)) return null;
  const onPage = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
  if (!onPage(x) || !onPage(y)) return null;
  const size = sizePt === undefined ? BOLETIM_SIZE_DEFAULT : sizePt;
  if (typeof size !== 'number' || !Number.isFinite(size) || size < BOLETIM_SIZE_MIN || size > BOLETIM_SIZE_MAX) return null;
  // The columns are numeric(5,4) and numeric(4,1): round here so what is saved is what was sent.
  return { field, x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000, sizePt: Math.round(size * 10) / 10 };
}

const MONTHS_PT = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
] as const;

/** What the print knows about the student, with words already in Portuguese. */
export interface BoletimData {
  name: string;
  parentOneName: string | null;
  parentTwoName: string | null;
  /** `YYYY-MM-DD`. */
  birthDate: string | null;
  maritalStatus: string | null;
  profession: string | null;
  education: string | null;
  birthplace: string | null;
  nationality: string | null;
  addressLine: string | null;
  locality: string | null;
  postalCode: string | null;
  phone: string | null;
  email: string | null;
  taxNumber: string | null;
  idDocumentNumber: string | null;
  snsNumber: string | null;
  socioNumber: string | null;
  /** `YYYY-MM-DD`. */
  socioSince: string | null;
  guardian: { name: string; phone: string | null; email: string | null; relationship: string | null } | null;
}

/** `YYYY-MM-DD` as the boletim writes a whole date: dd-MM-yyyy, the product's one shape. */
function wholeDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}-${month}-${year}`;
}

function part(iso: string | null, which: 'day' | 'month' | 'year' | 'yearShort'): string | null {
  if (iso === null || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [year, month, day] = iso.split('-') as [string, string, string];
  switch (which) {
    case 'day':
      return String(Number(day));
    case 'month':
      return MONTHS_PT[Number(month) - 1] ?? null;
    case 'year':
      return year;
    case 'yearShort':
      return year.slice(2);
  }
}

/** The text written for one field, or null for a blank (which prints nothing). */
export function boletimValue(field: BoletimField, data: BoletimData, today: string): string | null {
  const blank = (value: string | null | undefined): string | null =>
    value === null || value === undefined || value.trim() === '' ? null : value;
  switch (field) {
    case 'name':
      return blank(data.name);
    case 'parent_one_name':
      return blank(data.parentOneName);
    case 'parent_two_name':
      return blank(data.parentTwoName);
    case 'birth_date':
      return data.birthDate === null ? null : wholeDate(data.birthDate);
    case 'birth_day':
      return part(data.birthDate, 'day');
    case 'birth_month':
      return part(data.birthDate, 'month');
    case 'birth_year':
      return part(data.birthDate, 'year');
    case 'marital_status':
      return blank(data.maritalStatus);
    case 'profession':
      return blank(data.profession);
    case 'education':
      return blank(data.education);
    case 'birthplace':
      return blank(data.birthplace);
    case 'nationality':
      return blank(data.nationality);
    case 'address_line':
      return blank(data.addressLine);
    case 'locality':
      return blank(data.locality);
    case 'postal_code':
      return blank(data.postalCode);
    case 'phone':
      return blank(data.phone);
    case 'email':
      return blank(data.email);
    case 'tax_number':
      return blank(data.taxNumber);
    case 'id_document_number':
      return blank(data.idDocumentNumber);
    case 'sns_number':
      return blank(data.snsNumber);
    case 'socio_number':
      return blank(data.socioNumber);
    case 'socio_since':
      return data.socioSince === null ? null : wholeDate(data.socioSince);
    case 'guardian_name':
      return blank(data.guardian?.name);
    case 'guardian_phone':
      return blank(data.guardian?.phone);
    case 'guardian_email':
      return blank(data.guardian?.email);
    case 'guardian_relationship':
      return blank(data.guardian?.relationship);
    case 'today':
      return wholeDate(today);
    case 'today_day':
      return part(today, 'day');
    case 'today_month':
      return part(today, 'month');
    case 'today_year':
      return part(today, 'year');
    case 'today_year_short':
      return part(today, 'yearShort');
  }
}
