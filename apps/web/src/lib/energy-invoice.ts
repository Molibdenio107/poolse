import { reportMediaType, type DocumentMediaType, type ReportFile } from './analysis-report.ts';

/**
 * An electricity bill — what one is, and how a draft of one becomes a request.
 *
 * Slice 5.3. The shape was read off two real EDP documents rather than
 * imagined, and three facts of theirs are the reason for everything below:
 * one PDF bundles several faturas and only one is electricity; the dial has
 * registers (vazio, ponta, cheias) even on a Simples tariff, which sums them;
 * and the billed lines are split by VAT rate, carry discounts, and price power
 * per day. Every supplier prints these differently; every supplier has them.
 *
 * **Pure, and separate from the thing that calls a model**, exactly as
 * `analysis-report.ts` is separate from `-agent.ts`. The form needs the draft
 * shape in the browser, the round-trip test needs `draftToBody`, and neither
 * may sit behind `server-only`.
 *
 * **A draft is strings.** Whatever produced it — a person typing "15,41" or a
 * model copying "15,41 €" off a page — the value is text until `draftToBody`
 * turns it into the number the API wants, in one place, with one rule for the
 * decimal comma. That is what makes the two ways in one pipeline: the import
 * fills the form, and the form is what gets sent.
 */

export const REGISTERS = ['vazio', 'ponta', 'cheias', 'super_vazio', 'total'] as const;
export type RegisterName = (typeof REGISTERS)[number];

export const TARIFF_PERIODS = [
  'simples', 'ponta', 'cheias', 'vazio_normal', 'super_vazio', 'fora_vazio', 'vazio',
] as const;
export type TariffPeriod = (typeof TARIFF_PERIODS)[number];

export const LINE_KINDS = ['energy', 'power', 'discount', 'tax', 'other'] as const;
export type LineKind = (typeof LINE_KINDS)[number];

export interface RegisterDraft {
  register: RegisterName;
  previousIndex: string;
  currentIndex: string;
  kwh: string;
}

export interface LineDraft {
  kind: LineKind;
  description: string;
  period: TariffPeriod | '';
  fromOn: string;
  toOn: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  amount: string;
  discount: string;
  total: string;
  vatRate: string;
}

/** The header fields, all text. Dates are `YYYY-MM-DD`, money is euros as written. */
export interface InvoiceDraft {
  supplier: string;
  invoiceNumber: string;
  atcud: string;
  documentReference: string;
  issuedOn: string;
  periodStart: string;
  periodEnd: string;
  dueOn: string;
  contractedPowerKva: string;
  tariff: string;
  cycle: string;
  readingQuality: 'real' | 'estimated' | '';
  cpe: string;
  meterSerial: string;
  subtotal: string;
  vat: string;
  total: string;
  otherCharges: string;
  documentTotal: string;
  networkAccess: string;
  regulatedDifference: string;
  notes: string;
  registers: RegisterDraft[];
  lines: LineDraft[];
}

/** The header keys a model may fill — one name per field, shared with the form. */
export const INVOICE_HEADER_FIELDS = [
  'supplier', 'invoiceNumber', 'atcud', 'documentReference',
  'issuedOn', 'periodStart', 'periodEnd', 'dueOn',
  'contractedPowerKva', 'tariff', 'cycle', 'readingQuality', 'cpe', 'meterSerial',
  'subtotal', 'vat', 'total', 'otherCharges', 'documentTotal',
  'networkAccess', 'regulatedDifference', 'notes',
] as const;

export const REGISTER_FIELDS = ['register', 'previousIndex', 'currentIndex', 'kwh'] as const;
export const LINE_FIELDS = [
  'kind', 'description', 'period', 'fromOn', 'toOn', 'quantity', 'unit',
  'unitPrice', 'amount', 'discount', 'total', 'vatRate',
] as const;

export function emptyLine(kind: LineKind = 'energy'): LineDraft {
  return {
    kind, description: '', period: kind === 'energy' ? 'simples' : '', fromOn: '', toOn: '',
    quantity: '', unit: kind === 'energy' ? 'kWh' : kind === 'power' ? 'dias' : '',
    unitPrice: '', amount: '', discount: '', total: '', vatRate: '',
  };
}

export function emptyRegister(register: RegisterName): RegisterDraft {
  return { register, previousIndex: '', currentIndex: '', kwh: '' };
}

/** A blank bill: three registers as an EDP dial has, one energy line, one power line. */
export function emptyInvoiceDraft(): InvoiceDraft {
  return {
    supplier: '', invoiceNumber: '', atcud: '', documentReference: '',
    issuedOn: '', periodStart: '', periodEnd: '', dueOn: '',
    contractedPowerKva: '', tariff: '', cycle: '', readingQuality: '', cpe: '', meterSerial: '',
    subtotal: '', vat: '', total: '', otherCharges: '', documentTotal: '',
    networkAccess: '', regulatedDifference: '', notes: '',
    registers: [emptyRegister('vazio'), emptyRegister('ponta'), emptyRegister('cheias')],
    lines: [emptyLine('energy'), emptyLine('power')],
  };
}

// ---------------------------------------------------------------------------
// Numbers as a Portuguese bill writes them
// ---------------------------------------------------------------------------

/**
 * "15,41 €", "1 541,00", "-0,62 €", "0,1675", "1.541,00" → a number, or null.
 *
 * The decimal mark is the comma when there is one; a lone point with three
 * digits after it is a thousands separator ("1.541"), otherwise a decimal
 * ("0.1675" from an English keyboard). Currency signs, units and spaces are
 * noise. One rule, here, for the form and the model alike.
 */
export function parseDecimal(text: string | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  let s = text.replace(/[€%]|kwh|kva|dias?|m[êe]s/gi, '').replace(/\s+/g, '').trim();
  if (s === '') return null;
  const negative = s.startsWith('-') || s.startsWith('−') || (s.startsWith('(') && s.endsWith(')'));
  s = s.replace(/^[-−(]|\)$/g, '');
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** Euros as written → integer cents, or null. Rounds half away from zero. */
export function toCents(text: string | null | undefined): number | null {
  const n = parseDecimal(text);
  if (n === null) return null;
  return Math.sign(n) * Math.round(Math.abs(n) * 100);
}

/** Cents → the text the form shows: "41,36". */
export function centsToText(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)},${`${abs % 100}`.padStart(2, '0')}`;
}

/**
 * A date as a Portuguese bill prints it → `YYYY-MM-DD`, or null.
 *
 * "26/10/2025", "26-10-2025", "2025-10-26", "26 de outubro de 2025",
 * "26 out 2025", "26 de outubro a 25 de novembro 2025" (the first date).
 */
export function parseDate(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  const s = text.trim().toLowerCase();
  if (s === '') return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso !== null) return validDate(iso[1]!, iso[2]!, iso[3]!);

  const numeric = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(s);
  if (numeric !== null) return validDate(numeric[3]!, numeric[2]!, numeric[1]!);

  // "28 de novembro 2025", "23 dez 2025", and the first date of a range whose
  // year is printed once at the end: "26 de outubro a 25 de novembro 2025".
  const worded = /^(\d{1,2})\s+(?:de\s+)?([a-zç]+)\.?/.exec(s);
  if (worded !== null) {
    const month = MONTHS[worded[2]!.slice(0, 3)];
    const year = /(?<!\d)(\d{4})(?!\d)/.exec(s.slice(worded[0].length));
    if (month !== undefined && year !== null) return validDate(year[1]!, month, worded[1]!);
  }
  return null;
}

const MONTHS: Record<string, string> = {
  jan: '01', fev: '02', feb: '02', mar: '03', abr: '04', apr: '04', mai: '05', may: '05',
  jun: '06', jul: '07', ago: '08', aug: '08', set: '09', sep: '09', out: '10', oct: '10',
  nov: '11', dez: '12', dec: '12',
};

function validDate(y: string, m: string, d: string): string | null {
  const mm = m.padStart(2, '0');
  const dd = d.padStart(2, '0');
  const stamp = `${y}-${mm}-${dd}`;
  // Round-tripped, because `Date` rolls 31 February over into March rather
  // than refusing it, and a bill dated the 31st of February is a misread.
  const parsed = new Date(`${stamp}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === stamp ? stamp : null;
}

// ---------------------------------------------------------------------------
// What a model said, believed only as far as it can be checked
// ---------------------------------------------------------------------------

/**
 * A parser's answer as a draft. Every key is checked against the field lists,
 * every value is coerced to trimmed text, an unknown register or kind is
 * dropped. Nothing here decides whether the bill is *right* — the preview does,
 * on the API, exactly as it does for a bill somebody typed.
 */
export function readInvoiceDraft(raw: unknown): InvoiceDraft | null {
  if (raw === null || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const draft = emptyInvoiceDraft();

  for (const field of INVOICE_HEADER_FIELDS) {
    const value = asText(source[field]);
    if (value === '') continue;
    if (field === 'readingQuality') {
      draft.readingQuality = value === 'real' || value === 'estimated' ? value : '';
    } else {
      draft[field] = value;
    }
  }

  const registers = Array.isArray(source['registers']) ? source['registers'] : [];
  const seen: RegisterDraft[] = [];
  for (const entry of registers) {
    if (entry === null || typeof entry !== 'object') continue;
    const r = entry as Record<string, unknown>;
    const register = asText(r['register']) as RegisterName;
    if (!REGISTERS.includes(register) || seen.some((x) => x.register === register)) continue;
    seen.push({
      register,
      previousIndex: asText(r['previousIndex']),
      currentIndex: asText(r['currentIndex']),
      kwh: asText(r['kwh']),
    });
  }
  if (seen.length > 0) draft.registers = seen;

  const lines = Array.isArray(source['lines']) ? source['lines'] : [];
  const kept: LineDraft[] = [];
  for (const entry of lines) {
    if (entry === null || typeof entry !== 'object') continue;
    const l = entry as Record<string, unknown>;
    const kind = asText(l['kind']) as LineKind;
    if (!LINE_KINDS.includes(kind)) continue;
    const period = asText(l['period']) as TariffPeriod;
    kept.push({
      kind,
      description: asText(l['description']),
      period: TARIFF_PERIODS.includes(period) ? period : '',
      fromOn: asText(l['fromOn']),
      toOn: asText(l['toOn']),
      quantity: asText(l['quantity']),
      unit: asText(l['unit']),
      unitPrice: asText(l['unitPrice']),
      amount: asText(l['amount']),
      discount: asText(l['discount']),
      total: asText(l['total']),
      vatRate: asText(l['vatRate']),
    });
  }
  if (kept.length > 0) draft.lines = kept;

  // Dates as the model copied them, normalised once so the form's date inputs
  // can show them. A date it could not read stays as text, and the preview
  // names the field.
  for (const field of ['issuedOn', 'periodStart', 'periodEnd', 'dueOn'] as const) {
    const parsed = parseDate(draft[field]);
    if (parsed !== null) draft[field] = parsed;
  }
  for (const line of draft.lines) {
    for (const field of ['fromOn', 'toOn'] as const) {
      const parsed = parseDate(line[field]);
      if (parsed !== null) line[field] = parsed;
    }
  }

  const isEmpty = draft.supplier === '' && draft.invoiceNumber === '' && draft.total === '';
  return isEmpty ? null : draft;
}

function asText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

// ---------------------------------------------------------------------------
// From the draft to the request
// ---------------------------------------------------------------------------

export interface InvoiceBody {
  body: Record<string, unknown>;
  /** Fields that would not parse — beside their box, before the API is asked. */
  fields: Record<string, string>;
}

/**
 * The draft as the API wants it: numbers, cents, ISO dates. Field names are
 * the API's; the error keys are the catalogue's.
 *
 * A required money field that will not parse is an error here rather than a
 * 400 from the API, because the API would say "whole cents" and the person
 * typed "46,23" — the translation is ours to make.
 */
export function draftToBody(
  draft: InvoiceDraft,
  options: { source: 'manual' | 'import'; sourceFileName?: string | null; commit?: boolean },
): InvoiceBody {
  const fields: Record<string, string> = {};

  const money = (field: keyof InvoiceDraft, required: boolean): number | null => {
    const text = draft[field] as string;
    if (text.trim() === '') {
      if (required) fields[field] = 'energy.invoice.required';
      return null;
    }
    const cents = toCents(text);
    if (cents === null) fields[field] = 'energy.invoice.notANumber';
    return cents;
  };
  const dateOf = (field: 'issuedOn' | 'periodStart' | 'periodEnd' | 'dueOn', required: boolean): string | null => {
    if (draft[field].trim() === '') {
      if (required) fields[field] = 'energy.invoice.required';
      return null;
    }
    const parsed = parseDate(draft[field]);
    if (parsed === null) fields[field] = 'energy.invoice.notADate';
    return parsed;
  };
  const number = (text: string, field: string): number | null => {
    if (text.trim() === '') return null;
    const n = parseDecimal(text);
    if (n === null) fields[field] = 'energy.invoice.notANumber';
    return n;
  };

  if (draft.supplier.trim() === '') fields['supplier'] = 'energy.invoice.required';
  if (draft.invoiceNumber.trim() === '') fields['invoiceNumber'] = 'energy.invoice.required';

  const registers = draft.registers
    .filter((r) => r.kwh.trim() !== '' || r.previousIndex.trim() !== '' || r.currentIndex.trim() !== '')
    .map((r, i) => {
      const previousIndex = number(r.previousIndex, `registers.${i}.previousIndex`);
      const currentIndex = number(r.currentIndex, `registers.${i}.currentIndex`);
      let kwh = number(r.kwh, `registers.${i}.kwh`);
      // A dial with both indexes and no kWh: the difference is the kWh.
      if (kwh === null && previousIndex !== null && currentIndex !== null) kwh = currentIndex - previousIndex;
      if (kwh === null) fields[`registers.${i}.kwh`] = 'energy.invoice.required';
      return { register: r.register, previousIndex, currentIndex, kwh: kwh ?? 0 };
    });

  const lines = draft.lines
    .filter((l) => l.description.trim() !== '' || l.total.trim() !== '' || l.amount.trim() !== '')
    .map((l, i) => {
      const amountCents = toCents(l.amount);
      const discountCents = l.discount.trim() === '' ? 0 : toCents(l.discount);
      let totalCents = l.total.trim() === '' ? null : toCents(l.total);
      if (l.amount.trim() !== '' && amountCents === null) fields[`lines.${i}.amount`] = 'energy.invoice.notANumber';
      if (l.discount.trim() !== '' && discountCents === null) fields[`lines.${i}.discount`] = 'energy.invoice.notANumber';
      if (l.total.trim() !== '' && totalCents === null) fields[`lines.${i}.total`] = 'energy.invoice.notANumber';
      // Total s/IVA left blank: amount less the discount, as the bill computes it.
      if (totalCents === null && amountCents !== null) totalCents = amountCents - Math.abs(discountCents ?? 0);
      if (l.description.trim() === '') fields[`lines.${i}.description`] = 'energy.invoice.required';
      if (totalCents === null) fields[`lines.${i}.total`] = 'energy.invoice.required';
      return {
        kind: l.kind,
        description: l.description.trim(),
        period: l.period === '' ? null : l.period,
        fromOn: l.fromOn.trim() === '' ? null : parseDate(l.fromOn),
        toOn: l.toOn.trim() === '' ? null : parseDate(l.toOn),
        quantity: number(l.quantity, `lines.${i}.quantity`),
        unit: l.unit.trim() === '' ? null : l.unit.trim(),
        unitPrice: number(l.unitPrice, `lines.${i}.unitPrice`),
        amountCents: amountCents ?? totalCents ?? 0,
        discountCents: Math.abs(discountCents ?? 0),
        totalCents: totalCents ?? 0,
        vatRate: number(l.vatRate, `lines.${i}.vatRate`),
      };
    });

  const subtotalCents = money('subtotal', true);
  const vatCents = money('vat', true);
  const totalCents = money('total', true);
  const otherChargesCents = money('otherCharges', false) ?? 0;
  // The envelope's total left blank is the electricity total plus the rest.
  const documentTotalCents =
    draft.documentTotal.trim() === ''
      ? (totalCents ?? 0) + otherChargesCents
      : money('documentTotal', true);

  const body: Record<string, unknown> = {
    supplier: draft.supplier.trim(),
    invoiceNumber: draft.invoiceNumber.trim(),
    atcud: blankToNull(draft.atcud),
    documentReference: blankToNull(draft.documentReference),
    issuedOn: dateOf('issuedOn', true),
    periodStart: dateOf('periodStart', true),
    periodEnd: dateOf('periodEnd', true),
    dueOn: dateOf('dueOn', false),
    contractedPowerKva: number(draft.contractedPowerKva, 'contractedPowerKva'),
    tariff: blankToNull(draft.tariff),
    cycle: blankToNull(draft.cycle),
    readingQuality: draft.readingQuality === '' ? null : draft.readingQuality,
    cpe: blankToNull(draft.cpe),
    meterSerial: blankToNull(draft.meterSerial),
    subtotalCents,
    vatCents,
    totalCents,
    otherChargesCents,
    documentTotalCents,
    networkAccessCents: money('networkAccess', false),
    regulatedDifferenceCents: money('regulatedDifference', false),
    notes: blankToNull(draft.notes),
    source: options.source,
    sourceFileName: options.sourceFileName ?? null,
    registers,
    lines,
    ...(options.commit === true ? { commit: true } : {}),
  };

  return { body, fields };
}

function blankToNull(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === '' ? null : trimmed;
}

/** The parser's contract — the same shape as `AnalysisReportParser`, answering a draft. */
export type InvoiceParseResult =
  | { draft: InvoiceDraft }
  | { error: 'disabled' | 'unreadable' | 'nothingFound' };

export interface EnergyInvoiceParser {
  available(): boolean;
  parse(file: ReportFile): Promise<InvoiceParseResult>;
}

export { reportMediaType, type DocumentMediaType, type ReportFile };
