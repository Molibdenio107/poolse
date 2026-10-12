import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

/**
 * A list in a PDF, read as a spreadsheet — Rui, 12 October 2026.
 *
 * Clubs keep registers, timetables, partner lists and pay lists as PDFs printed
 * from older systems. This turns the tables in one into the same header-and-rows
 * shape a spreadsheet gives `readSheet`, so the PDF then goes through each
 * importer's ordinary column mapping, preview and commit — one pipeline, the
 * rule every document importer here follows. Nothing is written until a person
 * has seen the preview.
 *
 * **Off unless switched on**, like every metered call (CLAUDE.md, the free-pilot
 * cost rule): `PDF_TABLE_AI_ENABLED=true` and `ANTHROPIC_API_KEY`. The document
 * is sent as it is and nothing else about the club goes with it.
 *
 * **It transcribes; it never interprets.** The prompt asks for the table as
 * printed — the header row as written, cells as written, nothing normalised —
 * because the matcher and the preview are where meaning is decided, and a model
 * that "fixed" a date or a name would be a second, invisible importer.
 *
 * Structured output rather than a forced tool call: the current Opus refuses a
 * forced `tool_choice`, and a JSON schema on the reply is the supported way to
 * get exactly this shape back.
 */

const MODEL = process.env['POOLSE_PDF_TABLE_MODEL'] ?? 'claude-opus-5-5';

const MAX_BYTES = 12 * 1024 * 1024;

const SYSTEM = [
  'You transcribe tables from documents into structured data. The documents are',
  'lists kept by swimming clubs in Portugal: student registers, class timetables,',
  'lists of partner schools and their groups, staff pay lists, stock lists.',
  '',
  'Return every table in the document. For each table give its header row exactly',
  'as printed, then every data row, one string per cell, in the same column order',
  'as the header. A table that continues across pages is ONE table: repeat its',
  'header once, not per page. Skip page headers, footers, page numbers and totals',
  'rows that are not data.',
  '',
  'Copy every cell exactly as written: keep accents, capitals, the decimal comma,',
  'dates in the shape printed, leading zeros. Never translate, convert, round,',
  'reorder or complete a value. An empty cell is an empty string. If a cell is',
  'illegible, leave it empty rather than guessing — a blank is a question on the',
  'preview, a guess is a wrong record.',
  '',
  'A timetable printed as a grid (days across, times down) is a table too: the',
  'first row is the header of days, each following row starts with its time.',
  '',
  'Name each table with its printed title if it has one, otherwise "Tabela 1",',
  '"Tabela 2", in document order.',
].join('\n');

const SCHEMA = {
  type: 'object',
  properties: {
    tables: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          header: { type: 'array', items: { type: 'string' } },
          rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
        },
        required: ['name', 'header', 'rows'],
        additionalProperties: false,
      },
    },
  },
  required: ['tables'],
  additionalProperties: false,
} as const;

export interface PdfTable {
  name: string;
  /** Header first, then the data rows — the grid `toSheet` takes. */
  grid: string[][];
}

export type PdfTableResult =
  | { tables: PdfTable[] }
  | { error: 'disabled' | 'unreadable' | 'nothingFound' };

export function pdfTablesAvailable(): boolean {
  return (
    (process.env['PDF_TABLE_AI_ENABLED'] ?? '').trim().toLowerCase() === 'true' &&
    (process.env['ANTHROPIC_API_KEY'] ?? '').trim() !== ''
  );
}

function strings(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((cell) => typeof cell === 'string')
    ? (value as string[])
    : null;
}

/** Narrowed by hand: the reply is somebody else's JSON until proven otherwise. */
function readTables(value: unknown): PdfTable[] {
  const tables = (value as { tables?: unknown } | null)?.tables;
  if (!Array.isArray(tables)) return [];
  const out: PdfTable[] = [];
  for (const table of tables) {
    const name = (table as { name?: unknown }).name;
    const header = strings((table as { header?: unknown }).header);
    const rawRows = (table as { rows?: unknown }).rows;
    if (typeof name !== 'string' || header === null || !Array.isArray(rawRows)) continue;
    const rows = rawRows.map(strings).filter((row): row is string[] => row !== null);
    if (header.length === 0 || rows.length === 0) continue;
    out.push({ name, grid: [header, ...rows] });
  }
  return out;
}

export async function readPdfTables(bytes: ArrayBuffer): Promise<PdfTableResult> {
  if (!pdfTablesAvailable()) return { error: 'disabled' };
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return { error: 'unreadable' };

  try {
    const client = new Anthropic();
    // Streamed: a forty-page register is a long answer, and a non-streamed call
    // that long risks the HTTP timeout rather than the model.
    const response = await client.beta.messages
      .stream(
        {
          model: MODEL,
          // A declined read is retried on the model the API picks for that
          // category, inside the same call, rather than failing the import.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          max_tokens: 64000,
          system: SYSTEM,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'document',
                  source: {
                    type: 'base64',
                    media_type: 'application/pdf',
                    data: Buffer.from(bytes).toString('base64'),
                  },
                },
                { type: 'text', text: 'Transcribe every table in this document.' },
              ],
            },
          ],
          output_config: { format: { type: 'json_schema', schema: SCHEMA } },
        },
        { timeout: 180_000 },
      )
      .finalMessage();

    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
      return { error: 'unreadable' };
    }
    const text = response.content
      .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
    const tables = readTables(JSON.parse(text));
    return tables.length === 0 ? { error: 'nothingFound' } : { tables };
  } catch {
    // Rate limited, timed out, a bad key, a PDF the API refuses, a reply that
    // is not JSON. All one thing to the operator: this file could not be read,
    // and a spreadsheet still can.
    return { error: 'unreadable' };
  }
}
