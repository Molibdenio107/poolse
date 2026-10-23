import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import {
  REPORT_FIELDS,
  readRows,
  type AnalysisReportParser,
  type ReportFile,
  type ReportResult,
} from './analysis-report';

/**
 * The import agent that reads an analysis report — round 6, ticket 1.
 *
 * The one implementation of `AnalysisReportParser` this build ships. Everything
 * about *what* a report is lives in `analysis-report.ts`, which is pure; this
 * file is the API key, the document block and the prompt, and nothing else.
 *
 * **Three rules, the same three `match-agent.ts` holds to:**
 *
 * - **It is optional, and off by default.** Two switches, not one:
 *   `WATER_REPORT_AI_ENABLED` says the club wants it, `ANTHROPIC_API_KEY` says
 *   it can work. Without both, dropping a PDF says so in a sentence rather than
 *   failing — a feature that is not turned on is not an error, and a screen that
 *   shows a red box for one teaches people to distrust the red boxes.
 * - **Only the document is sent.** Nothing else about the tenant travels: not
 *   the club's name, not its tanks, not its previous readings. The model is
 *   asked to read a page, not to reason about a customer.
 * - **Nothing it says is written.** Every extracted value lands on the same
 *   preview a spreadsheet lands on, behind the same `validateAnalysisRows`, and
 *   a person ticks the rows.
 */

/** The model, overridable so the choice stays an operator's rather than a build's. */
const MODEL = process.env['POOLSE_ANALYSIS_REPORT_MODEL'] ?? 'claude-opus-5-5';

/**
 * The ceiling on a report.
 *
 * A laboratory's report is one or two pages. Anything much past this is a
 * scanned archive somebody has dropped by mistake, and reading it would cost
 * real money to produce an answer nobody wants.
 */
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * The reply's shape — structured output rather than a forced tool call
 * (POOLSE-101), because the current Opus refuses a forced `tool_choice`; the
 * same move `pdf-table-agent.ts` made. Every field optional, every value text.
 */
const SCHEMA = {
  type: 'object',
  properties: {
    analyses: {
      type: 'array',
      description: 'One entry per analysis. Omit any field not on the document.',
      items: {
        type: 'object',
        properties: Object.fromEntries(REPORT_FIELDS.map((field) => [field, { type: 'string' }])),
        required: [],
        additionalProperties: false,
      },
    },
  },
  required: ['analyses'],
  additionalProperties: false,
};

const SYSTEM = [
  'You read water-analysis reports for swimming pools and extract the readings.',
  '',
  'The reports are Portuguese laboratory documents, municipal inspection sheets,',
  'or photographs of a handwritten log. Layouts vary completely: a table, a list',
  'of labelled values, or a form with boxes.',
  '',
  'Record one entry per analysis. Most reports contain exactly one; a report',
  'covering several tanks or several dates contains one per tank per date.',
  '',
  'Copy values exactly as written, including a decimal comma — do not convert a',
  'comma to a point and do not round. If a value is illegible or absent, omit',
  'that field rather than guessing: an omitted reading is a question, and a',
  'guessed one becomes a safety record that is wrong.',
  '',
  'Free chlorine and combined chlorine are different measurements and must never',
  'be swapped. A report showing a single unqualified "cloro" is free chlorine.',
  '',
  'Dates as they appear on the document: the date the sample was collected,',
  'not the date the report was issued. Times as HH:MM in 24 hours.',
  'Put a tank name in "pool" only when the document names one.',
  '',
  'Field names: ph, temperature, free_chlorine, combined_chlorine,',
  'total_alkalinity, calcium_hardness, cyanuric_acid, turbidity, salt.',
  '',
  'A laboratory report may also count micro-organisms. Copy each count exactly',
  'as written, including "<1" or "Ausência":',
  '- colonies_37c: colónias / microrganismos cultiváveis a 37 °C',
  '- total_coliforms: bactérias coliformes / coliformes totais',
  '- e_coli: Escherichia coli',
  '- enterococci: enterococos (intestinais)',
  '- pseudomonas_aeruginosa: Pseudomonas aeruginosa',
  '- staphylococcus_coagulase_positive: estafilococos coagulase positiva',
  '- staphylococcus_total: estafilococos totais',
  'Put the name of the laboratory in "laboratory" and the report or bulletin number',
  'in "reportReference" when the document shows them.',
].join('\n');

export class ClaudeAnalysisReportParser implements AnalysisReportParser {
  available(): boolean {
    return (
      (process.env['WATER_REPORT_AI_ENABLED'] ?? '').trim().toLowerCase() === 'true' &&
      (process.env['ANTHROPIC_API_KEY'] ?? '').trim() !== ''
    );
  }

  async parse(file: ReportFile): Promise<ReportResult> {
    if (!this.available()) return { error: 'disabled' };
    if (file.bytes.byteLength === 0 || file.bytes.byteLength > MAX_BYTES) {
      return { error: 'unreadable' };
    }

    try {
      const client = new Anthropic();

      const response = await client.beta.messages.create(
        {
          model: MODEL,
          // A declined read is retried on the model the API picks, inside the
          // same call — as the PDF table reader does.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          max_tokens: 4096,
          system: SYSTEM,
          messages: [
            {
              role: 'user',
              content: [
                documentBlock(file),
                { type: 'text', text: 'Extract every analysis in this report.' },
              ],
            },
          ],
          output_config: { format: { type: 'json_schema', schema: SCHEMA } },
        },
        /*
         * Longer than the column matcher's twenty seconds, because reading a
         * page is a bigger job than naming a column — and still well inside the
         * server action's patience, so a slow answer is a message rather than a
         * screen that never comes back.
         */
        { timeout: 60_000 },
      );

      if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
        return { error: 'unreadable' };
      }
      const text = response.content
        .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');
      const rows = readRows(JSON.parse(text));
      return rows.length === 0 ? { error: 'nothingFound' } : { rows };
    } catch {
      // Rate limited, timed out, misconfigured key, network, a PDF the API
      // refuses. All of them mean the same thing to the operator: this document
      // could not be read, and the form beside it still works.
      return { error: 'unreadable' };
    }
  }
}

/**
 * The parser this build uses.
 *
 * A function rather than a module constant so the environment is read when a
 * report arrives rather than when the module is first imported — which is what
 * lets a deployment turn the feature on without a rebuild.
 */
export function analysisReportParser(): AnalysisReportParser {
  return new ClaudeAnalysisReportParser();
}

function documentBlock(file: ReportFile): Anthropic.Beta.BetaContentBlockParam {
  const data = file.bytes.toString('base64');

  return file.mediaType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
    : { type: 'image', source: { type: 'base64', media_type: file.mediaType, data } };
}
