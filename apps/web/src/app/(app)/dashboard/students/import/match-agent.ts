import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import type { ColumnMatch, ColumnShape, ImportField } from '@/lib/sheet';

/**
 * The columns the heuristic could not place, handed to Claude.
 *
 * The matcher in `lib/sheet.ts` does the work: exact names, whole-word
 * containment, abbreviations, and the shape of the values. It settles almost
 * every real club spreadsheet on its own, for free and offline. What it cannot
 * do is the long tail — "Resp.", "Contacto 1", a Spanish sheet, a typo — and
 * that is all this is for.
 *
 * **Three rules make it safe to depend on:**
 *
 * - **It is optional.** No `ANTHROPIC_API_KEY`, no call, no difference: the
 *   import behaves exactly as it did before this file existed. This is the
 *   onboarding path, and it must not acquire a hard dependency on somebody
 *   else's uptime.
 * - **It never sees the spreadsheet.** Only headers and the *shape* of each
 *   column — "9 digits", "email", "78% filled". A register of children's names
 *   and their mothers' telephone numbers is not something to send to an API to
 *   save an operator a dropdown, and the shape carries the signal anyway.
 * - **It cannot say "certain".** Its confident answers are folded away like any
 *   other confident match, but the preview still shows every resolved row before
 *   a single one is written. Nothing it decides escapes that check.
 */

/** The model, overridable so the choice stays an operator's rather than a build's. */
const MODEL = process.env['POOLSE_COLUMN_MATCH_MODEL'] ?? 'claude-opus-5';

/** Beyond this, the sheet is strange enough that a person should look at it. */
const MAX_COLUMNS = 40;

const TOOL_NAME = 'assign_columns';

export interface AgentInput {
  /** Shapes for the columns nothing has claimed. */
  columns: ColumnShape[];
  /** The fields still without a column, with the label the operator would see. */
  fields: { field: ImportField; label: string }[];
}

interface Assignment {
  column: number;
  field: string;
  confidence: 'high' | 'low';
}

/**
 * Whether the agent is configured at all.
 *
 * Exported so the caller can skip building the input — and so a future settings
 * screen can say "column matching assistance: off" rather than the feature being
 * invisibly absent.
 */
export function agentAvailable(): boolean {
  return (process.env['ANTHROPIC_API_KEY'] ?? '').trim() !== '';
}

const SYSTEM = [
  'You map spreadsheet columns onto the fields of a swimming club register.',
  '',
  'The spreadsheets are Portuguese, and mostly written by hand by club staff, so',
  'headings are abbreviated ("Enc. Educação", "Tlm", "Dt Nasc"), inconsistent, or',
  'occasionally missing altogether. You are given each unplaced column: its',
  'heading, how full it is, and a description of what its values look like. You',
  'are never given the values themselves.',
  '',
  'Assign a column to a field only when you would bet on it. Leave it out',
  'otherwise — an unassigned column is one question for the operator, while a',
  'wrongly assigned one silently corrupts hundreds of student records.',
  '',
  'Use confidence "high" only when the heading names the field or abbreviates it',
  'unmistakably. Use "low" when the shape of the values is doing most of the work,',
  'or when two fields would both be reasonable.',
  '',
  'A column may be assigned to at most one field, and a field to at most one',
  'column. Assign nothing to a column that is administrative rather than about the',
  'student — fees paid, kit size, a register mark.',
].join('\n');

function describe(column: ColumnShape): string {
  const looks = column.looks.length === 0 ? 'empty' : column.looks.join(', then ');
  const repeats = column.repeats ? ', values repeat across rows' : '';
  return `Column ${column.index}: heading "${column.header}" — ${column.filled}% filled, values look like: ${looks}${repeats}`;
}

/**
 * What the agent made of the leftovers, as matches the caller can merge.
 *
 * Returns an empty list rather than throwing on every failure path — no key, a
 * timeout, a rate limit, a malformed answer. The heuristic's result is already
 * good, and the operator is about to be shown these columns as questions
 * regardless; a failed call should cost them nothing but the questions they were
 * going to be asked anyway.
 */
export async function matchWithAgent(input: AgentInput): Promise<ColumnMatch[]> {
  if (!agentAvailable()) return [];
  if (input.columns.length === 0 || input.fields.length === 0) return [];
  if (input.columns.length > MAX_COLUMNS) return [];

  const allowed = input.fields.map((entry) => entry.field);

  const prompt = [
    'Unplaced columns:',
    ...input.columns.map(describe),
    '',
    'Fields still needing a column:',
    ...input.fields.map((entry) => `- ${entry.field} (shown to the operator as "${entry.label}")`),
  ].join('\n');

  try {
    const client = new Anthropic();

    const response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 2048,
        // A short classification. Thinking stays on — it is the default on this
        // model, and turning it off is what makes a model write a tool call into
        // its visible text instead of calling the tool.
        output_config: { effort: 'low' },
        system: SYSTEM,
        messages: [{ role: 'user', content: prompt }],
        tools: [
          {
            name: TOOL_NAME,
            description: 'Record which spreadsheet column feeds which register field.',
            strict: true,
            input_schema: {
              type: 'object',
              properties: {
                assignments: {
                  type: 'array',
                  description: 'One entry per column you are willing to place. Omit the rest.',
                  items: {
                    type: 'object',
                    properties: {
                      column: { type: 'integer', description: 'The column index given above.' },
                      field: { type: 'string', enum: allowed },
                      confidence: { type: 'string', enum: ['high', 'low'] },
                    },
                    required: ['column', 'field', 'confidence'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['assignments'],
              additionalProperties: false,
            },
          },
        ],
        tool_choice: { type: 'tool', name: TOOL_NAME },
      },
      // Well under the server action's own patience. A spreadsheet import that
      // hangs for a minute on a column-naming nicety is worse than one that
      // asks two extra questions.
      { timeout: 20_000 },
    );

    const call = response.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === 'tool_use' && block.name === TOOL_NAME,
    );
    if (call === undefined) return [];

    return read(call.input, input);
  } catch {
    // Rate limited, timed out, misconfigured key, network. All of them mean the
    // same thing here: the operator answers the questions themselves.
    return [];
  }
}

/**
 * The model's answer, believed only as far as it can be checked.
 *
 * Every field and column is verified against what was actually offered. `strict`
 * makes a malformed answer unlikely; this makes a malformed answer harmless,
 * which is a different and better property.
 */
function read(raw: unknown, input: AgentInput): ColumnMatch[] {
  if (raw === null || typeof raw !== 'object') return [];
  const assignments = (raw as { assignments?: unknown }).assignments;
  if (!Array.isArray(assignments)) return [];

  const offeredColumns = new Set(input.columns.map((column) => column.index));
  const offeredFields = new Set<string>(input.fields.map((entry) => entry.field));

  const takenColumns = new Set<number>();
  const takenFields = new Set<string>();
  const matches: ColumnMatch[] = [];

  for (const entry of assignments as Assignment[]) {
    if (entry === null || typeof entry !== 'object') continue;

    const { column, field, confidence } = entry;
    if (typeof column !== 'number' || !offeredColumns.has(column)) continue;
    if (typeof field !== 'string' || !offeredFields.has(field)) continue;
    if (takenColumns.has(column) || takenFields.has(field)) continue;

    takenColumns.add(column);
    takenFields.add(field);
    matches.push({
      field: field as ImportField,
      column,
      // Never `certain`. That band is for a header that *is* the field's name;
      // this is a good guess, and the difference is worth keeping.
      confidence: confidence === 'high' ? 'likely' : 'unsure',
      reason: 'agent',
    });
  }

  return matches;
}
