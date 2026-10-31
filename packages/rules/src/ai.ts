/**
 * The AI readers, and what a read is estimated to cost — POOLSE-137.
 *
 * **One list.** The `ai_reader` enum spells exactly these keys;
 * `ai-readers.integration.test.ts` reads the enum back and compares, so the two
 * cannot drift. A new reader is a value there, here, and a platform switch.
 *
 * A reader runs only when its platform switch is on, the club's tick for it is
 * on, and the web app has a key. A club stores what is **on**
 * (`organization.ai_readers`), and a new club has none.
 */
export const AI_READERS = ['energy_invoice', 'id_document', 'water_report', 'pdf_table', 'column_match'] as const;

export type AiReader = (typeof AI_READERS)[number];

export function isAiReader(value: unknown): value is AiReader {
  return typeof value === 'string' && (AI_READERS as readonly string[]).includes(value);
}

/** The platform switch that gates each reader, in `platform_switch`. */
export const AI_READER_SWITCH: Record<AiReader, string> = {
  energy_invoice: 'energy_invoice_ai',
  id_document: 'id_document_ai',
  water_report: 'water_report_ai',
  pdf_table: 'pdf_table_ai',
  column_match: 'column_match_ai',
};

/**
 * The readers that can run for a club: ticked by the club and switched on for
 * the platform, in list order. A switch that is missing reads as off — a
 * reader that cannot be shown to be on must not spend.
 */
export function effectiveAiReaders(
  clubReaders: readonly string[],
  switches: Readonly<Record<string, boolean>>,
): AiReader[] {
  const ticked = new Set(clubReaders);
  return AI_READERS.filter((reader) => ticked.has(reader) && switches[AI_READER_SWITCH[reader]] === true);
}

/**
 * USD per million tokens, input and output, per model id — copied from
 * Anthropic's price list on 31-10-2026 (list cached 06-10-2026). First-party
 * API rates; a model not here is unpriced and its cost reads `—`, never 0.
 * Only a developer changes these, which is why they are a constant and not a
 * table (Rui, 31-10-2026). Haiku 5.5's rate is for prompts up to 100K tokens,
 * which every reader here stays well under.
 */
export const AI_MODEL_PRICES: Readonly<Record<string, { inputUsd: number; outputUsd: number }>> = {
  'claude-fable-5-1': { inputUsd: 10, outputUsd: 50 },
  'claude-opus-5-5': { inputUsd: 4, outputUsd: 20 },
  'claude-opus-5': { inputUsd: 5, outputUsd: 25 },
  'claude-sonnet-5-5': { inputUsd: 2, outputUsd: 10 },
  'claude-sonnet-5': { inputUsd: 2, outputUsd: 10 },
  'claude-haiku-5-5': { inputUsd: 0.1, outputUsd: 0.5 },
};

/**
 * Euros per US dollar, for the estimate only — 31-10-2026, approximate. The
 * figure is labelled an estimate wherever it is shown (docs/financials.md §9),
 * so a rate a few cents off moves nothing anybody acts on.
 */
export const USD_TO_EUR = 0.86;

/**
 * What one call is estimated to have cost, in euro cents (fractional — round
 * only when showing a total). Null when the model has no price or the tokens
 * were never recorded: an unknown is not a zero.
 */
export function estimateReadCents(read: {
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}): number | null {
  if (read.model === null || read.inputTokens === null || read.outputTokens === null) return null;
  const price = AI_MODEL_PRICES[read.model];
  if (price === undefined) return null;
  const usd = (read.inputTokens * price.inputUsd + read.outputTokens * price.outputUsd) / 1_000_000;
  return usd * USD_TO_EUR * 100;
}

/**
 * The estimate over many calls, with its coverage — "every aggregate reports
 * its coverage" (docs/financials.md). `cents` is null when *any* call used a
 * model with no price, because a partial sum looks exactly like a whole one;
 * calls with no tokens recorded (history from before POOLSE-137, a call that
 * crashed) are left out and counted in `measured` versus `reads`.
 */
export function estimateReadsCents(
  reads: readonly { model: string | null; inputTokens: number | null; outputTokens: number | null; count?: number }[],
): { cents: number | null; measured: number; reads: number } {
  let cents = 0;
  let measured = 0;
  let total = 0;
  let unpriced = false;
  for (const read of reads) {
    const count = read.count ?? 1;
    total += count;
    if (read.inputTokens === null || read.outputTokens === null) continue;
    const one = estimateReadCents(read);
    if (one === null) {
      unpriced = true;
      continue;
    }
    // A grouped row carries summed tokens, so its estimate is already the whole.
    cents += one;
    measured += count;
  }
  return { cents: unpriced ? null : cents, measured, reads: total };
}
