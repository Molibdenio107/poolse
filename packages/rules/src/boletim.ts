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
  // The FPN declaration's own (POOLSE-142, second half).
  'signer_name',
  'season',
  'fpn_association',
  'fpn_club_code',
  'fpn_place',
  'id_document_type',
  'id_document_issued_on',
  'id_document_valid_until',
  'discipline_pura',
  'discipline_open_water',
  'discipline_water_polo',
  'discipline_artistic',
  'discipline_adapted',
  'discipline_masters',
  'discipline_diving',
] as const;

export type BoletimField = (typeof BOLETIM_FIELDS)[number];

export function isBoletimField(value: unknown): value is BoletimField {
  return typeof value === 'string' && (BOLETIM_FIELDS as readonly string[]).includes(value);
}

/** The fields whose value is read only when a template places them (rule 5). */
export const GUARDED_BOLETIM_FIELDS: ReadonlySet<BoletimField> = new Set(['id_document_number', 'sns_number']);

/**
 * A club's own forms (POOLSE-142): the boletim de sócio and the FPN's
 * declaration, adult and minor — spelled as `student_document.kind` spells the
 * signed copies. One live template per club and kind.
 */
export const TEMPLATE_KINDS = ['socio_form', 'fpn_declaration', 'fpn_declaration_minor'] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export function isTemplateKind(value: unknown): value is TemplateKind {
  return typeof value === 'string' && (TEMPLATE_KINDS as readonly string[]).includes(value);
}

export interface FieldGroup {
  key: string;
  fields: readonly BoletimField[];
}

/** The modalidades' boxes, in the FPN's order — an X where the student's record ticks it. */
export const DISCIPLINE_FIELDS = [
  'discipline_pura',
  'discipline_open_water',
  'discipline_water_polo',
  'discipline_artistic',
  'discipline_adapted',
  'discipline_masters',
  'discipline_diving',
] as const satisfies readonly BoletimField[];

/** The FPN declaration's groups: what Poolse's own Anexo 2 already prints, no more. */
const FPN_FIELD_GROUPS: readonly FieldGroup[] = [
  { key: 'person', fields: ['signer_name', 'name'] },
  { key: 'contact', fields: ['address_line', 'locality', 'postal_code'] },
  { key: 'documents', fields: ['id_document_type', 'id_document_number', 'id_document_issued_on', 'id_document_valid_until'] },
  { key: 'fpn', fields: ['season', 'fpn_association', 'fpn_club_code', 'fpn_place'] },
  { key: 'disciplines', fields: DISCIPLINE_FIELDS },
  { key: 'today', fields: ['today', 'today_day', 'today_month', 'today_year', 'today_year_short'] },
];

/** The editor's groups for a kind, in the order its paper form usually asks. */
export function fieldGroupsFor(kind: TemplateKind): readonly FieldGroup[] {
  return kind === 'socio_form' ? BOLETIM_FIELD_GROUPS : FPN_FIELD_GROUPS;
}

/** Every field a kind may place — the API refuses any other on save. */
export function fieldsFor(kind: TemplateKind): ReadonlySet<BoletimField> {
  return new Set(fieldGroupsFor(kind).flatMap((group) => group.fields));
}

/** The boletim's groups, in the order a paper form usually asks. */
export const BOLETIM_FIELD_GROUPS: readonly FieldGroup[] = [
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
  /**
   * The white strip under the value, as a fraction of the page's width from x
   * to where the blank ends (Rui, 01-11-2026): it covers whatever the scan has
   * on that line. Absent or null is no strip; a tick box never has one.
   */
  width?: number | null;
}

/** A tick box's field — it prints an X centred on its point, and takes no strip. */
export function isTickField(field: BoletimField): boolean {
  return field.startsWith('discipline_');
}

/** The strip a new text placement starts with, kept on the page. */
export function defaultStripWidth(field: BoletimField, x: number): number | null {
  if (isTickField(field)) return null;
  return Math.max(0.02, Math.round(Math.min(0.3, 0.98 - x) * 10000) / 10000);
}

export const BOLETIM_SIZE_MIN = 6;
export const BOLETIM_SIZE_MAX = 24;
export const BOLETIM_SIZE_DEFAULT = 11;

/** A placement as the API receives it, or null when any part is wrong. */
export function parseBoletimPlacement(raw: unknown): BoletimPlacement | null {
  if (raw === null || typeof raw !== 'object') return null;
  const { field, x, y, sizePt, width } = raw as Record<string, unknown>;
  if (!isBoletimField(field)) return null;
  const onPage = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
  if (!onPage(x) || !onPage(y)) return null;
  const size = sizePt === undefined ? BOLETIM_SIZE_DEFAULT : sizePt;
  if (typeof size !== 'number' || !Number.isFinite(size) || size < BOLETIM_SIZE_MIN || size > BOLETIM_SIZE_MAX) return null;
  let strip: number | null = null;
  if (width !== undefined && width !== null) {
    if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0 || x + width > 1.0001) return null;
    strip = isTickField(field) ? null : Math.round(width * 10000) / 10000;
  }
  // The columns are numeric(5,4) and numeric(4,1): round here so what is saved is what was sent.
  return {
    field,
    x: Math.round(x * 10000) / 10000,
    y: Math.round(y * 10000) / 10000,
    sizePt: Math.round(size * 10) / 10,
    width: strip,
  };
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
  /** The FPN declaration's own, absent on a boletim. Words already in Portuguese. */
  fpn?: {
    signerName: string | null;
    season: string | null;
    association: string | null;
    clubCode: string | null;
    place: string | null;
    idDocumentType: string | null;
    /** `YYYY-MM-DD`. */
    issuedOn: string | null;
    validUntil: string | null;
    /** The student's own ticks (`FPN_DISCIPLINES` keys). */
    disciplines: readonly string[];
  };
}

/** `YYYY-MM-DD` as the boletim writes a whole date: dd-MM-yyyy, the product's one shape. */
function wholeDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}-${month}-${year}`;
}

/** A date on the FPN's own form is dd/MM/yyyy, as that form writes it (POOLSE-132). */
function fpnDate(iso: string | null): string | null {
  return iso === null || !/^\d{4}-\d{2}-\d{2}$/.test(iso) ? null : wholeDate(iso).replaceAll('-', '/');
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
    case 'signer_name':
      return blank(data.fpn?.signerName);
    case 'season':
      return blank(data.fpn?.season);
    case 'fpn_association':
      return blank(data.fpn?.association);
    case 'fpn_club_code':
      return blank(data.fpn?.clubCode);
    case 'fpn_place':
      return blank(data.fpn?.place);
    case 'id_document_type':
      return blank(data.fpn?.idDocumentType);
    case 'id_document_issued_on':
      return fpnDate(data.fpn?.issuedOn ?? null);
    case 'id_document_valid_until':
      return fpnDate(data.fpn?.validUntil ?? null);
    case 'discipline_pura':
    case 'discipline_open_water':
    case 'discipline_water_polo':
    case 'discipline_artistic':
    case 'discipline_adapted':
    case 'discipline_masters':
    case 'discipline_diving':
      // A tick on the student's own Documentos tab, never derived from a level.
      return data.fpn?.disciplines.includes(field.slice('discipline_'.length)) === true ? 'X' : null;
  }
}

/**
 * A model's proposed layout, judged (POOLSE-142 slice B): `{ placements: [{ field, x, y }] }`
 * on a 0–1000 grid becomes page fractions at the default size. An unknown field,
 * a point off the grid or a repeat of the same spot is dropped; at most `limit`.
 */
export function placementsFromGrid(raw: unknown, limit = 60): BoletimPlacement[] {
  const list = (raw as { placements?: unknown } | null)?.placements;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: BoletimPlacement[] = [];
  for (const item of list) {
    const { field, x, y, end } = (item ?? {}) as Record<string, unknown>;
    if (!isBoletimField(field)) continue;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < 0 || x > 1000 || y < 0 || y > 1000) continue;
    const spot = `${field}:${Math.round(x / 10)}:${Math.round(y / 10)}`;
    if (seen.has(spot)) continue;
    seen.add(spot);
    // Where the blank line ends gives the strip; without one, the default length.
    const width =
      isTickField(field)
        ? null
        : typeof end === 'number' && Number.isFinite(end) && end > x && end <= 1000
          ? Math.round(end - x) / 1000
          : defaultStripWidth(field, x / 1000);
    out.push({ field, x: Math.round(x * 10) / 10000, y: Math.round(y * 10) / 10000, sizePt: BOLETIM_SIZE_DEFAULT, width });
    if (out.length >= limit) break;
  }
  return out;
}
