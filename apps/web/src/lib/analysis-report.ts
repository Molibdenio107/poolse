import { POOL_METRICS, type PoolMetric } from './pool-metrics.ts';

/**
 * A laboratory's analysis report — what one is, and what reading one produces.
 *
 * Round 6, ticket 1. The other half of the water importer: a club gets its water
 * tested two ways, and only one of them arrives as columns. Somebody walks the
 * tank with a photometer and writes the numbers into a spreadsheet — that is a
 * `MatchSpec` and has been since round 5 — or a laboratory sends back a one-page
 * report as a PDF, which no column mapping could describe.
 *
 * **Pure, and separate from the thing that calls a model**, exactly as
 * `sheet.ts` is separate from `read-sheet.ts`. The wizard needs
 * `reportMediaType` in the browser to tell a report from a spreadsheet before it
 * uploads anything, and `readRows` is the part worth testing — so neither may
 * sit behind `server-only`. `analysis-report-agent.ts` holds the API key, the
 * document block and the prompt.
 *
 * **The interface, not the model, is the point.** `AnalysisReportParser` is what
 * the wizard talks to: give it a file, get back rows in exactly the shape the
 * mapping step produces, so everything downstream — validate, preview, commit —
 * is the code path a spreadsheet already walks. That is what makes this a second
 * *way in* rather than a second pipeline, which CLAUDE.md forbids for good
 * reason: what the operator was shown and what gets written must come from one
 * place.
 *
 * It is also the seam the ticket asks for. When the Excel mapping grows an
 * assisted step it will want what this has — a configured client, a strict tool
 * schema, and an answer believed only as far as it can be checked — and it can
 * implement this interface to get it.
 */

/** The fields a report can fill — the water importer's own, minus nothing. */
export type ReportField = 'takenOn' | 'takenTime' | 'pool' | 'notes' | PoolMetric;

/** One extracted analysis, keyed exactly as `applyWaterMapping` keys a row. */
export type ReportRow = Partial<Record<ReportField, string>>;

export const REPORT_FIELDS: ReportField[] = [
  'takenOn',
  'takenTime',
  'pool',
  'notes',
  ...POOL_METRICS,
];

/**
 * What a document may be.
 *
 * PDFs and pictures both, because a club as often photographs the sheet pinned
 * up in the plant room as receives a PDF. The list is the intersection of what
 * the API accepts and what a phone produces.
 */
export const REPORT_MEDIA_TYPES = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
} as const;

export type DocumentMediaType = (typeof REPORT_MEDIA_TYPES)[keyof typeof REPORT_MEDIA_TYPES];

export interface ReportFile {
  name: string;
  /** The IANA type, already narrowed to something a parser accepts. */
  mediaType: DocumentMediaType;
  /** The bytes, read on the Next server and never persisted. */
  bytes: Buffer;
}

/**
 * Why a parse produced nothing, in the operator's terms rather than the
 * transport's.
 *
 * `disabled` is deliberately not treated as an error anywhere it is handled: it
 * is the answer to "can this club do this yet", and the screen says so plainly
 * instead of showing a failure.
 */
export type ReportFailure = 'disabled' | 'unreadable' | 'nothingFound';

export type ReportResult = { rows: ReportRow[] } | { error: ReportFailure };

export interface AnalysisReportParser {
  /** Whether asking is worth anything. False means every parse returns `disabled`. */
  available(): boolean;
  parse(file: ReportFile): Promise<ReportResult>;
}

/** The media type for a file name, or null when it is not a report at all. */
export function reportMediaType(fileName: string): DocumentMediaType | null {
  const lower = fileName.toLowerCase();
  for (const [extension, mediaType] of Object.entries(REPORT_MEDIA_TYPES)) {
    if (lower.endsWith(extension)) return mediaType;
  }
  return null;
}

/**
 * A parser's answer, believed only as far as it can be checked.
 *
 * A strict tool schema makes a malformed answer unlikely; this makes one
 * harmless, which is the property that matters. Every key is checked against the
 * field list, every value is coerced to trimmed text, and a row that ends up
 * empty is dropped rather than becoming a preview line with nothing on it.
 *
 * Nothing here decides whether a reading is *right* — that is
 * `validateAnalysisRows` on the API, which the extracted rows go through exactly
 * as a spreadsheet's do. A model that misreads a decimal point produces a number
 * somebody rejects on the preview, not a safety record that is quietly wrong.
 */
export function readRows(raw: unknown): ReportRow[] {
  if (raw === null || typeof raw !== 'object') return [];
  const analyses = (raw as { analyses?: unknown }).analyses;
  if (!Array.isArray(analyses)) return [];

  const allowed = new Set<string>(REPORT_FIELDS);
  const rows: ReportRow[] = [];

  for (const entry of analyses) {
    if (entry === null || typeof entry !== 'object') continue;

    const row: ReportRow = {};
    for (const [key, value] of Object.entries(entry as Record<string, unknown>)) {
      if (!allowed.has(key)) continue;
      // A number is as likely an answer as a string and means the same thing;
      // anything else is not a reading.
      const text = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
      if (text.trim() !== '') row[key as ReportField] = text.trim();
    }

    if (Object.keys(row).length > 0) rows.push(row);
  }

  return rows;
}
