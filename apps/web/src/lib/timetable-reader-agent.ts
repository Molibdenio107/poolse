import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { classifyAiError, stopFailure, type AiFailure } from './ai-failure';
import { anthropicKeyConfigured, metered } from './ai-meter';
import { narrowReading, type TimetableReading } from './timetable-reading';
import { SCHEMA, SYSTEM } from './timetable-reader-prompt';

/**
 * A timetable PDF or photo, read for what it says — POOLSE-223.
 *
 * `pdf-table-agent.ts` asks the model to copy a table as a grid of cells, and a
 * real municipal timetable breaks every grid assumption: blocks merged across
 * hours, two activities sharing a cell by lane count, *Encerrado*, two pools in
 * one file, a page of prices. So this asks for **the answer, not the table**:
 * rows of meaning — which pool, which day, from when to when, what activity, how
 * many lanes, or closed.
 *
 * **It transcribes; it never decides.** No matching to turmas, no lane picking,
 * no dropping a row it finds odd. The person maps pools and activities in the
 * next step, and the preview and conflict check follow unchanged.
 *
 * Same switches and cost as the PDF list reader (rule 9): the `pdf_table`
 * reader, the platform switch and the club's tick, one metered claim per file.
 * Structured output, never a forced tool call (the current Opus refuses one).
 * The run on the test corpus is `pnpm timetable:eval`; a change to this prompt
 * ships only with a recorded run.
 */

const MODEL = process.env['POOLSE_PDF_TABLE_MODEL'] ?? 'claude-opus-5-5';

const MAX_BYTES = 12 * 1024 * 1024;

export type TimetableMedia = 'application/pdf' | 'image/jpeg' | 'image/png';

export type TimetableReadResult =
  | { reading: TimetableReading }
  /** `off`, `noKey` and `capReached` mean the call was never made (POOLSE-137). */
  | { error: 'off' | 'noKey' | 'capReached' | 'nothingFound' | AiFailure };

/** The block the document travels in: a PDF is a document, a photo an image. */
function sourceBlock(bytes: ArrayBuffer, media: TimetableMedia): Anthropic.Beta.BetaContentBlockParam {
  const data = Buffer.from(bytes).toString('base64');
  return media === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: media, data } }
    : { type: 'image', source: { type: 'base64', media_type: media, data } };
}

export async function readTimetableDocument(
  bytes: ArrayBuffer,
  media: TimetableMedia,
): Promise<TimetableReadResult> {
  if (!anthropicKeyConfigured()) return { error: 'noKey' };
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return { error: 'unreadable' };

  let used: Anthropic.Beta.BetaMessage | null = null;
  const attempt = async (): Promise<TimetableReadResult> => {
    try {
      const client = new Anthropic();
      const response = await client.beta.messages
        .stream(
          {
            model: MODEL,
            // A declined read is retried on the model the API picks, inside the same call.
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            max_tokens: 64000,
            system: SYSTEM,
            messages: [
              {
                role: 'user',
                content: [
                  sourceBlock(bytes, media),
                  { type: 'text', text: 'Read this timetable into rows.' },
                ],
              },
            ],
            // Merged cells and two-activity cells are reasoning, not copying.
            output_config: { effort: 'high', format: { type: 'json_schema', schema: SCHEMA } },
          },
          { timeout: 300_000 },
        )
        .finalMessage();
      used = response;

      const stopped = stopFailure(response.stop_reason);
      if (stopped !== null) return { error: stopped };
      const text = response.content
        .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');
      const reading = narrowReading(JSON.parse(text));
      return reading.rows.length === 0 ? { error: 'nothingFound' } : { reading };
    } catch (error) {
      return { error: classifyAiError('pdf_table', error) };
    }
  };

  // Claimed before, finished after, read or not — POOLSE-137.
  const run = await metered('pdf_table', async () => {
    const value = await attempt();
    return { value, succeeded: !('error' in value), response: used };
  });
  return 'gate' in run ? { error: run.gate } : run.value;
}
